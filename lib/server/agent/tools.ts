// Bộ công cụ trung lập (dùng chung cho Claude API và API tương thích OpenAI).
import fs from 'fs/promises';
import path from 'path';
import type { ArtifactType, Department, PermissionLevel, Project, Task, TaskPriority, WorkProduct } from '../../types';
import { DIRECTOR_WORKFLOW_ID } from '../../catalog';
import { IGNORED_DIRS, isInside, readTextFile } from '../fsbrowse';
import { runShell, truncate } from '../platform';
import * as computer from '../computer';
import { requestPermission, titled, detailed } from './permissions';
import { sysMsg } from '../../i18n/format';
import type { AgentContext } from './context';
import { GRAPH_TOOLS, graphForProject, runGraphTool } from '../codegraph/agent';

export interface ToolDef {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

export interface ToolResult {
  content: string;
  image?: { base64: string; mediaType: 'image/png' };
  isError?: boolean;
  /** Agent đã nộp kết quả cuối – dừng vòng lặp. */
  finished?: boolean;
}

const str = (description: string) => ({ type: 'string', description });
const num = (description: string) => ({ type: 'number', description });
const bool = (description: string) => ({ type: 'boolean', description });

const READ_TOOLS: ToolDef[] = [
  {
    name: 'list_dir',
    description: 'Liệt kê tệp/thư mục (dạng cây). Đường dẫn tương đối tính từ thư mục dự án.',
    parameters: {
      type: 'object',
      properties: { path: str('Thư mục cần xem, mặc định "."'), depth: num('Độ sâu 1-4, mặc định 2') },
      required: [],
    },
  },
  {
    name: 'read_file',
    description: 'Đọc nội dung tệp văn bản kèm số dòng. Dùng offset/limit cho tệp dài.',
    parameters: {
      type: 'object',
      properties: {
        path: str('Đường dẫn tệp (tương đối hoặc tuyệt đối)'),
        offset: num('Dòng bắt đầu (từ 1)'),
        limit: num('Số dòng tối đa, mặc định 400'),
      },
      required: ['path'],
    },
  },
  {
    name: 'search_files',
    description: 'Tìm kiếm nội dung bằng biểu thức chính quy trong các tệp của dự án (giống grep).',
    parameters: {
      type: 'object',
      properties: {
        pattern: str('Biểu thức chính quy (không phân biệt hoa thường)'),
        path: str('Thư mục tìm, mặc định "."'),
        file_glob: str('Lọc theo đuôi tệp, ví dụ ".ts" hoặc ".py"'),
      },
      required: ['pattern'],
    },
  },
];

const WRITE_TOOLS: ToolDef[] = [
  {
    name: 'write_file',
    description: 'Tạo mới hoặc ghi đè toàn bộ một tệp. Tự tạo thư mục cha.',
    parameters: {
      type: 'object',
      properties: { path: str('Đường dẫn tệp'), content: str('Toàn bộ nội dung tệp') },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Sửa tệp bằng cách thay thế chính xác một đoạn văn bản. old_text phải khớp tuyệt đối (kể cả thụt lề).',
    parameters: {
      type: 'object',
      properties: {
        path: str('Đường dẫn tệp'),
        old_text: str('Đoạn văn bản cần thay (phải duy nhất trừ khi replace_all)'),
        new_text: str('Đoạn văn bản mới'),
        replace_all: bool('Thay tất cả vị trí khớp'),
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
  {
    name: 'run_command',
    description: 'Chạy một lệnh shell (PowerShell trên Windows, bash trên macOS/Linux) và nhận stdout/stderr/mã thoát.',
    parameters: {
      type: 'object',
      properties: {
        command: str('Câu lệnh cần chạy'),
        cwd: str('Thư mục chạy, mặc định thư mục dự án'),
        timeout_sec: num('Giới hạn thời gian (giây), mặc định 120, tối đa 900'),
      },
      required: ['command'],
    },
  },
];

const COMPUTER_TOOLS: ToolDef[] = [
  {
    name: 'screenshot',
    description: 'Chụp toàn bộ màn hình máy tính để quan sát. Trả về ảnh.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'mouse_click',
    description: 'Click chuột tại tọa độ (x, y) theo ảnh chụp màn hình gần nhất.',
    parameters: {
      type: 'object',
      properties: {
        x: num('Tọa độ x trên ảnh chụp'),
        y: num('Tọa độ y trên ảnh chụp'),
        button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Nút chuột' },
        double: bool('Double-click'),
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'type_text',
    description: 'Gõ văn bản vào ứng dụng đang được chọn.',
    parameters: { type: 'object', properties: { text: str('Văn bản cần gõ') }, required: ['text'] },
  },
  {
    name: 'press_keys',
    description: 'Nhấn phím hoặc tổ hợp phím, ví dụ "enter", "ctrl+s", "alt+tab", "cmd+space".',
    parameters: { type: 'object', properties: { keys: str('Tổ hợp phím') }, required: ['keys'] },
  },
  {
    name: 'open_target',
    description: 'Mở URL, tệp, thư mục hoặc ứng dụng bằng chương trình mặc định của hệ điều hành.',
    parameters: { type: 'object', properties: { target: str('URL, đường dẫn hoặc tên ứng dụng') }, required: ['target'] },
  },
];

const PERMISSION_IDS = ['read', 'write', 'auto', 'full'];

/** Phòng nhận việc được: giám đốc ở chế độ "Giao cho giám đốc" giao được mọi phòng; còn lại theo quyền giao việc của phòng. */
/**
 * Giám đốc điều phối (chế độ "Giao cho giám đốc"): nhiệm vụ chủ trì, hoặc khi bạn nhắn tiếp cho giám đốc trong hội thoại.
 * Được giao việc cho mọi phòng, và chỉ có quyền đọc.
 */
export function isPlanner(ctx: { project: Pick<Project, 'workflowId'>; task: Pick<Task, 'kind'>; department: Pick<Department, '_id'> }): boolean {
  if (ctx.project.workflowId !== DIRECTOR_WORKFLOW_ID) return false;
  return ctx.task.kind === 'phase' || (ctx.task.kind === 'chat' && ctx.department._id === 'director');
}

export function delegationTargets(ctx: {
  project: Pick<Project, 'workflowId'>;
  task: Pick<Task, 'kind'>;
  department: Department;
  departments: Department[];
}): Department[] {
  const planner = isPlanner(ctx);
  return ctx.departments.filter((d) => d.enabled && d._id !== ctx.department._id && (planner || ctx.department.canDelegateTo.includes(d._id)));
}

function delegateTool(ctx: AgentContext): ToolDef {
  const targets = delegationTargets(ctx);
  return {
    name: 'delegate_task',
    description:
      'Giao một nhiệm vụ cho phòng ban khác. Nhiệm vụ sẽ được thực hiện SAU khi bạn nộp kết quả; khi các phòng hoàn thành, bạn sẽ nhận báo cáo để tổng hợp. Phòng có thể giao: ' +
      targets.map((d) => `${d._id} (${d.name} – ${d.title})`).join('; '),
    parameters: {
      type: 'object',
      properties: {
        department_id: { type: 'string', enum: targets.map((d) => d._id), description: 'ID phòng nhận việc' },
        title: str('Tiêu đề ngắn của nhiệm vụ'),
        instructions: str('Hướng dẫn chi tiết: bối cảnh, yêu cầu, đầu ra mong đợi, tiêu chí hoàn thành, tệp liên quan'),
        priority: { type: 'string', enum: ['low', 'normal', 'high'], description: 'Độ ưu tiên' },
        step: str('Mã bước trong kế hoạch, vd "B1" – để các bước sau tham chiếu'),
        after: {
          type: 'array',
          items: { type: 'string' },
          description: 'Làm SAU các bước này (mã bước đã giao trước đó trong lượt này). Phòng nhận sẽ tự bắt đầu khi các bước đó xong và nhận kết quả bàn giao. Bỏ trống = làm ngay.',
        },
        permission: {
          type: 'string',
          enum: ['read', 'write', 'auto', 'full'],
          description: 'Quyền cấp cho việc này: read = chỉ đọc (phân tích/review), write = sửa tệp, auto = chạy lệnh trong dự án, full = toàn quyền máy. Không vượt quyền của dự án và phòng nhận.',
        },
      },
      required: ['department_id', 'title', 'instructions'],
    },
  };
}

const ARTIFACT_TOOL: ToolDef = {
  name: 'create_artifact',
  description: 'Lưu một tài liệu bàn giao (brief, spec, kế hoạch, báo cáo…) vào kho tài liệu dự án để các phòng khác dùng.',
  parameters: {
    type: 'object',
    properties: {
      title: str('Tên tài liệu'),
      type: { type: 'string', enum: ['document', 'plan', 'design', 'code', 'report', 'other'], description: 'Loại' },
      content: str('Nội dung Markdown đầy đủ'),
    },
    required: ['title', 'type', 'content'],
  },
};

function submitTool(ctx: AgentContext): ToolDef {
  const needsDecision = ctx.task.kind === 'review' || (ctx.task.kind === 'phase' && phaseNeedsLeadDecision(ctx));
  return {
    name: 'submit_result',
    description: 'Nộp kết quả cuối cùng của nhiệm vụ và kết thúc lượt làm việc. BẮT BUỘC gọi khi hoàn thành.',
    parameters: {
      type: 'object',
      properties: {
        summary: str('Tóm tắt kết quả (3-10 dòng): đã làm gì, kết quả, vấn đề còn lại'),
        details: str('Nội dung chi tiết (Markdown) nếu cần'),
        decision: {
          type: 'string',
          enum: ['approve', 'reject'],
          description: needsDecision ? 'BẮT BUỘC: quyết định phê duyệt (approve) hoặc từ chối (reject)' : 'Chỉ dùng khi được yêu cầu phê duyệt',
        },
      },
      required: needsDecision ? ['summary', 'decision'] : ['summary'],
    },
  };
}

export function phaseNeedsLeadDecision(ctx: AgentContext): boolean {
  const phase = ctx.workflow.phases.find((p) => p.id === ctx.task.phase);
  return Boolean(phase?.requiredApprovals.includes(ctx.department._id));
}

/** Công cụ theo Paperclip: ghi sản phẩm công việc, hỏi chủ công ty, xin ý kiến, tuyển nhân sự. */
const WORK_PRODUCT_TOOL: ToolDef = {
  name: 'add_work_product',
  description: 'Ghi lại một sản phẩm công việc (link Pull Request, commit, nhánh, trang xem trước, tệp, tài liệu) để chủ công ty xem.',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['pull_request', 'commit', 'branch', 'preview_url', 'file', 'document', 'other'] },
      title: str('Tên sản phẩm'),
      url: str('Đường dẫn (nếu có)'),
    },
    required: ['type', 'title'],
  },
};

const ASK_USER_TOOL: ToolDef = {
  name: 'ask_user',
  description: 'Hỏi chủ công ty một câu khi THẬT SỰ cần quyết định của họ mới làm tiếp được. Nhiệm vụ sẽ dừng chờ câu trả lời sau khi bạn nộp kết quả.',
  parameters: {
    type: 'object',
    properties: { prompt: str('Câu hỏi ngắn gọn'), options: { type: 'array', items: { type: 'string' }, description: '2–4 lựa chọn gợi ý' } },
    required: ['prompt'],
  },
};

const REQUEST_APPROVAL_TOOL: ToolDef = {
  name: 'request_approval',
  description: 'Xin ý kiến / phê duyệt của chủ công ty cho một đề xuất (không chặn việc đang làm; bạn được báo lại khi họ quyết định).',
  parameters: { type: 'object', properties: { title: str('Đề xuất'), detail: str('Chi tiết, lý do, chi phí/rủi ro') }, required: ['title', 'detail'] },
};

const HIRE_TOOL: ToolDef = {
  name: 'hire_agent',
  description: 'Tuyển một nhân sự (phòng ban) mới khi công ty thiếu chuyên môn. Có thể cần chủ công ty duyệt.',
  parameters: {
    type: 'object',
    properties: {
      name: str('Tên phòng, vd "Phòng Pháp Chế"'),
      title: str('Chức danh'),
      role: str('Vai trò ngắn (chữ thường, gạch ngang)'),
      description: str('Làm gì, trách nhiệm chính'),
      reportsTo: str('id phòng cấp trên (mặc định là bạn)'),
    },
    required: ['name', 'title', 'description'],
  },
};

const WRITE_DOCUMENT_TOOL: ToolDef = {
  name: 'write_document',
  description: 'Tạo / cập nhật một tài liệu của nhiệm vụ (kế hoạch, đặc tả, báo cáo dài) để chủ công ty đọc và bình luận từng đoạn. Cùng khoá = phiên bản mới; luôn ghi TOÀN VĂN.',
  parameters: {
    type: 'object',
    properties: {
      key: str('Khoá tài liệu (chữ thường, gạch ngang), vd "plan", "spec"'),
      title: str('Tiêu đề tài liệu'),
      body: str('Toàn văn Markdown'),
      change_summary: str('Tóm tắt thay đổi so với phiên bản trước'),
    },
    required: ['title', 'body'],
  },
};

const REPLY_DOCUMENT_TOOL: ToolDef = {
  name: 'reply_document_comment',
  description: 'Trả lời một luồng bình luận trên tài liệu của nhiệm vụ (mã luồng có trong mục "Tài liệu của nhiệm vụ này"); đặt resolve=true khi đã xử lý xong góp ý.',
  parameters: {
    type: 'object',
    properties: { thread_id: str('Mã luồng bình luận'), body: str('Nội dung trả lời'), resolve: bool('Đánh dấu đã xử lý') },
    required: ['thread_id', 'body'],
  },
};

export function buildTools(ctx: AgentContext): ToolDef[] {
  const tools = [...READ_TOOLS];
  // Bản đồ mã của dự án (có khi lời nhắc đã dựng đồ thị) – tra trước khi đọc tệp để tiết kiệm token
  if (graphForProject(ctx.project._id)) tools.push(...GRAPH_TOOLS);
  if (ctx.permission !== 'read') tools.push(...WRITE_TOOLS);
  if (ctx.settings.computerControl && ctx.permission !== 'read') tools.push(...COMPUTER_TOOLS);
  if (ctx.allowDelegation && delegationTargets(ctx).length) tools.push(delegateTool(ctx));
  tools.push(WORK_PRODUCT_TOOL, ASK_USER_TOOL, REQUEST_APPROVAL_TOOL);
  if (ctx.department.permissions?.canHire || ctx.department._id === 'director' || isPlanner(ctx)) tools.push(HIRE_TOOL);
  tools.push(ARTIFACT_TOOL, WRITE_DOCUMENT_TOOL, REPLY_DOCUMENT_TOOL);
  // Thao tác của kết nối dịch vụ (MCP) – chính sách Tắt đã bị loại; Hỏi trước xin phép khi gọi
  if (ctx.mcp?.tools.length) tools.push(...ctx.mcp.tools);
  tools.push(submitTool(ctx));
  return tools;
}

// ---------------- Thực thi ----------------

function resolvePath(ctx: AgentContext, p: unknown): string {
  const raw = typeof p === 'string' && p.trim() ? p.trim() : '.';
  return path.resolve(ctx.root, raw);
}

function rel(ctx: AgentContext, abs: string): string {
  return isInside(ctx.root, abs) ? path.relative(ctx.root, abs) || '.' : abs;
}

function validate(def: ToolDef | undefined, input: unknown): string | null {
  if (!def) return 'Công cụ không tồn tại';
  if (!input || typeof input !== 'object') return 'Tham số phải là một object JSON';
  const obj = input as Record<string, unknown>;
  for (const key of def.parameters.required) {
    if (obj[key] === undefined || obj[key] === null) return `Thiếu tham số bắt buộc "${key}"`;
  }
  for (const [key, schema] of Object.entries(def.parameters.properties)) {
    const v = obj[key];
    if (v === undefined || v === null) continue;
    const t = (schema as { type?: string; enum?: string[] }).type;
    if (t === 'string' && typeof v !== 'string') return `"${key}" phải là chuỗi`;
    if (t === 'number' && typeof v !== 'number') return `"${key}" phải là số`;
    if (t === 'boolean' && typeof v !== 'boolean') return `"${key}" phải là true/false`;
    const en = (schema as { enum?: string[] }).enum;
    if (en && !en.includes(v as string)) return `"${key}" phải thuộc: ${en.join(', ')}`;
  }
  return null;
}

async function listTree(dir: string, depth: number, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  let items;
  try {
    items = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    return [`${prefix}(không đọc được: ${(err as Error).message})`];
  }
  items.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
  for (const it of items.slice(0, 300)) {
    if (it.isDirectory()) {
      if (IGNORED_DIRS.has(it.name) || it.name === '.git') {
        out.push(`${prefix}${it.name}/ …`);
        continue;
      }
      out.push(`${prefix}${it.name}/`);
      if (depth > 1) out.push(...(await listTree(path.join(dir, it.name), depth - 1, prefix + '  ')));
    } else {
      let size = '';
      try {
        size = ` (${(await fs.stat(path.join(dir, it.name))).size} B)`;
      } catch {
        /* bỏ qua */
      }
      out.push(`${prefix}${it.name}${size}`);
    }
    if (out.length > 600) {
      out.push(`${prefix}…`);
      break;
    }
  }
  return out;
}

async function searchFiles(root: string, pattern: RegExp, ext: string | undefined): Promise<string[]> {
  const results: string[] = [];
  const stack = [root];
  let scanned = 0;
  while (stack.length && results.length < 200 && scanned < 8000) {
    const dir = stack.pop()!;
    let items;
    try {
      items = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const it of items) {
      const full = path.join(dir, it.name);
      if (it.isDirectory()) {
        if (!IGNORED_DIRS.has(it.name) && !it.name.startsWith('.')) stack.push(full);
        continue;
      }
      if (ext && !it.name.endsWith(ext)) continue;
      scanned++;
      try {
        const st = await fs.stat(full);
        if (st.size > 1024 * 1024) continue;
        const { content, binary } = await readTextFile(full, 1024 * 1024);
        if (binary) continue;
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (pattern.test(lines[i])) {
            results.push(`${path.relative(root, full)}:${i + 1}: ${lines[i].trim().slice(0, 240)}`);
            if (results.length >= 200) break;
          }
        }
      } catch {
        /* bỏ qua */
      }
    }
  }
  return results;
}

export async function executeTool(ctx: AgentContext, defs: ToolDef[], name: string, input: unknown): Promise<ToolResult> {
  const def = defs.find((d) => d.name === name);
  const invalid = validate(def, input);
  if (invalid) return { content: `LỖI THAM SỐ: ${invalid}`, isError: true };
  const a = input as Record<string, unknown>;
  const graphAnswer = runGraphTool(ctx.project._id, name, a);
  if (graphAnswer !== null) return { content: graphAnswer };

  try {
    switch (name) {
      case 'list_dir': {
        const abs = resolvePath(ctx, a.path);
        const denied = await requestPermission(ctx, {
          type: 'read',
          ...titled(sysMsg('Xem thư mục ngoài dự án: {path}', { path: abs })),
          detail: abs,
          payload: { path: abs },
          inside: isInside(ctx.root, abs),
        });
        if (denied) return { content: denied, isError: true };
        const depth = Math.min(4, Math.max(1, Number(a.depth ?? 2)));
        const lines = await listTree(abs, depth);
        return { content: `${rel(ctx, abs)}\n${lines.join('\n') || '(trống)'}` };
      }
      case 'read_file': {
        const abs = resolvePath(ctx, a.path);
        const denied = await requestPermission(ctx, {
          type: 'read',
          ...titled(sysMsg('Đọc tệp ngoài dự án: {path}', { path: abs })),
          detail: abs,
          payload: { path: abs },
          inside: isInside(ctx.root, abs),
        });
        if (denied) return { content: denied, isError: true };
        const { content, binary, size, truncated } = await readTextFile(abs, 2 * 1024 * 1024);
        if (binary) return { content: `Tệp nhị phân (${size} B) – không hiển thị được.` };
        const lines = content.split(/\r?\n/);
        const offset = Math.max(1, Number(a.offset ?? 1));
        const limit = Math.min(2000, Math.max(1, Number(a.limit ?? 400)));
        const slice = lines.slice(offset - 1, offset - 1 + limit);
        const body = slice.map((l, i) => `${String(offset + i).padStart(5)}│ ${l}`).join('\n');
        const more = offset - 1 + limit < lines.length ? `\n… còn ${lines.length - (offset - 1 + limit)} dòng (dùng offset để đọc tiếp)` : '';
        return { content: truncate(`${rel(ctx, abs)} (${lines.length} dòng${truncated ? ', đã cắt bớt' : ''})\n${body}${more}`, 60_000) };
      }
      case 'search_files': {
        let re: RegExp;
        try {
          re = new RegExp(String(a.pattern), 'i');
        } catch {
          return { content: 'Biểu thức chính quy không hợp lệ', isError: true };
        }
        const abs = resolvePath(ctx, a.path);
        const denied = await requestPermission(ctx, {
          type: 'read',
          ...titled(sysMsg('Tìm kiếm ngoài dự án: {path}', { path: abs })),
          detail: abs,
          payload: { path: abs },
          inside: isInside(ctx.root, abs),
        });
        if (denied) return { content: denied, isError: true };
        const res = await searchFiles(abs, re, a.file_glob ? String(a.file_glob).replace(/^\*/, '') : undefined);
        return { content: res.length ? res.join('\n') : 'Không tìm thấy kết quả.' };
      }
      case 'write_file': {
        const abs = resolvePath(ctx, a.path);
        const content = String(a.content);
        const denied = await requestPermission(ctx, {
          type: 'write',
          ...titled(sysMsg('Ghi tệp ngoài dự án: {path}', { path: abs })),
          detail: `${abs}\n\n${content.slice(0, 2000)}`,
          payload: { path: abs, bytes: content.length },
          inside: isInside(ctx.root, abs),
        });
        if (denied) return { content: denied, isError: true };
        await fs.mkdir(path.dirname(abs), { recursive: true });
        let existed = true;
        try {
          await fs.access(abs);
        } catch {
          existed = false;
        }
        await fs.writeFile(abs, content, 'utf8');
        await ctx.log('tool', `${existed ? 'Cập nhật' : 'Tạo'} tệp \`${rel(ctx, abs)}\``, {
          tool: 'write_file',
          path: abs,
          bytes: content.length,
        });
        return { content: `Đã ${existed ? 'ghi đè' : 'tạo'} ${rel(ctx, abs)} (${content.length} ký tự).` };
      }
      case 'edit_file': {
        const abs = resolvePath(ctx, a.path);
        let oldText = String(a.old_text);
        let newText = String(a.new_text);
        const denied = await requestPermission(ctx, {
          type: 'write',
          ...titled(sysMsg('Sửa tệp ngoài dự án: {path}', { path: abs })),
          detail: `${abs}\n\n- ${oldText.slice(0, 800)}\n+ ${newText.slice(0, 800)}`,
          payload: { path: abs },
          inside: isInside(ctx.root, abs),
        });
        if (denied) return { content: denied, isError: true };
        const original = await fs.readFile(abs, 'utf8');
        // Tệp xuống dòng kiểu Windows (CRLF): read_file trả \n nên đổi đoạn cần thay sang \r\n cho khớp
        if (original.includes('\r\n') && oldText.includes('\n') && !oldText.includes('\r\n') && !original.includes(oldText)) {
          oldText = oldText.replace(/\n/g, '\r\n');
          newText = newText.replace(/\r?\n/g, '\r\n');
        }
        const count = oldText ? original.split(oldText).length - 1 : 0;
        if (count === 0) return { content: 'Không tìm thấy old_text trong tệp. Hãy read_file để lấy đúng nội dung.', isError: true };
        if (count > 1 && !a.replace_all)
          return { content: `old_text xuất hiện ${count} lần. Thêm ngữ cảnh để duy nhất hoặc đặt replace_all=true.`, isError: true };
        const updated = a.replace_all ? original.split(oldText).join(newText) : original.replace(oldText, () => newText);
        await fs.writeFile(abs, updated, 'utf8');
        await ctx.log('tool', `Sửa tệp \`${rel(ctx, abs)}\` (${count} chỗ)`, { tool: 'edit_file', path: abs });
        return { content: `Đã sửa ${rel(ctx, abs)} (${a.replace_all ? count : 1} vị trí).` };
      }
      case 'run_command': {
        const command = String(a.command);
        const cwd = resolvePath(ctx, a.cwd);
        const denied = await requestPermission(ctx, {
          type: 'shell',
          ...titled(sysMsg('Chạy lệnh: {command}', { command: command.slice(0, 120) })),
          ...detailed(sysMsg('Thư mục: {cwd}\n\n{command}', { cwd, command })),
          payload: { command, cwd },
          inside: isInside(ctx.root, cwd),
        });
        if (denied) return { content: denied, isError: true };
        const timeout = Math.min(900, Math.max(5, Number(a.timeout_sec ?? 120))) * 1000;
        await ctx.log('tool', `\`$ ${command}\``, { tool: 'run_command', command, cwd });
        const r = await runShell(command, { cwd, timeoutMs: timeout, signal: ctx.signal });
        const out = [
          `Mã thoát: ${r.code}${r.timedOut ? ' (hết thời gian)' : ''}${r.error ? ` – ${r.error}` : ''}`,
          r.stdout ? `STDOUT:\n${truncate(r.stdout, 20_000)}` : '',
          r.stderr ? `STDERR:\n${truncate(r.stderr, 8_000)}` : '',
        ]
          .filter(Boolean)
          .join('\n');
        await ctx.log('tool', `Kết quả lệnh (mã ${r.code})`, {
          tool: 'run_command_result',
          output: truncate(`${r.stdout}\n${r.stderr}`.trim(), 4000),
        });
        return { content: out, isError: r.code !== 0 };
      }
      case 'screenshot': {
        const denied = await requestPermission(ctx, {
          type: 'computer',
          ...titled(sysMsg('Chụp màn hình')),
          ...detailed(sysMsg('Agent muốn chụp màn hình để quan sát.')),
          payload: { action: 'screenshot' },
          inside: false,
        });
        if (denied) return { content: denied, isError: true };
        const shot = await computer.screenshot();
        await ctx.log('tool', 'Chụp màn hình', { tool: 'screenshot', width: shot.width, height: shot.height });
        return { content: shot.note, image: { base64: shot.base64, mediaType: 'image/png' } };
      }
      case 'mouse_click':
      case 'type_text':
      case 'press_keys':
      case 'open_target': {
        const label =
          name === 'mouse_click'
            ? `Click chuột tại (${a.x}, ${a.y})`
            : name === 'type_text'
              ? `Gõ văn bản: ${String(a.text).slice(0, 80)}`
              : name === 'press_keys'
                ? `Nhấn phím ${a.keys}`
                : `Mở ${a.target}`;
        const denied = await requestPermission(ctx, {
          type: 'computer',
          title: label,
          detail: JSON.stringify(a, null, 2),
          payload: { action: name, ...a },
          inside: false,
        });
        if (denied) return { content: denied, isError: true };
        let msg: string;
        if (name === 'mouse_click')
          msg = await computer.mouseClick(Number(a.x), Number(a.y), (a.button as 'left') ?? 'left', Boolean(a.double));
        else if (name === 'type_text') msg = await computer.typeText(String(a.text));
        else if (name === 'press_keys') msg = await computer.pressKeys(String(a.keys));
        else msg = await computer.openTarget(String(a.target));
        await ctx.log('tool', label, { tool: name });
        return { content: msg };
      }
      case 'delegate_task': {
        const to = String(a.department_id);
        if (to === ctx.department._id) return { content: 'Không thể tự giao việc cho chính mình.', isError: true };
        if (!delegationTargets(ctx).some((d) => d._id === to)) return { content: `Không được giao việc cho ${to}.`, isError: true };
        if (ctx.delegations.length >= 10) return { content: 'Đã đạt tối đa 10 việc giao trong một lượt.', isError: true };
        const after = Array.isArray(a.after) ? a.after.map(String).filter(Boolean).slice(0, 8) : [];
        ctx.delegations.push({
          to,
          title: String(a.title).slice(0, 200),
          instructions: String(a.instructions),
          priority: (a.priority as TaskPriority) ?? 'normal',
          permission: PERMISSION_IDS.includes(String(a.permission)) ? (a.permission as PermissionLevel) : undefined,
          step: a.step ? String(a.step).slice(0, 20) : undefined,
          after: after.length ? after : undefined,
        });
        const dept = ctx.departments.find((d) => d._id === to);
        return {
          content: `Đã ghi nhận giao việc "${a.title}" cho ${dept?.name ?? to}${after.length ? ` (làm sau bước ${after.join(', ')})` : ''}. Việc sẽ bắt đầu khi bạn nộp kết quả.`,
        };
      }
      case 'create_artifact': {
        ctx.artifacts.push({
          title: String(a.title).slice(0, 200),
          type: (a.type as ArtifactType) ?? 'document',
          content: String(a.content),
        });
        return { content: `Đã lưu tài liệu "${a.title}".` };
      }
      case 'write_document': {
        if (ctx.extras.documents.length >= 8) return { content: 'Tối đa 8 tài liệu mỗi lượt.', isError: true };
        const key = a.key ? String(a.key) : undefined;
        const i = ctx.extras.documents.findIndex((d) => (key ? d.key === key : d.title === String(a.title)));
        const doc = { key, title: String(a.title).slice(0, 200), body: String(a.body), summary: a.change_summary ? String(a.change_summary).slice(0, 500) : undefined };
        if (i >= 0) ctx.extras.documents[i] = doc;
        else ctx.extras.documents.push(doc);
        return { content: `Đã ghi tài liệu "${a.title}" (lưu khi bạn nộp kết quả).` };
      }
      case 'reply_document_comment': {
        ctx.extras.docReplies.push({ thread: String(a.thread_id), body: String(a.body).slice(0, 8000), resolve: a.resolve === true });
        return { content: 'Đã ghi câu trả lời bình luận.' };
      }
      case 'add_work_product': {
        ctx.extras.products.push({ type: (['pull_request', 'commit', 'branch', 'preview_url', 'file', 'document'].includes(String(a.type)) ? a.type : 'other') as WorkProduct['type'], title: String(a.title).slice(0, 200), url: a.url ? String(a.url) : undefined });
        return { content: 'Đã ghi sản phẩm công việc.' };
      }
      case 'ask_user': {
        const options = Array.isArray(a.options) ? a.options.map(String).filter(Boolean).slice(0, 4) : [];
        ctx.extras.question = {
          prompt: String(a.prompt).slice(0, 1000),
          options: [...options.map((label, i) => ({ id: `o${i + 1}`, label })), { id: 'other', label: 'Ý khác', freeText: true, placeholder: 'Nhập câu trả lời…' }],
        };
        return { content: 'Đã ghi câu hỏi. Hãy nộp kết quả (submit_result) – nhiệm vụ sẽ chờ chủ công ty trả lời rồi chạy tiếp.' };
      }
      case 'request_approval': {
        if (ctx.extras.requests.length >= 3) return { content: 'Tối đa 3 đề xuất mỗi lượt.', isError: true };
        ctx.extras.requests.push({ title: String(a.title).slice(0, 200), detail: String(a.detail).slice(0, 4000) });
        return { content: 'Đã gửi đề xuất – bạn sẽ được báo khi chủ công ty quyết định.' };
      }
      case 'hire_agent': {
        if (ctx.extras.hires.length >= 3) return { content: 'Tối đa 3 đề nghị tuyển mỗi lượt.', isError: true };
        ctx.extras.hires.push({ name: String(a.name).slice(0, 80), title: String(a.title ?? '').slice(0, 120), role: String(a.role ?? 'general').slice(0, 40), description: String(a.description).slice(0, 2000), reportsTo: a.reportsTo ? String(a.reportsTo) : undefined });
        return { content: 'Đã ghi đề nghị tuyển – được xử lý khi bạn nộp kết quả.' };
      }
      case 'submit_result': {
        ctx.submitted = {
          summary: String(a.summary),
          details: a.details ? String(a.details) : undefined,
          decision: (a.decision as 'approve' | 'reject' | undefined) ?? null,
        };
        return { content: 'Đã nộp kết quả.', finished: true };
      }
      default: {
        const pol = ctx.mcp?.policy(name);
        if (!pol || !ctx.mcp) return { content: `Công cụ không hỗ trợ: ${name}`, isError: true };
        if (pol.policy === 'off') return { content: `Thao tác "${pol.tool}" của ${pol.conn.name} đang bị tắt.`, isError: true };
        if (pol.policy === 'ask') {
          const denied = await requestPermission(ctx, {
            type: 'mcp',
            title: `${pol.conn.name}: ${pol.tool}`,
            detail: `${pol.conn.name} → ${pol.tool}

${JSON.stringify(a, null, 2).slice(0, 3000)}`,
            payload: { connectionId: pol.conn._id, tool: pol.tool, input: a },
            inside: false,
          });
          if (denied) return { content: denied, isError: true };
        }
        await ctx.log('tool', `🔌 ${pol.conn.name} → ${pol.tool}`, { tool: name });
        const r = await ctx.mcp.call(name, a);
        if (!r) return { content: `Công cụ không hỗ trợ: ${name}`, isError: true };
        return { content: truncate(r.text, 40_000), isError: r.isError };
      }
    }
  } catch (err) {
    if ((err as Error).name === 'CancelledError') throw err;
    return { content: `LỖI: ${(err as Error).message}`, isError: true };
  }
}

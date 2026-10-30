// Soạn prompt hệ thống (theo vị trí) và prompt nhiệm vụ cho agent.
import { PERMISSION_LEVELS } from '../../catalog';
import type { ArtifactType, PermissionLevel, Task, TaskDelegation, TaskPriority, WorkProduct } from '../../types';
import { childrenOf, listArtifacts, listMessages, listTasks } from '../repo';
import { treeSummary } from '../fsbrowse';
import { osName, shellName } from '../platform';
import { attachmentPath } from '../attachments';
import { documentsForPrompt } from '../documents';
import { emptyExtras, type AgentContext, type OutcomeExtras } from './context';
import { delegationTargets, isPlanner, phaseNeedsLeadDecision } from './tools';
import { isLocale, localeInfo } from '../../i18n/locales';
import { codeMapSection } from '../codegraph/agent';

export type PromptMode = 'tools' | 'cli' | 'manual';

const WAKE_LABEL: Record<string, string> = {
  heartbeat: 'heartbeat định kỳ – rà soát việc của bạn',
  routine: 'lịch định kỳ',
  changes_requested: 'người duyệt yêu cầu sửa',
  question_answered: 'chủ công ty đã trả lời câu hỏi của bạn',
  approval_resolved: 'chủ công ty đã xử lý đề nghị của bạn',
  board_request_resolved: 'chủ công ty đã phản hồi đề nghị của bạn',
  review_requested: 'được nhờ duyệt kết quả',
  comment: 'chủ công ty vừa bình luận',
  document_comment: 'chủ công ty vừa bình luận trên tài liệu của nhiệm vụ',
};

function orgChart(ctx: AgentContext): string {
  const lines = ctx.departments
    .filter((d) => d.enabled)
    .map((d) => `- \`${d._id}\` – **${d.name}** (${d.title}): ${d.description}`);
  const targets = delegationTargets(ctx);
  const delegation =
    ctx.allowDelegation && targets.length
      ? `Bạn có thể giao việc cho: ${targets.map((d) => `\`${d._id}\` (${d.name})`).join(', ')}.`
      : 'Trong nhiệm vụ này bạn KHÔNG giao việc cho phòng khác – hãy tự hoàn thành.';
  return `# JVCompany – cơ cấu tổ chức
Bạn là **${ctx.department.name}** (id: \`${ctx.department._id}\`) – ${ctx.department.title}.
${lines.join('\n')}

${delegation}`;
}

function environment(ctx: AgentContext, mode: PromptMode): string {
  const perm = PERMISSION_LEVELS.find((p) => p.id === ctx.permission)!;
  if (mode === 'manual') {
    return `# Môi trường làm việc
- Bạn đang được truy cập qua giao diện web, KHÔNG có quyền truy cập trực tiếp máy tính hay tệp của dự án.
- Hãy làm việc dựa trên thông tin trong tin nhắn này. Nếu cần tạo/sửa tệp, trả về nội dung ĐẦY ĐỦ của từng tệp trong mục "files" của khối kết quả – hệ thống sẽ ghi giúp bạn.
- Ngày hiện tại: ${new Date().toLocaleDateString('vi-VN')}`;
  }
  return `# Môi trường làm việc
- Hệ điều hành: ${osName()} · shell: ${shellName()}
- Thư mục làm việc: \`${ctx.root}\`${ctx.hasRealPath ? '' : ' (không gian làm việc riêng – dự án chưa gắn thư mục máy tính)'}
- Quyền hạn: **${perm.label}** – ${perm.description}
- ${
    mode === 'tools' || ctx.approvalHooks
      ? 'Thao tác vượt quyền (lệnh shell khi chỉ được ghi, ghi tệp ngoài dự án…) sẽ TỰ tạo thẻ phê duyệt cho chủ công ty – cứ thực hiện thao tác bình thường và chờ. Bị từ chối thì KHÔNG thử lại cùng thao tác.'
      : 'Thao tác vượt quyền sẽ bị chặn. Đừng thử lại nhiều lần.'
  } KHÔNG dùng request_approval để xin quyền (đồng ý đề nghị không đổi được quyền); nếu vẫn cần, ghi rõ lệnh và lý do trong kết quả để chủ công ty nâng quyền dự án.
- Điều khiển máy tính (chuột/bàn phím/chụp màn hình): ${mode === 'tools' && ctx.settings.computerControl && ctx.permission !== 'read' ? 'được bật' : 'không khả dụng – đừng dùng lệnh shell để giả lập chuột/bàn phím'}
- Ngày hiện tại: ${new Date().toLocaleDateString('vi-VN')}`;
}

const TOOLS_RULES = `# Cách làm việc
1. Hiểu nhiệm vụ và bối cảnh. Nếu có mã nguồn/tài liệu, khảo sát bằng list_dir, read_file, search_files trước khi kết luận.
2. Thực hiện bằng công cụ. Ghi tệp trực tiếp khi nhiệm vụ yêu cầu tạo/sửa sản phẩm.
3. Tài liệu bàn giao quan trọng (brief, spec, kế hoạch, báo cáo) → lưu bằng create_artifact để phòng khác dùng. Tài liệu dài của riêng nhiệm vụ (để chủ công ty đọc, bình luận từng đoạn) → write_document; trả lời bình luận trên tài liệu bằng reply_document_comment.
4. Chỉ giao việc (delegate_task) khi thật sự cần chuyên môn của phòng khác; viết hướng dẫn đầy đủ và cấp quyền (permission) vừa đủ cho việc đó. Việc cần kết quả của việc khác thì đặt mã bước (step) và "after" để phòng sau tự nhận bàn giao.
5. BẮT BUỘC kết thúc bằng submit_result với bản tóm tắt rõ ràng.`;

function protocolRules(ctx: AgentContext, mode: PromptMode): string {
  const targets = ctx.allowDelegation ? delegationTargets(ctx).map((d) => d._id) : [];
  const needsDecision = ctx.task.kind === 'review' || (ctx.task.kind === 'phase' && phaseNeedsLeadDecision(ctx));
  const filesField =
    mode === 'manual'
      ? `,
  "files": [{"path": "đường/dẫn/tương-đối.ext", "content": "nội dung đầy đủ của tệp"}]`
      : '';
  return `# Cách nộp kết quả (BẮT BUỘC)
Làm xong nhiệm vụ, KẾT THÚC câu trả lời bằng đúng MỘT khối JSON có rào \`\`\`jv-result như sau:

\`\`\`jv-result
{
  "summary": "Tóm tắt 3-10 dòng: đã làm gì, kết quả, vấn đề còn lại",
  "decision": ${needsDecision ? '"approve" hoặc "reject" (BẮT BUỘC)' : 'null'},
  "delegate": [{"step": "B1", "after": [], "to": "<id phòng>", "title": "Tiêu đề", "instructions": "Hướng dẫn chi tiết", "priority": "normal", "permission": "read"}],
  "artifacts": [{"title": "Tên tài liệu", "type": "document", "content": "Nội dung Markdown"}]${filesField}
}
\`\`\`
- "delegate": ${targets.length ? `chỉ dùng các id: ${targets.map((t) => `"${t}"`).join(', ')}; để [] nếu không cần giao việc` : 'luôn để []'}.
- "permission" của mỗi việc giao: read (chỉ đọc) | write (sửa tệp) | auto (chạy lệnh trong dự án) | full (toàn quyền) – cấp vừa đủ cho việc đó.
- "step" / "after": mã bước và các bước phải xong trước (chuỗi bàn giao: phòng sau tự bắt đầu khi phòng trước xong và nhận kết quả của họ). Để "after": [] nếu làm ngay.
- "artifacts": loại thuộc document | plan | design | code | report | other; để [] nếu không có.
- Trường TUỲ CHỌN (chỉ thêm khi cần):
  - "work_products": [{"type": "pull_request|commit|branch|preview_url|file|document", "title": "…", "url": "…"}] – sản phẩm đã tạo.
  - "question": {"prompt": "Câu hỏi", "options": ["Lựa chọn 1", "Lựa chọn 2"]} – CHỈ khi thật sự cần chủ công ty quyết định mới làm tiếp được; nhiệm vụ sẽ chờ câu trả lời.
  - "request_approval": [{"title": "…", "detail": "…"}] – xin ý kiến chủ công ty (không chặn việc đang làm).
  - "documents": [{"key": "plan", "title": "Kế hoạch", "body": "toàn văn Markdown", "summary": "đã sửa gì"}] – tài liệu dài của nhiệm vụ (kế hoạch, đặc tả, báo cáo) để chủ công ty đọc và bình luận từng đoạn; cùng khoá = phiên bản mới (ghi lại TOÀN VĂN).
  - "document_replies": [{"thread": "<mã luồng>", "body": "trả lời", "resolve": true}] – trả lời bình luận trên tài liệu.${hireNote(ctx)}
- JSON phải hợp lệ (dùng \\n cho xuống dòng trong chuỗi).`;
}

/** Giám đốc / phòng có quyền tuyển: được đề nghị tuyển nhân sự mới. */
function hireNote(ctx: AgentContext): string {
  const can = ctx.department.permissions?.canHire || ctx.department._id === 'director' || isPlanner(ctx);
  if (!can) return '';
  return `
  - "hire": [{"name": "Phòng …", "title": "Chức danh", "role": "vai-tro", "description": "Làm gì", "reportsTo": "<id cấp trên>"}] – tuyển nhân sự mới khi công ty thiếu chuyên môn (có thể cần chủ công ty duyệt).`;
}

/** Công ty, chuỗi mục tiêu ("vì sao"), chuỗi cấp trên và kỹ năng của phòng (theo Paperclip). */
function companyContext(ctx: AgentContext, mode: PromptMode): string {
  const co = ctx.company;
  if (!co) return '';
  const parts: string[] = [`# Công ty: ${co.name}${co.mission ? `\nSứ mệnh: ${co.mission.split('\n')[0]}` : ''}`];
  if (co.goals.length) {
    const level = { company: 'Công ty', team: 'Nhóm', agent: 'Cá nhân', task: 'Việc' } as const;
    parts.push(`## Mục tiêu công việc này phục vụ (từ gần → xa)\n${co.goals.map((g) => `- [${level[g.level]}] ${g.title}${g.description ? ` – ${g.description.slice(0, 200)}` : ''}`).join('\n')}`);
  }
  if (co.chain.length) parts.push(`## Cấp trên của bạn\n${co.chain.map((b) => `${b.name} (${b.title})`).join(' → ')}`);
  if (co.skills.length) {
    const how = mode === 'manual' ? 'Áp dụng các kỹ năng này khi phù hợp.' : 'Khi nhiệm vụ khớp mô tả của kỹ năng, ĐỌC tệp SKILL.md tương ứng trước khi làm.';
    parts.push(`## Kỹ năng của bạn\n${co.skills.map((k) => `- **${k.name}**: ${k.description}${mode === 'manual' ? '' : ` (tệp: \`${k.path}\`)`}`).join('\n')}\n${how}`);
  }
  return parts.join('\n\n');
}

/**
 * Ngôn ngữ trả lời = ngôn ngữ giao diện của chủ dự án (dự án ghi khi bạn gửi yêu cầu; thiếu thì theo cài đặt).
 * Đặt cuối prompt để ghi đè câu "Luôn trả lời bằng tiếng Việt" trong prompt phòng ban có sẵn. Chưa chọn ngôn ngữ → giữ như cũ.
 */
function languageRule(ctx: AgentContext): string {
  const code = ctx.project.language ?? ctx.settings.language;
  if (!isLocale(code)) return '';
  const lang = localeInfo(code).ai;
  return `# Response language
The project owner uses the app in ${lang}. Write ALL of your replies, reports, documents, plans, task titles and delegation instructions in ${lang}. Keep code, commands, file names and technical terms as they are. This overrides any earlier instruction about which language to answer in.`;
}

export async function buildSystemPrompt(ctx: AgentContext, mode: PromptMode): Promise<string> {
  return [
    ctx.department.systemPrompt.trim(),
    companyContext(ctx, mode),
    orgChart(ctx),
    environment(ctx, mode),
    mode === 'tools' ? TOOLS_RULES : protocolRules(ctx, mode),
    languageRule(ctx),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Các tin gần đây giữa chủ dự án và phòng này (để hiểu những câu như "bắt đầu làm đi", "làm tiếp phần còn lại"). */
async function recentConversation(ctx: AgentContext): Promise<string> {
  const rows = (await listMessages(ctx.project._id, { limit: 300 })).filter(
    (m) => (m.kind === 'chat' && m.author.type === 'user') || (m.kind === 'report' && m.author.departmentId === ctx.department._id),
  );
  // Tin cuối cùng chính là nhiệm vụ này → đã có ở mục NHIỆM VỤ.
  if (rows.length && rows[rows.length - 1].author.type === 'user' && rows[rows.length - 1].content.trim() === ctx.task.instructions.trim()) rows.pop();
  return rows
    .slice(-8)
    .map((m) => {
      const who = m.author.type === 'user' ? 'Chủ dự án' : (m.author.name ?? ctx.department.name);
      const text = m.content.trim();
      return `**${who}:** ${text.length > 700 ? `${text.slice(0, 700)}…` : text}`;
    })
    .join('\n\n');
}

async function childReports(task: Task, ctx: AgentContext): Promise<string> {
  const kids = await childrenOf(task._id);
  const done = kids.filter((k) => ['done', 'failed', 'cancelled'].includes(k.status));
  if (!done.length) return '';
  const name = (id: string) => ctx.departments.find((d) => d._id === id)?.name ?? id;
  return done
    .map(
      (k) =>
        `### ${name(k.departmentId)} – ${k.title} [${k.status === 'done' ? 'Hoàn thành' : k.status === 'failed' ? 'LỖI' : 'Đã hủy'}]\n${
          k.status === 'done' ? (k.result ?? '').slice(0, 4000) : (k.error ?? '').slice(0, 1000)
        }`,
    )
    .join('\n\n');
}

export async function buildTaskPrompt(ctx: AgentContext, mode: PromptMode): Promise<string> {
  const { project, task, workflow } = ctx;
  const phase = workflow.phases.find((p) => p.id === task.phase);
  const parts: string[] = [];
  parts.push(`# Dự án: ${project.name}
- Mục tiêu: ${project.goal || '(chưa nêu)'}
- Mô tả / yêu cầu:
${(project.description || '(không có)').trim()}`);
  if (phase) {
    parts.push(`# Giai đoạn hiện tại: ${phase.name}
${phase.description}
Đầu ra kỳ vọng của giai đoạn: ${phase.outputs.join('; ')}`);
  }
  const prev = workflow.phases.filter((p) => project.phaseSummaries[p.id] && p.id !== task.phase);
  if (prev.length) {
    parts.push(
      `# Kết quả các giai đoạn trước\n` +
        prev.map((p) => `## ${p.name}\n${project.phaseSummaries[p.id].slice(0, 3000)}`).join('\n\n'),
    );
  }
  // Kế hoạch / báo cáo đã có của chính giai đoạn này (vd giám đốc đã lập kế hoạch, dự án đã xong một lượt) → làm tiếp, không làm lại.
  const current = phase ? project.phaseSummaries[phase.id] : '';
  if (current && !(task.kind === 'phase' && task.round > 0)) {
    parts.push(`# Kế hoạch / kết quả đã có của giai đoạn này
${current.slice(0, 4000)}

Đây là phần đã làm / đã thống nhất trước đó – tiếp tục từ đây, KHÔNG khảo sát hay lập kế hoạch lại từ đầu.`);
  }
  const isEval = Boolean(task.evalRunId);
  if (!isEval && task.round === 0 && (task.kind === 'chat' || (task.kind === 'phase' && isPlanner(ctx)))) {
    const convo = await recentConversation(ctx);
    if (convo) parts.push(`# Hội thoại gần đây với chủ dự án (cũ → mới)\n${convo}`);
  }
  // Bộ đánh giá: mỗi đầu vào độc lập – không đọc tài liệu / kết quả của lượt khác
  const artifacts = isEval ? [] : (await listArtifacts(project._id)).slice(0, 10);
  if (artifacts.length) {
    const limit = mode === 'manual' ? 6000 : 2500;
    const name = (id: string) => ctx.departments.find((d) => d._id === id)?.name ?? id;
    parts.push(
      `# Tài liệu dự án hiện có (mới nhất trước)\n` +
        artifacts
          .map(
            (a) =>
              `## ${a.title} (${a.type}, ${name(a.departmentId)})\n${a.content.slice(0, limit)}${a.content.length > limit ? '\n…(đã rút gọn)' : ''}`,
          )
          .join('\n\n'),
    );
  }
  const docs = await documentsForPrompt(task, mode === 'manual' ? 10_000 : 6000);
  if (docs) parts.push(docs);
  if (ctx.hasRealPath && task.round === 0 && mode !== 'cli') {
    const tree = await treeSummary(ctx.root, mode === 'manual' ? 200 : 80);
    if (tree) parts.push(`# Cấu trúc thư mục dự án (rút gọn)\n\`\`\`\n${tree}\n\`\`\``);
  }
  // Bản đồ mã (đồ thị tri thức kiểu Graphify): agent biết ngay cần đọc tệp nào thay vì grep / đọc lan man → ít token hơn
  if (mode === 'cli' || mode === 'tools') {
    const map = await codeMapSection(ctx, mode);
    if (map) parts.push(map);
  }

  const assigner =
    task.assignedBy === 'user'
      ? 'Chủ dự án (người dùng)'
      : task.assignedBy === 'system'
        ? 'Hệ thống quy trình'
        : (ctx.departments.find((d) => d._id === task.assignedBy)?.name ?? task.assignedBy);
  parts.push(`# NHIỆM VỤ CỦA BẠN${task.identifier ? ` (${task.identifier})` : ''}
- Tiêu đề: ${task.title}
- Người giao: ${assigner}
- Độ ưu tiên: ${task.priority}${task.wakeReason ? `\n- Lý do lượt chạy này: ${WAKE_LABEL[task.wakeReason] ?? task.wakeReason}` : ''}

${task.instructions.trim()}`);

  // Nhiệm vụ cha (tối đa 6 cấp) – để hiểu việc này nằm trong việc lớn nào
  if (task.parentId) {
    const ancestors: Task[] = [];
    for (let id: string | null = task.parentId, i = 0; id && i < 6; i++) {
      const [t] = await listTasks({ _id: id });
      if (!t) break;
      ancestors.push(t);
      id = t.parentId;
    }
    if (ancestors.length) {
      const dn = (id: string) => ctx.departments.find((d) => d._id === id)?.name ?? id;
      parts.push(`# Việc lớn chứa việc này (cha → gốc)\n${ancestors.map((a) => `- ${a.identifier ?? ''} ${a.title} [${a.status}] – ${dn(a.departmentId)}`).join('\n')}`);
    }
  }

  // Chuỗi bàn giao: kết quả phòng trước + phòng sẽ nhận bàn giao tiếp theo
  const deptName = (id: string) => ctx.departments.find((d) => d._id === id)?.name ?? id;
  if (task.dependsOn?.length) {
    const prev = await listTasks({ _id: { $in: task.dependsOn } });
    parts.push(`# BÀN GIAO TỪ PHÒNG TRƯỚC
${prev.map((p) => `## ${deptName(p.departmentId)} – ${p.title}\n${(p.result ?? '(không có báo cáo)').slice(0, 5000)}`).join('\n\n')}

Tiếp nhận kết quả trên và làm ĐÚNG phần việc của phòng bạn – không làm lại phần của phòng trước.`);
  }
  const next = await listTasks({ dependsOn: task._id });
  if (next.length) {
    parts.push(`# PHÒNG NHẬN BÀN GIAO TIẾP THEO
${next.map((n) => `- ${deptName(n.departmentId)}: ${n.title}`).join('\n')}
Kết quả của bạn sẽ được chuyển cho các phòng này – ghi rõ những gì họ cần biết (tệp đã sửa, cách chạy/kiểm tra, lưu ý).`);
  }

  if (task.attachments?.length) {
    const how =
      mode === 'manual'
        ? 'Ảnh nằm trên máy của chủ dự án – người chuyển tiếp sẽ tải các ảnh này lên cùng tin nhắn.'
        : mode === 'cli'
          ? 'Hãy mở/đọc từng tệp ảnh theo đường dẫn để xem nội dung (công cụ đọc tệp xem được ảnh).'
          : 'Nếu ảnh không hiển thị kèm tin nhắn này, hãy đọc tệp theo đường dẫn.';
    parts.push(`# Ảnh đính kèm
${task.attachments.map((a) => `- ${a.name}: \`${attachmentPath(a)}\``).join('\n')}

${how}`);
  }

  if (task.kind === 'review') {
    parts.push(`# Yêu cầu phê duyệt
Bạn đang đại diện ${ctx.department.name} xét duyệt kết quả giai đoạn "${phase?.name ?? task.phase}". Kiểm tra kỹ dựa trên bằng chứng (tài liệu, tệp, kết quả chạy).
Đưa ra quyết định "approve" (đạt) hoặc "reject" (không đạt – liệt kê chính xác điều cần sửa).`);
  } else if (task.kind === 'phase' && phaseNeedsLeadDecision(ctx)) {
    parts.push(`# Lưu ý
Bạn vừa là phòng chủ trì vừa là phòng phê duyệt giai đoạn này. Sau khi hoàn thành (và tổng hợp kết quả các phòng, nếu có), hãy đưa ra quyết định "approve" hoặc "reject" cho giai đoạn.`);
  }

  if (task.round > 0) {
    const reports = await childReports(task, ctx);
    parts.push(`# LƯỢT TIẾP THEO (lượt ${task.round + 1})
Ở lượt trước bạn đã báo cáo:
${(task.result ?? '').slice(0, 3000)}

Các phòng bạn giao việc đã báo cáo kết quả:
${reports || '(không có báo cáo)'}

Hãy kiểm tra, tổng hợp kết quả thành sản phẩm hoàn chỉnh của nhiệm vụ.${ctx.allowDelegation ? ' Chỉ giao thêm việc nếu thật sự còn thiếu.' : ' Không giao thêm việc.'}`);
  }
  return parts.join('\n\n');
}

// ---------------- Giao thức kết quả (CLI / web) ----------------

export interface ProtocolResult {
  summary: string;
  decision: 'approve' | 'reject' | null;
  delegate: TaskDelegation[];
  artifacts: { title: string; type: ArtifactType; content: string }[];
  files: { path: string; content: string }[];
  extras: OutcomeExtras;
  found: boolean;
}

const PRODUCT_TYPES = ['preview_url', 'pull_request', 'branch', 'commit', 'file', 'document', 'other'];

/** Phần mở rộng của khối kết quả: work_products, question, hire, request_approval. */
function parseExtras(obj: Record<string, unknown>): OutcomeExtras {
  const arr = (v: unknown) => (Array.isArray(v) ? v : []).filter((d): d is Record<string, unknown> => !!d && typeof d === 'object');
  const q = obj.question && typeof obj.question === 'object' ? (obj.question as Record<string, unknown>) : null;
  const options = q ? (Array.isArray(q.options) ? q.options : []).map((o, i) => (typeof o === 'string' ? { id: `o${i + 1}`, label: o } : { id: String((o as Record<string, unknown>).id ?? `o${i + 1}`), label: String((o as Record<string, unknown>).label ?? '') })).filter((o) => o.label) : [];
  return {
    products: arr(obj.work_products ?? obj.products)
      .map((p) => ({ type: (PRODUCT_TYPES.includes(String(p.type)) ? p.type : 'other') as WorkProduct['type'], title: String(p.title ?? p.url ?? 'Sản phẩm').slice(0, 200), url: p.url ? String(p.url) : undefined }))
      .slice(0, 20),
    question: q && String(q.prompt ?? '').trim() ? { prompt: String(q.prompt).trim(), options: [...options.slice(0, 6), { id: 'other', label: 'Ý khác', freeText: true, placeholder: 'Nhập câu trả lời…' }] } : null,
    hires: arr(obj.hire ?? obj.hires)
      .map((h) => ({
        name: String(h.name ?? '').trim().slice(0, 80),
        title: String(h.title ?? '').trim().slice(0, 120),
        role: String(h.role ?? 'general').trim().slice(0, 40),
        description: String(h.description ?? '').trim().slice(0, 2000),
        reportsTo: h.reportsTo ? String(h.reportsTo) : undefined,
        responsibilities: Array.isArray(h.responsibilities) ? h.responsibilities.map(String).slice(0, 10) : undefined,
      }))
      .filter((h) => h.name)
      .slice(0, 3),
    requests: arr(obj.request_approval ?? obj.requests)
      .map((r) => ({ title: String(r.title ?? '').trim().slice(0, 200), detail: String(r.detail ?? '').trim().slice(0, 4000) }))
      .filter((r) => r.title)
      .slice(0, 3),
    documents: arr(obj.documents)
      .map((d) => ({ key: d.key ? String(d.key) : undefined, title: String(d.title ?? d.key ?? '').trim().slice(0, 200), body: String(d.body ?? d.content ?? ''), summary: d.summary ? String(d.summary).slice(0, 500) : undefined }))
      .filter((d) => d.body.trim() && (d.title || d.key))
      .slice(0, 8),
    docReplies: arr(obj.document_replies)
      .map((r) => ({ thread: String(r.thread ?? r.thread_id ?? '').trim(), body: String(r.body ?? '').trim().slice(0, 8000), resolve: r.resolve === true }))
      .filter((r) => r.thread && (r.body || r.resolve))
      .slice(0, 20),
  };
}

/** Thoát các ký tự điều khiển (xuống dòng, tab…) nằm trong chuỗi JSON – lỗi rất hay gặp ở đầu ra của mô hình. */
function escapeControlChars(s: string): string {
  let out = '';
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (!inStr) {
      if (ch === '"') inStr = true;
      out += ch;
      continue;
    }
    if (esc) {
      out += ch;
      esc = false;
    } else if (ch === '\\') {
      out += ch;
      esc = true;
    } else if (ch === '"') {
      out += ch;
      inStr = false;
    } else if (ch === '\n') out += '\\n';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\r') continue;
    else if (ch < ' ') out += ' ';
    else out += ch;
  }
  return out;
}

function tryJson(raw: string): Record<string, unknown> | null {
  const fixed = escapeControlChars(raw);
  const noTrailing = (s: string) => s.replace(/,\s*([}\]])/g, '$1');
  for (const a of [raw, fixed, noTrailing(fixed)]) {
    try {
      const v = JSON.parse(a);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      /* thử cách khác */
    }
  }
  return null;
}

export function parseProtocol(text: string): ProtocolResult {
  const empty: ProtocolResult = { summary: '', decision: null, delegate: [], artifacts: [], files: [], extras: emptyExtras(), found: false };
  let obj: Record<string, unknown> | null = null;
  const fence = text.lastIndexOf('```jv-result');
  if (fence >= 0) {
    const start = text.indexOf('\n', fence);
    // Nội dung JSON có thể chứa ``` (mã nguồn trong artifact) → thử rào đóng cuối cùng trước, rồi rào gần nhất.
    const ends = [text.lastIndexOf('```'), text.indexOf('```', start + 1), -1].filter((e, i, arr) => (e > start || e === -1) && arr.indexOf(e) === i);
    for (const end of ends) {
      obj = tryJson(text.slice(start + 1, end > 0 ? end : undefined).trim());
      if (obj) break;
    }
  }
  if (!obj) {
    const m = /\{[\s\S]*"summary"[\s\S]*\}/.exec(text.slice(-20000));
    if (m) obj = tryJson(m[0]);
  }
  if (!obj) {
    const plain = stripProtocol(text) || text.trim();
    return { ...empty, summary: plain.length > 1500 ? `${plain.slice(0, 1500)}…` : plain };
  }
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const decision = obj.decision === 'approve' || obj.decision === 'reject' ? obj.decision : null;
  return {
    found: true,
    summary: String(obj.summary ?? '').trim(),
    decision,
    delegate: arr(obj.delegate)
      .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
      .map((d) => ({
        to: String(d.to ?? ''),
        title: String(d.title ?? 'Nhiệm vụ'),
        instructions: String(d.instructions ?? ''),
        priority: (['low', 'normal', 'high', 'critical'].includes(String(d.priority)) ? d.priority : 'normal') as TaskPriority,
        permission: (['read', 'write', 'auto', 'full'].includes(String(d.permission)) ? d.permission : undefined) as PermissionLevel | undefined,
        step: d.step ? String(d.step).slice(0, 20) : undefined,
        after: Array.isArray(d.after) && d.after.length ? d.after.map(String).filter(Boolean).slice(0, 8) : undefined,
      }))
      .filter((d) => d.to && d.instructions),
    artifacts: arr(obj.artifacts)
      .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
      .map((d) => ({
        title: String(d.title ?? 'Tài liệu'),
        type: (['document', 'plan', 'design', 'code', 'report', 'other'].includes(String(d.type)) ? d.type : 'document') as ArtifactType,
        content: String(d.content ?? ''),
      }))
      .filter((d) => d.content),
    files: arr(obj.files)
      .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
      .map((d) => ({ path: String(d.path ?? ''), content: String(d.content ?? '') }))
      .filter((f) => f.path),
    extras: parseExtras(obj),
  };
}

/** Bỏ khối jv-result khỏi văn bản hiển thị. */
export function stripProtocol(text: string): string {
  const i = text.lastIndexOf('```jv-result');
  return (i >= 0 ? text.slice(0, i) : text).trim();
}

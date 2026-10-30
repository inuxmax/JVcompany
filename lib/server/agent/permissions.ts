// Kiểm tra quyền và luồng phê duyệt của người dùng cho các thao tác nhạy cảm.
import path from 'path';
import type { ApprovalType } from '../../types';
import { createApproval, getApproval, getTask, resolveApproval, updateTask } from '../repo';
import { CancelledError } from './errors';
import type { AgentContext } from './context';
import { sysMsg, type LocalizedText } from '../../i18n/format';

export interface PermissionRequest {
  type: ApprovalType;
  title: string;
  detail: string;
  /** Khoá dịch cho thẻ phê duyệt (xem titled()). */
  titleI18n?: LocalizedText;
  detailI18n?: LocalizedText;
  payload: Record<string, unknown>;
  /** Thao tác nằm trong thư mục dự án. */
  inside: boolean;
  /** Lệnh shell chỉ đọc (ls, cat, git status…) – được chạy cả ở chế độ chỉ đọc. */
  readOnly?: boolean;
}

type Verdict = 'allow' | 'ask' | { deny: string };

const READ_ONLY_CMDS = new Set([
  'ls', 'dir', 'cat', 'type', 'head', 'tail', 'wc', 'grep', 'rg', 'find', 'tree', 'pwd', 'echo', 'which', 'where', 'stat', 'file', 'du', 'df', 'sort', 'cut',
  'get-content', 'gc', 'get-childitem', 'gci', 'select-string', 'sls', 'test-path', 'get-item', 'gi', 'get-location', 'resolve-path', 'measure-object', 'select-object', 'format-list', 'format-table', 'write-output', 'out-string',
]);
const READ_ONLY_GIT = /^(status|log|diff|show|rev-parse|ls-files|blame|describe|shortlog|grep)\b/;
/** Công cụ tra bản đồ mã của văn phòng (chỉ đọc graph.json): node "<app>/scripts/jv-graph.cjs" … */
const GRAPH_CLI = path.join(process.cwd(), 'scripts', 'jv-graph.cjs').replace(/\\/g, '/').toLowerCase();
const isGraphQuery = (part: string) => {
  const m = /^node(?:\.exe)?\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i.exec(part);
  return Boolean(m && (m[1] ?? m[2] ?? m[3]).replace(/\\/g, '/').toLowerCase() === GRAPH_CLI);
};
/** Cờ khiến một lệnh "xem" ghi tệp hoặc chạy chương trình khác. */
const UNSAFE_FLAGS: Record<string, RegExp> = {
  rg: /--pre(-glob)?\b/,
  sort: /(^|\s)(-o|--output)\b/,
  find: /\s-(delete|exec|execdir|ok|okdir|fprint0?|fprintf|fls)\b/,
  git: /--output\b|(^|\s)-O|--open-files-in-pager|--ext-diff|--textconv/,
};

/**
 * Lệnh shell chỉ đọc: mọi đoạn (tách bởi ; && || |) bắt đầu bằng lệnh xem/tìm kiếm, không ghi ra tệp (> >>), không chạy
 * lệnh con (xuống dòng, & đơn, `…`, $(…), <(…), ngoặc), trừ chuyển hướng lỗi vào thùng rác (2>/dev/null, 2>$null).
 * Cho phép "cd"/"Set-Location" để đổi thư mục.
 */
export function isReadOnlyCommand(command: string): boolean {
  const cmd = command.trim().replace(/\d?>\s*(\/dev\/null|\$null|nul)\b/gi, '');
  if (!cmd || /[\r\n]|>|`|\$\(|<\(|[(){}]|@\(/.test(cmd)) return false;
  // "&" đơn (chạy nền / gọi lệnh trong PowerShell) – "&&" vẫn được
  if (/(^|[^&])&(?!&)/.test(cmd)) return false;
  const parts = cmd.split(/;|&&|\|\||\|/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return false;
  return parts.every((p) => {
    if (isGraphQuery(p)) return true;
    const [head, ...rest] = p.split(/\s+/);
    const h = head.toLowerCase().replace(/^\.[\\/]|\.exe$/g, '');
    const args = rest.join(' ');
    if (h === 'cd' || h === 'set-location' || h === 'sl' || h === 'chdir') return true;
    if (UNSAFE_FLAGS[h]?.test(` ${args}`)) return false;
    if (h === 'git') {
      // branch / remote chỉ khi xem danh sách
      if (/^(branch|remote)\b/.test(args)) return /^(branch|remote)(\s+(-a|-r|-v|-vv|--list|--all|--remotes|--verbose|--show-current))*\s*$/.test(args);
      return READ_ONLY_GIT.test(args);
    }
    return READ_ONLY_CMDS.has(h);
  });
}

function decide(ctx: AgentContext, req: PermissionRequest): Verdict {
  const level = ctx.permission;
  switch (req.type) {
    case 'read':
      if (req.inside || level === 'full') return 'allow';
      return 'ask';
    case 'write':
      if (level === 'read') return { deny: 'Dự án đang ở chế độ CHỈ ĐỌC – không được ghi tệp.' };
      if (req.inside || level === 'full') return 'allow';
      return 'ask';
    case 'shell':
      // Lệnh chỉ xem/tìm kiếm trong dự án: chạy luôn ở mọi mức quyền
      if (req.readOnly && req.inside) return 'allow';
      if (level === 'read')
        return req.readOnly
          ? 'allow'
          : { deny: 'Nhiệm vụ này chỉ có quyền CHỈ ĐỌC – chỉ chạy được lệnh xem/tìm kiếm (ls, cat, git status…). Nếu thật sự cần chạy lệnh này, ghi rõ lệnh và lý do trong kết quả để chủ công ty nâng quyền.' };
      if (level === 'full') return 'allow';
      if (level === 'auto' && req.inside) return 'allow';
      return 'ask';
    case 'computer':
      if (!ctx.settings.computerControl)
        return { deny: 'Tính năng "Điều khiển máy tính" đang tắt trong Cài đặt. Hãy dùng công cụ khác hoặc đề nghị người dùng bật.' };
      if (level === 'read') return { deny: 'Dự án đang ở chế độ CHỈ ĐỌC – không được điều khiển máy tính.' };
      if (level === 'full') return 'allow';
      return 'ask';
    default:
      return 'ask';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** title + khoá dịch cho thẻ phê duyệt: ...titled(sysMsg('Chạy lệnh: {cmd}', { cmd })). */
export function titled(msg: ReturnType<typeof sysMsg>): { title: string; titleI18n: LocalizedText } {
  return { title: msg.content, titleI18n: msg.i18n };
}

/** detail + khoá dịch cho thẻ phê duyệt. */
export function detailed(msg: ReturnType<typeof sysMsg>): { detail: string; detailI18n: LocalizedText } {
  return { detail: msg.content, detailI18n: msg.i18n };
}

/** Trả về null nếu được phép, hoặc chuỗi lý do bị từ chối. */
export async function requestPermission(ctx: AgentContext, req: PermissionRequest): Promise<string | null> {
  const verdict = decide(ctx, req);
  if (verdict === 'allow') return null;
  if (typeof verdict === 'object') return verdict.deny;

  const fresh = await getTask(ctx.task._id);
  if (fresh?.autoApprove) return null;

  const approval = await createApproval({
    projectId: ctx.project._id,
    taskId: ctx.task._id,
    departmentId: ctx.department._id,
    type: req.type,
    title: req.title,
    detail: req.detail,
    ...(req.titleI18n ? { titleI18n: req.titleI18n } : {}),
    ...(req.detailI18n ? { detailI18n: req.detailI18n } : {}),
    payload: req.payload,
  });
  await updateTask(ctx.task._id, { status: 'waiting_approval' });
  await ctx.log('approval', `Xin phê duyệt: ${req.title}`, { approvalId: approval._id, type: req.type, detail: req.detail });

  const deadline = Date.now() + ctx.settings.approvalTimeoutMinutes * 60_000;
  try {
    while (Date.now() < deadline) {
      if (ctx.signal.aborted) throw new CancelledError();
      const a = await getApproval(approval._id);
      if (a && a.status !== 'pending') {
        if (a.status === 'approved') {
          if (a.scope === 'task') await updateTask(ctx.task._id, { autoApprove: true }, true);
          return null;
        }
        return `Người dùng đã TỪ CHỐI thao tác này${a.note ? `: ${a.note}` : ''}. Hãy chọn cách khác hoặc báo cáo lại.`;
      }
      await sleep(1500);
    }
    await resolveApproval(approval._id, 'expired');
    return 'Hết thời gian chờ phê duyệt. Thao tác không được thực hiện.';
  } finally {
    const t = await getTask(ctx.task._id);
    if (t?.status === 'waiting_approval') await updateTask(ctx.task._id, { status: 'running' });
  }
}

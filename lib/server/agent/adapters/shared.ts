// Tiện ích dùng chung cho các bộ kết nối CLI: môi trường, nhận diện lỗi, đọc JSON an toàn.
import fs from 'fs/promises';
import path from 'path';
import type { Effort, EnvCheck, PermissionLevel, Provider } from '../../../types';
import type { LocalizedText } from '../../../i18n/format';
import { getPreset } from '../../../catalog';
import { appDataDir, runProcess, which } from '../../platform';

/** CLI con không kế thừa dấu vết của phiên Claude Code / Agent SDK đang chạy server (để dùng đúng tài khoản đăng ký của bạn). */
export const CHILD_ENV: Record<string, string | undefined> = {
  CLAUDECODE: undefined,
  CLAUDE_CODE_ENTRYPOINT: undefined,
  CLAUDE_CODE_SESSION: undefined,
  CLAUDE_CODE_PARENT_SESSION: undefined,
  CLAUDE_AGENT_SDK_VERSION: undefined,
  NO_COLOR: '1',
  FORCE_COLOR: '0',
};

/** "Lệnh giả" (vd copilot-shim của VS Code) thoát mã 0 nhưng báo chưa cài CLI thật. */
export const NOT_INSTALLED = /\b(was not found|not installed|command not found|is not recognized)\b/i;

/** Chưa đăng nhập / sai key. */
export const AUTH_RE =
  /(not logged in|please (?:run )?\S*\s*login|log ?in required|authentication (?:required|failed)|failed to authenticate|invalid api key|invalid x-api-key|unauthori[sz]ed|\b401\b|no credentials|missing (?:api key|credentials|bearer)|oauth token (?:has )?expired|refresh token|invalid_grant|run `?\w+ (?:auth )?login`?)/i;

/** Hết tiền / hạn mức (kể cả khi CLI báo kèm "Failed to authenticate", vd token trung gian "token quota is not enough"). */
export const QUOTA_RE = /(quota|usage limit|limit reached|insufficient (?:balance|credit|funds)|credit balance|out of (?:credits|tokens))/i;

/** Tài khoản không được dùng mô hình đã chọn (vd 403 "This token has no access to model …"). */
export const MODEL_ACCESS_RE = /(no access to model|model[^\n]{0,40}(?:not found|not available|does not exist|is not supported)|invalid model|unknown model|model_not_found)/i;

/** Cảnh báo CLI in ra stderr cả khi chạy thành công – không phải nguyên nhân lỗi. */
const STDERR_NOISE_RE = /claude\.ai connectors are disabled|^\s*(?:\(node:\d+\) )?\[?DEP\d+|ExperimentalWarning|punycode/i;

export function cleanStderr(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim() && !STDERR_NOISE_RE.test(l))
    .join('\n')
    .trim();
}

export function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Chữ trong nội dung tin nhắn dạng chuỗi hoặc mảng khối [{type:'text', text}]. */
export function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return str(obj(content).text);
  return content
    .map((b) => obj(b))
    .filter((b) => b.type === 'text' || b.type === 'output_text')
    .map((b) => str(b.text))
    .join('');
}

/** Thông báo lỗi từ chuỗi hoặc object {message|error|detail|code}. */
export function errorText(v: unknown): string {
  if (typeof v === 'string') return v;
  const o = obj(v);
  const m = str(o.message) || str(o.error) || str(o.detail) || str(o.code) || str(obj(o.data).message);
  if (m) return m;
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

/** Mô tả ngắn một lần gọi công cụ để hiện trong nhật ký (vd "Read `src/a.ts`"). */
const TOOL_VERB: Record<string, string> = {
  read: 'Đọc',
  read_file: 'Đọc',
  readfile: 'Đọc',
  view: 'Đọc',
  edit: 'Sửa',
  multiedit: 'Sửa',
  str_replace: 'Sửa',
  str_replace_editor: 'Sửa',
  notebookedit: 'Sửa',
  write: 'Viết',
  write_file: 'Viết',
  create: 'Tạo',
  grep: 'Tìm',
  search: 'Tìm',
  glob: 'Tìm tệp',
  ls: 'Xem thư mục',
  list_dir: 'Xem thư mục',
  webfetch: 'Đọc web',
  websearch: 'Tìm web',
  task: 'Giao việc phụ',
};

/** Đường dẫn ngắn (2–3 đoạn cuối) để hiện dưới tên nhân viên / trong nhật ký. */
function shortPath(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : parts.join('/');
}

/** Dòng mã đầu tiên có nội dung (để biết đang sửa đoạn nào). */
function firstCodeLine(v: unknown): string {
  const line = String(v ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 2);
  return line ? (line.length > 70 ? `${line.slice(0, 70)}…` : line) : '';
}

/** Mô tả ngắn một lần gọi công cụ để hiện trong nhật ký và dưới tên nhân viên (vd "Sửa `…/app/page.tsx` → `const x = 1`"). */
export function describeTool(name: string, input: Record<string, unknown>): string {
  const key = name.toLowerCase();
  const verb = TOOL_VERB[key] ?? name;
  // Danh sách việc cần làm của agent → việc đang làm
  if (key === 'todowrite' && Array.isArray(input.todos)) {
    const todos = input.todos as { content?: string; status?: string; activeForm?: string }[];
    const cur = todos.find((t) => t.status === 'in_progress');
    const done = todos.filter((t) => t.status === 'completed').length;
    return cur ? `Đang làm (${done}/${todos.length}): ${cur.activeForm || cur.content}` : `Lập danh sách ${todos.length} việc cần làm`;
  }
  const p = (input.file_path ?? input.path ?? input.notebook_path ?? input.filePath ?? input.target_file) as string | undefined;
  const cmd = (input.command ?? input.cmd) as string | string[] | undefined;
  if (cmd) {
    const text = (Array.isArray(cmd) ? cmd.join(' ') : String(cmd)).slice(0, 200);
    return typeof input.description === 'string' && input.description ? `Chạy lệnh: ${input.description} – \`$ ${text}\`` : `\`$ ${text}\``;
  }
  if (p) {
    const edit = input.new_string ?? input.new_str ?? input.content ?? (Array.isArray(input.edits) ? (input.edits as { new_string?: string }[])[0]?.new_string : undefined);
    const code = verb === 'Sửa' || verb === 'Viết' || verb === 'Tạo' ? firstCodeLine(edit) : '';
    return `${verb} \`${shortPath(String(p))}\`${code ? ` → \`${code}\`` : ''}`;
  }
  if (input.pattern) return `${verb} "${String(input.pattern)}"`;
  if (input.url) return `${verb} ${String(input.url)}`;
  if (input.query) return `${verb} "${String(input.query).slice(0, 120)}"`;
  return verb;
}

/** Lệnh thật của kết nối: lệnh đã nhập → lệnh mặc định → lệnh dự phòng. */
export function resolveCommand(provider: Provider): { command: string; path: string | null } {
  const preset = getPreset(provider.type);
  const candidates = provider.command ? [provider.command] : [preset.command ?? '', ...(preset.altCommands ?? [])];
  for (const c of candidates.filter(Boolean)) {
    const p = which(c);
    if (p) return { command: c, path: p };
  }
  return { command: candidates[0] ?? '', path: null };
}

/** Đổi mức effort của phòng ban sang thang của từng CLI. */
export function effortFor(effort: Effort | undefined, scale: 'claude' | 'codex' | 'pi' | 'kimi' | 'grok'): string {
  if (!effort) return '';
  switch (scale) {
    case 'claude':
      return effort;
    case 'codex':
      return effort === 'xhigh' || effort === 'max' ? 'high' : effort;
    case 'pi':
      return effort === 'max' ? 'xhigh' : effort;
    case 'kimi':
      return effort === 'medium' ? 'high' : effort === 'xhigh' ? 'max' : effort;
    case 'grok':
      return effort === 'xhigh' || effort === 'max' ? 'high' : effort;
  }
}

export function isRead(level: PermissionLevel): boolean {
  return level === 'read';
}

/** Thư mục riêng trong dữ liệu ứng dụng (vd CODEX_HOME riêng cho chế độ API key). */
export async function privateDir(...parts: string[]): Promise<string> {
  const dir = path.join(appDataDir(), ...parts);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** Chạy `<lệnh> <args>` và trả về các dòng stdout (dùng để tải danh sách model). */
export async function commandLines(command: string, args: string[], env: Record<string, string | undefined> = CHILD_ENV): Promise<string[]> {
  const resolved = which(command);
  if (!resolved) return [];
  const r = await runProcess(resolved, args, { timeoutMs: 30_000, env });
  if (r.code !== 0) return [];
  return r.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Tham số tuỳ chọn của kết nối (ô cấu hình riêng). */
export function opt(provider: Provider, key: string): string | number | boolean | undefined {
  const v = provider.options?.[key];
  if (v !== undefined && v !== '') return v;
  return getPreset(provider.type).fields?.find((f) => f.key === key)?.default;
}

export function optNum(provider: Provider, key: string): number {
  const v = Number(opt(provider, key));
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

export function optStr(provider: Provider, key: string): string {
  const v = opt(provider, key);
  return typeof v === 'string' ? v.trim() : v === undefined ? '' : String(v);
}

/** Câu của một mục kiểm tra: kết quả sysMsg() (tiếng Việt + khoá dịch) hoặc chữ thô (lỗi từ CLI/API, hướng dẫn trong preset). */
export type CheckText = string | Phrase;
type Phrase = { content: string; i18n?: LocalizedText };

/** Một mục "Kiểm tra môi trường": lưu câu tiếng Việt (`message`/`hint`) kèm khoá dịch (`i18n`/`hintI18n`) để giao diện dịch lúc hiển thị. */
export function envCheck(code: string, level: EnvCheck['level'], message: CheckText, extra: { detail?: string; hint?: CheckText } = {}): EnvCheck {
  const msg: Phrase = typeof message === 'string' ? { content: message } : message;
  const hint: Phrase | undefined = typeof extra.hint === 'string' ? { content: extra.hint } : extra.hint;
  return {
    code,
    level,
    message: msg.content,
    ...(msg.i18n ? { i18n: msg.i18n } : {}),
    ...(extra.detail !== undefined ? { detail: extra.detail } : {}),
    ...(hint ? { hint: hint.content, ...(hint.i18n ? { hintI18n: hint.i18n } : {}) } : {}),
  };
}

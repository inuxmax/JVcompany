// Điền biến vào câu dịch: "{name}" và số nhiều kiểu ICU "{n, plural, one {# việc} other {# việc}}".
import type { Locale } from './locales';

export type Vars = Record<string, string | number | null | undefined>;
/** Từ điển của một ngôn ngữ: câu tiếng Việt gốc → câu dịch. */
export type Dict = Record<string, string>;

const pluralRules = new Map<string, Intl.PluralRules>();

function pluralCategory(locale: string, n: number): string {
  let pr = pluralRules.get(locale);
  if (!pr) {
    try {
      pr = new Intl.PluralRules(locale);
    } catch {
      pr = new Intl.PluralRules('en');
    }
    pluralRules.set(locale, pr);
  }
  return pr.select(n);
}

/** Tìm dấu '}' khớp với '{' tại vị trí start. */
function matchBrace(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

function selectPlural(body: string, n: number, locale: string, vars: Vars): string {
  const options: Record<string, string> = {};
  let i = 0;
  while (i < body.length) {
    const m = /^\s*(=\d+|zero|one|two|few|many|other)\s*\{/.exec(body.slice(i));
    if (!m) break;
    const open = i + m[0].length - 1;
    const close = matchBrace(body, open);
    if (close < 0) break;
    options[m[1]] = body.slice(open + 1, close);
    i = close + 1;
  }
  const chosen = options[`=${n}`] ?? options[pluralCategory(locale, n)] ?? options.other ?? '';
  return interpolate(chosen.replace(/#/g, String(n)), vars, locale);
}

export function interpolate(template: string, vars: Vars | undefined, locale: string): string {
  if (!vars || !template.includes('{')) return template;
  let out = '';
  let i = 0;
  while (i < template.length) {
    const open = template.indexOf('{', i);
    if (open < 0) break;
    out += template.slice(i, open);
    const close = matchBrace(template, open);
    if (close < 0) {
      i = open;
      break;
    }
    const inner = template.slice(open + 1, close);
    const plural = /^\s*(\w+)\s*,\s*plural\s*,([\s\S]*)$/.exec(inner);
    if (plural && plural[1] in vars) {
      out += selectPlural(plural[2], Number(vars[plural[1]]) || 0, locale, vars);
    } else if (/^\w+$/.test(inner) && inner in vars) {
      out += String(vars[inner] ?? '');
    } else {
      // Không phải biến (vd JSON mẫu) → giữ nguyên
      out += template.slice(open, close + 1);
    }
    i = close + 1;
  }
  return out + template.slice(i);
}

export function translate(dict: Dict, locale: Locale | string, key: string, vars?: Vars): string {
  return interpolate(dict[key] ?? key, vars, locale);
}

/** Nội dung tin nhắn do máy chủ tạo, kèm khoá dịch để giao diện hiện theo ngôn ngữ của người xem. */
export interface LocalizedText {
  key: string;
  vars?: Vars;
}

/**
 * Tạo tin nhắn hệ thống dịch được: lưu `content` bằng tiếng Việt gốc (cho agent & bản cũ) và `meta.i18n` để giao diện dịch lúc hiển thị.
 * sysMsg('✅ Giai đoạn **{phase}** đã được phê duyệt.', { phase: phase.name })
 */
export function sysMsg(key: string, vars?: Vars): { content: string; i18n: LocalizedText } {
  return { content: interpolate(key, vars, 'vi'), i18n: vars ? { key, vars } : { key } };
}

/** Trường `content` + `meta` cho postMessage từ một sysMsg (giữ meta sẵn có). */
export function noteContent(msg: ReturnType<typeof sysMsg>, meta?: Record<string, unknown>): { content: string; meta: Record<string, unknown> } {
  return { content: msg.content, meta: { ...meta, i18n: msg.i18n } };
}

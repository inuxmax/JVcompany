// Phân loại lỗi từ nhà cung cấp AI: hết hạn mức (tự chạy lại), lỗi tạm thời, lỗi cố định.

export class LimitError extends Error {
  resetAt: Date | null;
  constructor(message: string, resetAt: Date | null = null) {
    super(message);
    this.name = 'LimitError';
    this.resetAt = resetAt;
  }
}

export class ProviderError extends Error {
  retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.name = 'ProviderError';
    this.retryable = retryable;
  }
}

export class CancelledError extends Error {
  constructor() {
    super('Nhiệm vụ đã bị hủy');
    this.name = 'CancelledError';
  }
}

const LIMIT_RE =
  /(usage limit|rate[ _-]?limit|limit (?:has been )?reached|hit your (?:usage )?limit|reached your (?:usage )?limit|too many requests|quota|resource[_ ]exhausted|\b429\b|out of (?:credits|tokens)|credit balance|exceeded your current|limit will reset|resets? (?:at|in)|try again (?:at|in|later))/i;

const TRANSIENT_RE = /(overloaded|\b5\d\d\b|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network error|fetch failed|temporarily unavailable|service unavailable)/i;

export function looksLikeLimit(text: string): boolean {
  return LIMIT_RE.test(text);
}

export function looksTransient(text: string): boolean {
  return TRANSIENT_RE.test(text);
}

/** Cố gắng đọc thời điểm reset hạn mức từ thông báo lỗi. */
export function parseResetTime(text: string, nowDate = new Date()): Date | null {
  // "Claude AI usage limit reached|1730851200"
  const unix = /\|(\d{10})\b/.exec(text) ?? /reset[^\d]{0,20}(\d{10})\b/i.exec(text);
  if (unix) {
    const d = new Date(Number(unix[1]) * 1000);
    if (d > nowDate) return d;
  }
  // ISO 8601
  const iso = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)/.exec(text);
  if (iso) {
    const d = new Date(iso[1]);
    if (!Number.isNaN(d.getTime()) && d > nowDate) return d;
  }
  // "try again in 2h 30m", "resets in 45 minutes", "retry after 30 seconds"
  const rel = /(?:in|after)\s+((?:\d+(?:\.\d+)?\s*(?:h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)\s*)+)/i.exec(text);
  if (rel) {
    let ms = 0;
    const re = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rel[1]))) {
      const v = Number(m[1]);
      const u = m[2].toLowerCase();
      ms += u.startsWith('h') ? v * 3600_000 : u.startsWith('m') ? v * 60_000 : v * 1000;
    }
    if (ms > 0) return new Date(nowDate.getTime() + ms);
  }
  // "resets 3pm", "resets at 15:30", "available again at 5:00 PM"
  const clock = /(?:resets?|again)\s*(?:at|by)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (clock) {
    let h = Number(clock[1]);
    const min = Number(clock[2] ?? 0);
    const ap = clock[3]?.toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h < 24 && min < 60) {
      const d = new Date(nowDate);
      d.setHours(h, min, 0, 0);
      if (d <= nowDate) d.setDate(d.getDate() + 1);
      return d;
    }
  }
  return null;
}

/** Đọc header retry-after (giây hoặc ngày HTTP) / dạng "6m0s" của OpenAI. */
export function parseRetryHeaders(headers: Headers | undefined | null): Date | null {
  if (!headers) return null;
  const now = Date.now();
  const ra = headers.get('retry-after');
  if (ra) {
    const secs = Number(ra);
    if (Number.isFinite(secs)) return new Date(now + secs * 1000);
    const d = new Date(ra);
    if (!Number.isNaN(d.getTime())) return d;
  }
  for (const h of ['anthropic-ratelimit-requests-reset', 'anthropic-ratelimit-tokens-reset', 'anthropic-ratelimit-input-tokens-reset']) {
    const v = headers.get(h);
    if (v) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  for (const h of ['x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens']) {
    const v = headers.get(h);
    if (v) {
      let ms = 0;
      const re = /(\d+(?:\.\d+)?)(ms|s|m|h)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(v))) {
        const n = Number(m[1]);
        ms += m[2] === 'h' ? n * 3600_000 : m[2] === 'm' ? n * 60_000 : m[2] === 's' ? n * 1000 : n;
      }
      if (ms > 0) return new Date(now + ms);
    }
  }
  return null;
}

/** Thời gian chờ lùi dần (phút) cho lần thử thứ `attempt`. */
export function backoffMinutes(attempt: number, base: number, max: number): number {
  return Math.min(max, base * Math.pow(2, Math.max(0, attempt - 1)));
}

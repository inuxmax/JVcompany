// So sánh hai văn bản theo dòng (LCS) – dùng để xem khác biệt giữa các phiên bản tài liệu.

export interface DiffLine {
  type: 'same' | 'add' | 'del';
  text: string;
}

const MAX_LINES = 4000;

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  // Tài liệu quá dài: chỉ so phần đầu/cuối giống nhau, phần giữa coi như thay toàn bộ
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    let s = 0;
    while (s < a.length && s < b.length && a[s] === b[s]) s++;
    let e = 0;
    while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
    return [
      ...a.slice(0, s).map((text) => ({ type: 'same' as const, text })),
      ...a.slice(s, a.length - e).map((text) => ({ type: 'del' as const, text })),
      ...b.slice(s, b.length - e).map((text) => ({ type: 'add' as const, text })),
      ...a.slice(a.length - e).map((text) => ({ type: 'same' as const, text })),
    ];
  }
  const n = a.length;
  const m = b.length;
  // dp[i][j] = độ dài LCS của a[i..] và b[j..]
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ type: 'del', text: a[i++] });
    else out.push({ type: 'add', text: b[j++] });
  }
  while (i < n) out.push({ type: 'del', text: a[i++] });
  while (j < m) out.push({ type: 'add', text: b[j++] });
  return out;
}

/** Số dòng thêm / bớt. */
export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  return { added: lines.filter((l) => l.type === 'add').length, removed: lines.filter((l) => l.type === 'del').length };
}

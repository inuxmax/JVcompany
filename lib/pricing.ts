// Bảng giá tham khảo (USD / 1 triệu token) để ƯỚC TÍNH chi phí khi API không trả về giá (DeepSeek, OpenAI, Anthropic API…).
// CLI (Claude Code, Codex…) tự báo chi phí nên không dùng bảng này. Giá có thể đổi – đây chỉ là ước tính.

interface Price {
  input: number;
  output: number;
  /** Giá token đọc từ cache (để trống = 10% giá input). */
  cached?: number;
}

/** Mẫu tên model → giá. Thứ tự quan trọng: mẫu cụ thể đứng trước. */
const TABLE: [RegExp, Price][] = [
  // Anthropic
  [/fable-5-1|mythos-5-1/, { input: 10, output: 50, cached: 0.25 }],
  [/fable|mythos/, { input: 10, output: 50, cached: 1 }],
  [/opus-5-5/, { input: 4, output: 20, cached: 0.2 }],
  [/opus-(5|4-[5-9])/, { input: 5, output: 25, cached: 0.5 }],
  [/opus/, { input: 15, output: 75, cached: 1.5 }],
  [/sonnet-5/, { input: 2, output: 10, cached: 0.2 }],
  [/sonnet/, { input: 3, output: 15, cached: 0.3 }],
  [/haiku-5/, { input: 0.1, output: 0.5, cached: 0.01 }],
  [/haiku-4/, { input: 1, output: 5, cached: 0.1 }],
  [/haiku/, { input: 0.8, output: 4, cached: 0.08 }],
  // DeepSeek
  [/deepseek/, { input: 0.28, output: 0.42, cached: 0.028 }],
  // OpenAI
  [/gpt-5.*nano/, { input: 0.05, output: 0.4, cached: 0.005 }],
  [/gpt-5.*mini/, { input: 0.25, output: 2, cached: 0.025 }],
  [/gpt-5/, { input: 1.25, output: 10, cached: 0.125 }],
  [/gpt-4\.1.*nano/, { input: 0.1, output: 0.4 }],
  [/gpt-4\.1.*mini/, { input: 0.4, output: 1.6 }],
  [/gpt-4\.1/, { input: 2, output: 8 }],
  [/gpt-4o.*mini/, { input: 0.15, output: 0.6 }],
  [/gpt-4o/, { input: 2.5, output: 10 }],
  [/o4-mini|o3-mini/, { input: 1.1, output: 4.4 }],
  [/\bo3\b/, { input: 2, output: 8 }],
  // Google
  [/gemini.*flash-lite/, { input: 0.1, output: 0.4 }],
  [/gemini.*flash/, { input: 0.3, output: 2.5 }],
  [/gemini.*pro/, { input: 1.25, output: 10 }],
  // xAI
  [/grok-code/, { input: 0.2, output: 1.5 }],
  [/grok/, { input: 3, output: 15 }],
];

export function priceOf(model?: string | null): Price | null {
  const m = (model ?? '').toLowerCase();
  if (!m) return null;
  return TABLE.find(([re]) => re.test(m))?.[1] ?? null;
}

/**
 * Chi phí ước tính của một lượt. `inputTokens` đã gồm token cache (như các adapter ghi);
 * null = không có giá cho model này.
 */
export function estimateCost(model: string | null | undefined, u: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number }): number | null {
  const p = priceOf(model);
  if (!p) return null;
  const cached = Math.min(u.cachedInputTokens ?? 0, u.inputTokens ?? 0);
  const fresh = Math.max(0, (u.inputTokens ?? 0) - cached);
  return (fresh * p.input + cached * (p.cached ?? p.input * 0.1) + (u.outputTokens ?? 0) * p.output) / 1_000_000;
}

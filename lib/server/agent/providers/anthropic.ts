// Agent chạy trên Claude API (Anthropic SDK) với vòng lặp công cụ thủ công.
import Anthropic from '@anthropic-ai/sdk';
import type { Provider } from '../../../types';
import type { AgentContext, AgentOutcome } from '../context';
import { buildTools, executeTool } from '../tools';
import { buildSystemPrompt, buildTaskPrompt } from '../prompts';
import { loadImages } from '../../attachments';
import { CancelledError, LimitError, ProviderError, looksLikeLimit, parseResetTime, parseRetryHeaders } from '../errors';

/** Các model hỗ trợ fallback phía server khi bị từ chối an toàn (`fallbacks: "default"`). */
const SERVER_FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);
/** Các model nhận `output_config.effort`. */
const EFFORT_RE = /claude-(opus-(4-[5-8]|5)|fable|mythos|sonnet-(4-6|5)|haiku-5)/;

export function anthropicClient(provider: Provider): Anthropic {
  return new Anthropic({
    apiKey: provider.apiKey || undefined,
    baseURL: provider.baseUrl || undefined,
    maxRetries: 2,
  });
}

export function mapAnthropicError(err: unknown): Error {
  if (err instanceof CancelledError || err instanceof LimitError || err instanceof ProviderError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return new CancelledError();
  if (err instanceof Anthropic.RateLimitError) {
    return new LimitError(`Claude API: hết hạn mức (${err.message})`, parseRetryHeaders(err.headers) ?? parseResetTime(err.message));
  }
  if (err instanceof Anthropic.AuthenticationError) return new ProviderError('Claude API: API key không hợp lệ hoặc đã bị thu hồi.');
  if (err instanceof Anthropic.PermissionDeniedError) return new ProviderError(`Claude API: không có quyền – ${err.message}`);
  if (err instanceof Anthropic.NotFoundError) return new ProviderError(`Claude API: không tìm thấy model/tài nguyên – ${err.message}`);
  if (err instanceof Anthropic.BadRequestError) {
    if (/credit balance|billing/i.test(err.message)) return new LimitError(`Claude API: hết tín dụng – ${err.message}`);
    return new ProviderError(`Claude API: yêu cầu không hợp lệ – ${err.message}`);
  }
  if (err instanceof Anthropic.InternalServerError) return new ProviderError(`Claude API tạm lỗi/quá tải (${err.status})`, true);
  if (err instanceof Anthropic.APIConnectionError) return new ProviderError(`Không kết nối được Claude API: ${err.message}`, true);
  if (err instanceof Anthropic.APIError) {
    if (looksLikeLimit(err.message)) return new LimitError(err.message, parseResetTime(err.message));
    return new ProviderError(`Claude API lỗi ${err.status ?? ''}: ${err.message}`, (err.status ?? 0) >= 500);
  }
  return err instanceof Error ? err : new Error(String(err));
}

export async function runAnthropic(ctx: AgentContext, provider: Provider, model: string): Promise<AgentOutcome> {
  const client = anthropicClient(provider);
  const defs = buildTools(ctx);
  const tools: Anthropic.Beta.BetaTool[] = defs.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
    eager_input_streaming: true,
  }));
  const system = await buildSystemPrompt(ctx, 'tools');
  const prompt = await buildTaskPrompt(ctx, 'tools');
  const images = await loadImages(ctx.task.attachments);
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: 'user',
      content: images.length
        ? [
            ...images.map((i) => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: i.mime as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp', data: i.base64 },
            })),
            { type: 'text' as const, text: prompt },
          ]
        : prompt,
    },
  ];
  const effort = ctx.department.effort && EFFORT_RE.test(model) ? ctx.department.effort : null;
  const useFallback = SERVER_FALLBACK_MODELS.has(model) && !provider.baseUrl;

  let finalText = '';
  let jsonRetries = 0;
  const maxTurns = Math.max(3, ctx.maxTurns ?? ctx.department.maxTurns);

  for (let turn = 0; turn < maxTurns; turn++) {
    if (ctx.signal.aborted) throw new CancelledError();
    let live = '';
    let message: Anthropic.Beta.BetaMessage;
    try {
      const stream = client.beta.messages.stream(
        {
          model,
          max_tokens: 64000,
          system,
          tools,
          messages,
          cache_control: { type: 'ephemeral' },
          ...(effort ? { output_config: { effort } } : {}),
          ...(useFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        },
        { signal: ctx.signal },
      );
      stream.on('text', (delta) => {
        live += delta;
        ctx.setLive(live);
      });
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      // Tool input không parse được (eager input streaming) → thử lại lượt này tối đa 2 lần.
      if (!(err instanceof Anthropic.APIError) && !(err instanceof CancelledError) && !ctx.signal.aborted && jsonRetries++ < 2) {
        continue;
      }
      throw mapAnthropicError(err);
    } finally {
      ctx.setLive(null);
    }

    ctx.usage.inputTokens +=
      (message.usage.input_tokens ?? 0) +
      (message.usage.cache_read_input_tokens ?? 0) +
      (message.usage.cache_creation_input_tokens ?? 0);
    ctx.usage.outputTokens += message.usage.output_tokens ?? 0;
    ctx.usage.cachedInputTokens = (ctx.usage.cachedInputTokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0);

    const text = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');

    if (message.stop_reason === 'refusal') {
      throw new ProviderError('Mô hình đã từ chối thực hiện yêu cầu này (refusal). Hãy điều chỉnh nhiệm vụ hoặc đổi model.');
    }
    if (text) await ctx.log(toolUses.length ? 'thought' : 'chat', text);

    if (message.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: message.content });
      continue;
    }
    if (!toolUses.length) {
      finalText = text;
      break;
    }
    if (message.stop_reason === 'max_tokens') {
      throw new ProviderError('Đầu ra của mô hình bị cắt (max_tokens) giữa lúc gọi công cụ.', true);
    }

    messages.push({ role: 'assistant', content: message.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    let finished = false;
    for (const tu of toolUses) {
      if (ctx.signal.aborted) throw new CancelledError();
      const r = await executeTool(ctx, defs, tu.name, tu.input);
      if (r.finished) finished = true;
      results.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        is_error: r.isError || undefined,
        content: r.image
          ? [
              { type: 'text', text: r.content },
              { type: 'image', source: { type: 'base64', media_type: r.image.mediaType, data: r.image.base64 } },
            ]
          : r.content,
      });
    }
    if (finished) {
      finalText = ctx.submitted?.details || ctx.submitted?.summary || text;
      break;
    }
    messages.push({ role: 'user', content: results });
    if (turn === maxTurns - 2) {
      messages.push({
        role: 'user',
        content: 'Bạn sắp hết số lượt cho phép. Hãy hoàn tất và gọi submit_result ngay ở lượt tiếp theo.',
      });
    }
  }

  return {
    status: 'done',
    text: finalText,
    summary: ctx.submitted?.summary ?? (finalText || 'Agent dừng mà không có báo cáo.'),
    decision: ctx.submitted?.decision ?? null,
    delegations: ctx.delegations,
    artifacts: ctx.artifacts,
  };
}

export async function listAnthropicModels(provider: Provider): Promise<string[]> {
  const client = anthropicClient(provider);
  const ids: string[] = [];
  try {
    for await (const m of client.models.list({ limit: 100 }, { timeout: 20_000, maxRetries: 1 })) ids.push(m.id);
  } catch (err) {
    throw mapAnthropicError(err);
  }
  return ids;
}

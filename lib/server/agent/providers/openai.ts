// Agent chạy trên các API tương thích OpenAI (OpenAI, Gemini, Grok, DeepSeek, OpenRouter, Ollama…).
import OpenAI from 'openai';
import type { Provider } from '../../../types';
import { getPreset } from '../../../catalog';
import type { AgentContext, AgentOutcome } from '../context';
import { buildTools, executeTool } from '../tools';
import { buildSystemPrompt, buildTaskPrompt } from '../prompts';
import { loadImages } from '../../attachments';
import { CancelledError, LimitError, ProviderError, looksLikeLimit, parseResetTime, parseRetryHeaders } from '../errors';

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export function openaiClient(provider: Provider): OpenAI {
  const preset = getPreset(provider.type);
  return new OpenAI({
    apiKey: provider.apiKey || 'not-needed',
    baseURL: provider.baseUrl || preset.baseUrl,
    maxRetries: 2,
    timeout: 10 * 60 * 1000,
  });
}

export function mapOpenAIError(err: unknown, label: string): Error {
  if (err instanceof CancelledError || err instanceof LimitError || err instanceof ProviderError) return err;
  if (err instanceof OpenAI.APIUserAbortError) return new CancelledError();
  if (err instanceof OpenAI.RateLimitError) {
    return new LimitError(`${label}: hết hạn mức (${err.message})`, parseRetryHeaders(err.headers) ?? parseResetTime(err.message));
  }
  if (err instanceof OpenAI.AuthenticationError) return new ProviderError(`${label}: API key không hợp lệ.`);
  if (err instanceof OpenAI.PermissionDeniedError) return new ProviderError(`${label}: không có quyền – ${err.message}`);
  if (err instanceof OpenAI.NotFoundError) return new ProviderError(`${label}: không tìm thấy model – ${err.message}`);
  if (err instanceof OpenAI.InternalServerError) return new ProviderError(`${label} tạm lỗi (${err.status})`, true);
  if (err instanceof OpenAI.APIConnectionError) return new ProviderError(`Không kết nối được ${label}: ${err.message}`, true);
  if (err instanceof OpenAI.APIError) {
    if (looksLikeLimit(err.message)) return new LimitError(`${label}: ${err.message}`, parseResetTime(err.message));
    return new ProviderError(`${label} lỗi ${err.status ?? ''}: ${err.message}`, (err.status ?? 0) >= 500);
  }
  return err instanceof Error ? err : new Error(String(err));
}

/** Tin nhắn đầu: kèm ảnh nếu kết nối xem được ảnh (DeepSeek… chỉ nhận đường dẫn trong prompt). */
async function userContent(ctx: AgentContext, provider: Provider): Promise<string | OpenAI.Chat.Completions.ChatCompletionContentPart[]> {
  const prompt = await buildTaskPrompt(ctx, 'tools');
  const images = getPreset(provider.type).vision ? await loadImages(ctx.task.attachments) : [];
  if (!images.length) return prompt;
  return [{ type: 'text', text: prompt }, ...images.map((i) => ({ type: 'image_url' as const, image_url: { url: `data:${i.mime};base64,${i.base64}` } }))];
}

export async function runOpenAI(ctx: AgentContext, provider: Provider, model: string): Promise<AgentOutcome> {
  if (!model) throw new ProviderError(`Chưa chọn model cho kết nối "${provider.name}".`);
  const client = openaiClient(provider);
  const defs = buildTools(ctx);
  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = defs.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
  const messages: Msg[] = [
    { role: 'system', content: await buildSystemPrompt(ctx, 'tools') },
    { role: 'user', content: await userContent(ctx, provider) },
  ];
  let finalText = '';
  const maxTurns = Math.max(3, ctx.maxTurns ?? ctx.department.maxTurns);

  for (let turn = 0; turn < maxTurns; turn++) {
    if (ctx.signal.aborted) throw new CancelledError();
    let completion: OpenAI.Chat.Completions.ChatCompletion;
    try {
      // Stream để chữ hiện trực tiếp trong khung chat khi model đang viết.
      const stream = client.chat.completions.stream({ model, messages, tools, stream_options: { include_usage: true } }, { signal: ctx.signal });
      stream.on('content', (_delta, snapshot) => ctx.setLive(snapshot));
      completion = await stream.finalChatCompletion();
    } catch (err) {
      throw mapOpenAIError(err, provider.name);
    } finally {
      ctx.setLive(null);
    }
    ctx.usage.inputTokens += completion.usage?.prompt_tokens ?? 0;
    ctx.usage.outputTokens += completion.usage?.completion_tokens ?? 0;
    // Token đọc từ cache (OpenAI: prompt_tokens_details.cached_tokens; DeepSeek: prompt_cache_hit_tokens) – để ước tính giá
    const cacheHit = completion.usage?.prompt_tokens_details?.cached_tokens ?? (completion.usage as { prompt_cache_hit_tokens?: number } | undefined)?.prompt_cache_hit_tokens ?? 0;
    ctx.usage.cachedInputTokens = (ctx.usage.cachedInputTokens ?? 0) + cacheHit;
    const choice = completion.choices[0];
    if (!choice) throw new ProviderError(`${provider.name}: phản hồi rỗng`, true);
    const msg = choice.message;
    const text = (msg.content ?? '').trim();
    const calls = (msg.tool_calls ?? []).filter(
      (c): c is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => c.type === 'function',
    );
    if (text) await ctx.log(calls.length ? 'thought' : 'chat', text);
    if (!calls.length) {
      if (choice.finish_reason === 'length') throw new ProviderError('Đầu ra bị cắt do giới hạn độ dài.', true);
      finalText = text;
      break;
    }
    messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: calls });
    const images: string[] = [];
    let finished = false;
    for (const call of calls) {
      if (ctx.signal.aborted) throw new CancelledError();
      let input: unknown;
      try {
        input = JSON.parse(call.function.arguments || '{}');
      } catch {
        messages.push({ role: 'tool', tool_call_id: call.id, content: 'LỖI: tham số không phải JSON hợp lệ.' });
        continue;
      }
      const r = await executeTool(ctx, defs, call.function.name, input);
      if (r.finished) finished = true;
      if (r.image) images.push(r.image.base64);
      messages.push({ role: 'tool', tool_call_id: call.id, content: r.isError ? `LỖI: ${r.content}` : r.content });
    }
    if (finished) {
      finalText = ctx.submitted?.details || ctx.submitted?.summary || text;
      break;
    }
    for (const img of images) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: 'Ảnh chụp màn hình vừa chụp:' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${img}` } },
        ],
      });
    }
    if (turn === maxTurns - 2) {
      messages.push({ role: 'user', content: 'Bạn sắp hết số lượt. Hãy hoàn tất và gọi submit_result ngay.' });
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

export async function listOpenAIModels(provider: Provider): Promise<string[]> {
  const client = openaiClient(provider);
  const ids: string[] = [];
  try {
    for await (const m of client.models.list({ timeout: 20_000, maxRetries: 1 })) {
      ids.push(m.id.replace(/^models\//, ''));
      if (ids.length >= 1000) break;
    }
  } catch (err) {
    if (err instanceof OpenAI.NotFoundError) {
      throw new ProviderError(`${provider.name}: máy chủ không hỗ trợ liệt kê model (/models). Hãy tự nhập tên model.`);
    }
    throw mapOpenAIError(err, provider.name);
  }
  return ids.sort();
}

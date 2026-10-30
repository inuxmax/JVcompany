// Agent ở máy / dịch vụ khác (Hermes Gateway, OpenClaw, HTTP webhook, Cursor Cloud): gửi việc, nhận chữ hiện dần và kết quả.
import type { Provider } from '../../../types';
import type { AgentContext, AgentOutcome } from '../context';
import { buildSystemPrompt, buildTaskPrompt, stripProtocol } from '../prompts';
import { CancelledError, ProviderError } from '../errors';
import { getGateway } from '../adapters/gateways';
import { createSink, outcomeFrom } from './cli';

export async function runGateway(ctx: AgentContext, provider: Provider, model: string): Promise<AgentOutcome> {
  const gw = getGateway(provider.type);
  if (!gw) throw new ProviderError(`Chưa hỗ trợ loại kết nối "${provider.type}".`);
  const system = await buildSystemPrompt(ctx, 'cli');
  const task = await buildTaskPrompt(ctx, 'cli');
  const prompt = `${system}\n\n---\n\n${task}`;
  ctx.billing = { providerType: provider.type, model, billingType: provider.type === 'cursor-cloud' ? 'api' : 'unknown' };
  await ctx.log('system', `Gửi việc tới ${provider.name}${model ? ` (${model})` : ''}`, { provider: provider.type });

  const sink = createSink(ctx);
  let text = '';
  try {
    ({ text } = await gw.run({ ctx, provider, model, system, task, prompt, emit: sink.handle }));
  } catch (err) {
    sink.finish();
    ctx.setLive(null);
    await Promise.allSettled(sink.st.pending);
    if (ctx.signal.aborted) throw new CancelledError();
    throw err;
  }
  const hadStream = sink.st.texts.length > 0 || !sink.st.committed;
  sink.finish();
  ctx.setLive(null);
  await Promise.allSettled(sink.st.pending);
  if (ctx.signal.aborted) throw new CancelledError();
  const finalText = (text || sink.st.texts[sink.st.texts.length - 1] || '').trim();
  if (!finalText) throw new ProviderError(`${provider.name}: không nhận được kết quả.`);
  if (!hadStream) await ctx.log('thought', stripProtocol(finalText).slice(0, 8000) || '…');
  return outcomeFrom(finalText, sink.st.texts.length ? sink.st.texts : [finalText], sink.st.sessionId);
}

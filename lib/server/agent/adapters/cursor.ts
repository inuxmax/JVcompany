// Cursor CLI (`cursor-agent` / `agent`): -p --output-format stream-json, --workspace, làm tiếp bằng --resume.
import type { CliAdapter, CliEvent } from './types';
import { commandLines, contentText, describeTool, errorText, num, obj, str } from './shared';

/** Tên công cụ từ khoá kiểu { readToolCall: { args } } của Cursor. */
function toolFrom(call: Record<string, unknown>): string {
  const key = Object.keys(call).find((k) => /ToolCall$/.test(k));
  if (!key) return str(call.name) || 'tool';
  const name = key.replace(/ToolCall$/, '');
  const args = obj(obj(call[key]).args);
  return describeTool(name.charAt(0).toUpperCase() + name.slice(1), args);
}

function parser() {
  return (ev: Record<string, unknown>): CliEvent[] => {
    const out: CliEvent[] = [];
    const sid = str(ev.session_id) || str(ev.sessionId) || str(ev.chatId);
    if (sid) out.push({ kind: 'session', id: sid });
    const type = str(ev.type);
    if (type === 'system' && str(ev.model)) out.push({ kind: 'model', id: str(ev.model) });
    if (type === 'assistant') {
      const text = contentText(obj(ev.message).content ?? ev.message);
      if (text.trim()) out.push({ kind: 'text', text });
    } else if (type === 'tool_call' && str(ev.subtype) === 'started') {
      out.push({ kind: 'tool', text: toolFrom(obj(ev.tool_call)), tool: 'cursor' });
    } else if (type === 'result') {
      const u = obj(ev.usage);
      out.push({
        kind: 'usage',
        input: num(u.input_tokens) || num(u.inputTokens),
        output: num(u.output_tokens) || num(u.outputTokens),
        cached: num(u.cached_input_tokens) || num(u.cache_read_input_tokens),
        costUsd: num(ev.total_cost_usd) || num(ev.cost_usd),
      });
      const isError = ev.is_error === true || str(ev.subtype).toLowerCase() === 'error';
      if (isError) out.push({ kind: 'error', message: errorText(ev.error ?? ev.message ?? ev.result) });
      out.push({ kind: 'result', text: str(ev.result) || undefined, isError });
    } else if (type === 'error' || (type === 'system' && str(ev.subtype) === 'error')) {
      out.push({ kind: 'error', message: errorText(ev.message ?? ev.error ?? ev.detail) });
    } else if (type === 'step_finish') {
      out.push({ kind: 'usage', costUsd: num(obj(ev.part).cost) });
    }
    return out;
  };
}

export const cursorAdapter: CliAdapter = {
  type: 'cursor-agent',
  supportsResume: true,
  unknownSession: /unknown\s+(session|chat)|session\s+.*\s+not\s+found|chat\s+.*\s+not\s+found|could\s+not\s+resume/i,
  createParser: parser,
  apiKeyEnv: () => ['CURSOR_API_KEY'],
  async build({ ctx, provider, model, prompt, resume, cwd }) {
    const extra = provider.extraArgs ?? [];
    const trusted = extra.some((a) => a === '--force' || a === '--yolo' || a === '-f' || a === '--trust');
    return {
      args: [
        '-p',
        '--output-format',
        'stream-json',
        '--workspace',
        cwd,
        ...(resume ? ['--resume', resume] : []),
        '--model',
        model || 'auto',
        ...(ctx.permission === 'read' ? ['--mode', 'ask'] : trusted ? [] : ['--force']),
        ...extra,
      ],
      input: resume && ctx.task.round === 0 ? 'Tiếp tục nhiệm vụ từ chỗ đã dừng và hoàn tất. Nhớ kết thúc bằng khối jv-result.' : prompt,
    };
  },
  probe() {
    return { args: ['-p', '--mode', 'ask', '--output-format', 'stream-json'], input: 'Respond with hello.' };
  },
  async listModels(command) {
    const lines = await commandLines(command, ['models']);
    const ids = new Set<string>();
    for (const l of lines) {
      const m = /^[-*•]?\s*([a-z0-9][\w.\-/]*)(?:\s|$)/i.exec(l);
      if (m && !/^(available|models?|usage|error)/i.test(m[1])) ids.add(m[1]);
    }
    return [...ids];
  },
};

// Gemini CLI: `gemini --output-format stream-json`, prompt qua stdin (+ --prompt ngắn), làm tiếp bằng --resume.
import fs from 'fs/promises';
import path from 'path';
import type { CliAdapter, CliEvent } from './types';
import { contentText, describeTool, errorText, num, obj, opt, privateDir, str } from './shared';

/** Cộng token theo các tên trường khác nhau của Gemini (usage / usageMetadata / stats). */
function usageEvent(raw: unknown, ev: Record<string, unknown>): CliEvent | null {
  const u0 = obj(raw);
  const u = Object.keys(obj(u0.usageMetadata)).length ? obj(u0.usageMetadata) : u0;
  const input = num(u.input_tokens) || num(u.inputTokens) || num(u.promptTokenCount) || num(u.input);
  const cached = num(u.cached_input_tokens) || num(u.cachedContentTokenCount) || num(u.cached);
  const output = (num(u.output_tokens) || num(u.outputTokens) || num(u.candidatesTokenCount) || num(u.output)) + num(u.thoughtsTokenCount);
  const cost = num(ev.total_cost_usd) || num(ev.cost_usd) || num(ev.cost);
  if (!input && !output && !cost) return null;
  return { kind: 'usage', input, output, cached, costUsd: cost };
}

function parser() {
  return (ev: Record<string, unknown>): CliEvent[] => {
    const out: CliEvent[] = [];
    const sid = str(ev.session_id) || str(ev.sessionId) || str(ev.checkpoint_id);
    if (sid) out.push({ kind: 'session', id: sid });
    const type = str(ev.type);
    if (type === 'init' && str(ev.model)) out.push({ kind: 'model', id: str(ev.model) });
    if (type === 'message' && str(ev.role) === 'assistant') {
      const text = contentText(ev.content);
      if (text) out.push(ev.delta ? { kind: 'delta', text } : { kind: 'text', text });
    } else if (type === 'assistant') {
      const text = contentText(obj(ev.message).content ?? ev.message);
      if (text.trim()) out.push({ kind: 'text', text });
    } else if (type === 'text') {
      const text = str(obj(ev.part).text);
      if (text.trim()) out.push({ kind: 'text', text });
    } else if (type === 'tool_use') {
      out.push({ kind: 'tool', text: describeTool(str(ev.tool_name) || str(ev.name), obj(ev.parameters ?? ev.input)), tool: str(ev.tool_name) });
    } else if (type === 'result') {
      const u = usageEvent(ev.stats ?? ev.usage ?? ev.usageMetadata, ev);
      if (u) out.push(u);
      const status = str(ev.status).toLowerCase();
      const isError = ev.is_error === true || status === 'error' || status === 'failed';
      if (isError) out.push({ kind: 'error', message: errorText(ev.error ?? ev.message) || 'Gemini báo lỗi' });
      const text = str(ev.result) || str(ev.response);
      out.push({ kind: 'result', text: text || undefined, isError });
    } else if (type === 'error' || (type === 'system' && str(ev.subtype) === 'error')) {
      out.push({ kind: 'error', message: errorText(ev.error ?? ev.message ?? ev.detail) });
    } else if (type === 'step_finish' || ev.usage || ev.usageMetadata) {
      const u = usageEvent(ev.usage ?? ev.usageMetadata, ev);
      if (u) out.push(u);
    }
    return out;
  };
}

export const geminiAdapter: CliAdapter = {
  type: 'gemini-cli',
  supportsResume: true,
  unknownSession: /unknown\s+session|session\s+.*\s+not\s+found|checkpoint\s+.*\s+not\s+found|cannot\s+resume|failed\s+to\s+resume/i,
  createParser: parser,
  apiKeyEnv: () => ['GEMINI_API_KEY'],
  async prepareApiKeyEnv(provider) {
    // Gemini CLI chỉ dùng GEMINI_API_KEY khi cài đặt chọn "gemini-api-key" → thư mục nhà riêng có settings.json.
    const home = await privateDir('gemini-home', provider._id);
    await fs.mkdir(path.join(home, '.gemini'), { recursive: true });
    await fs.writeFile(
      path.join(home, '.gemini', 'settings.json'),
      JSON.stringify({ selectedAuthType: 'gemini-api-key', security: { auth: { selectedType: 'gemini-api-key' } } }, null, 2),
      'utf8',
    );
    return { HOME: home, USERPROFILE: home, GEMINI_API_KEY: provider.apiKey };
  },
  async build({ ctx, provider, model, prompt, resume }) {
    const level = ctx.permission;
    const approval = level === 'read' ? 'default' : level === 'write' ? 'auto_edit' : 'yolo';
    return {
      args: [
        '--output-format',
        'stream-json',
        ...(resume ? ['--resume', resume] : []),
        ...(model && model !== 'auto' ? ['--model', model] : []),
        '--approval-mode',
        approval,
        ...(opt(provider, 'sandbox') ? ['--sandbox'] : []),
        ...(provider.extraArgs ?? []),
        '--prompt',
        resume && ctx.task.round === 0 ? 'Tiếp tục nhiệm vụ từ chỗ đã dừng và hoàn tất. Nhớ kết thúc bằng khối vp-result.' : 'Làm theo toàn bộ yêu cầu ở trên.',
      ],
      input: resume && ctx.task.round === 0 ? '' : prompt,
      env: { TERM: 'xterm-256color', COLORTERM: 'truecolor', NO_BROWSER: '1' },
    };
  },
  probe(_provider, model) {
    return { args: ['--output-format', 'stream-json', ...(model && model !== 'auto' ? ['--model', model] : []), '--prompt', 'Respond with hello.'], env: { NO_BROWSER: '1' } };
  },
};

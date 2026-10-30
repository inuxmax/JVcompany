// CLI nhiều nhà cung cấp: OpenCode (`opencode run --format json`) và Pi (`pi --mode json`). Model dạng nhà-cung-cấp/model.
import path from 'path';
import type { PermissionLevel } from '../../../types';
import type { CliAdapter, CliEvent } from './types';
import { m } from '../../../i18n';
import { sysMsg } from '../../../i18n/format';
import { commandLines, contentText, describeTool, effortFor, envCheck, errorText, num, obj, optStr, privateDir, str } from './shared';

// ---------------- OpenCode ----------------

/** Quyền của OpenCode theo mức quyền của nhiệm vụ (truyền qua OPENCODE_CONFIG_CONTENT). */
function opencodePermission(level: PermissionLevel) {
  if (level === 'read') return { edit: 'deny', bash: 'deny', webfetch: 'allow' };
  if (level === 'write') return { edit: 'allow', bash: 'deny', webfetch: 'allow' };
  return { edit: 'allow', bash: 'allow', webfetch: 'allow' };
}

function opencodeParser() {
  return (ev: Record<string, unknown>): CliEvent[] => {
    const out: CliEvent[] = [];
    if (str(ev.sessionID)) out.push({ kind: 'session', id: str(ev.sessionID) });
    const part = obj(ev.part);
    switch (str(ev.type)) {
      case 'text': {
        const text = str(part.text);
        if (text.trim()) out.push({ kind: 'text', text });
        break;
      }
      case 'step_finish': {
        const t = obj(part.tokens);
        const cache = obj(t.cache);
        out.push({
          kind: 'usage',
          input: num(t.input) + num(cache.write) + num(cache.read),
          output: num(t.output) + num(t.reasoning),
          cached: num(cache.read),
          costUsd: num(part.cost),
        });
        break;
      }
      case 'tool_use': {
        const state = obj(part.state);
        if (str(state.status) === 'error') out.push({ kind: 'tool', text: `⚠️ ${str(part.tool)}: ${str(state.error).slice(0, 200)}`, tool: str(part.tool) });
        else out.push({ kind: 'tool', text: describeTool(str(part.tool), obj(state.input)), tool: str(part.tool) });
        break;
      }
      case 'error':
        out.push({ kind: 'error', message: errorText(ev.error ?? ev.message) });
        break;
    }
    return out;
  };
}

export const opencodeAdapter: CliAdapter = {
  type: 'opencode',
  supportsResume: true,
  unknownSession: /unknown\s+session|session\b.*\bnot\s+found|notfounderror|no session/i,
  createParser: opencodeParser,
  apiKeyEnv: (_p, model) => [providerKeyEnv(model.split('/')[0] || 'openrouter')],
  async build({ ctx, provider, model, prompt, resume }) {
    const variant = optStr(provider, 'variant');
    return {
      args: [
        'run',
        '--format',
        'json',
        ...(resume ? ['--session', resume] : []),
        ...(model ? ['--model', model] : []),
        ...(variant ? ['--variant', variant] : []),
        ...(provider.extraArgs ?? []),
      ],
      input: resume && ctx.task.round === 0 ? 'Tiếp tục nhiệm vụ từ chỗ đã dừng và hoàn tất. Nhớ kết thúc bằng khối jv-result.' : prompt,
      env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: opencodePermission(ctx.permission) }) },
    };
  },
  probe(_provider, model) {
    return { args: ['run', '--format', 'json', ...(model ? ['--model', model] : [])], input: 'Respond with hello.' };
  },
  async listModels(command) {
    const lines = await commandLines(command, ['models']);
    return lines.map((l) => l.split(/\s+/)[0]).filter((m) => m.includes('/'));
  },
  async extraChecks(_provider, model) {
    if (model && !model.includes('/')) {
      return [envCheck('opencode_model_format', 'error', sysMsg('Model "{model}" chưa đúng dạng nhà-cung-cấp/model.', { model }), { hint: sysMsg('Ví dụ: anthropic/claude-sonnet-5-5 hoặc openrouter/openai/gpt-5.') })];
    }
    if (!model) {
      return [
        envCheck('opencode_model_missing', 'warn', sysMsg('Chưa chọn model – OpenCode sẽ dùng model mặc định trong cấu hình của nó.'), {
          hint: sysMsg('Chọn model dạng nhà-cung-cấp/model (bấm "Tải danh sách").'),
        }),
      ];
    }
    return [];
  },
};

// ---------------- Pi ----------------

/** Biến môi trường chứa key của nhà cung cấp (theo tiền tố model). */
function providerKeyEnv(p: string): string {
  switch (p.toLowerCase()) {
    case 'anthropic':
      return 'ANTHROPIC_API_KEY';
    case 'openai':
      return 'OPENAI_API_KEY';
    case 'google':
    case 'gemini':
      return 'GEMINI_API_KEY';
    case 'xai':
      return 'XAI_API_KEY';
    case 'deepseek':
      return 'DEEPSEEK_API_KEY';
    case 'groq':
      return 'GROQ_API_KEY';
    case 'mistral':
      return 'MISTRAL_API_KEY';
    default:
      return 'OPENROUTER_API_KEY';
  }
}

function piParser() {
  return (ev: Record<string, unknown>): CliEvent[] => {
    const out: CliEvent[] = [];
    const type = str(ev.type);
    const terminal = type === 'agent_end' ? ((ev.messages as unknown[]) ?? []) : type === 'message_end' || type === 'turn_end' ? [ev.message] : [];
    for (const raw of terminal) {
      const m = obj(raw);
      if (m.role === 'assistant' && m.stopReason === 'error') out.push({ kind: 'error', message: str(m.errorMessage) || 'Pi: nhà cung cấp báo lỗi.' });
    }
    if (type === 'message_update') {
      const a = obj(ev.assistantMessageEvent);
      if (a.type === 'text_start') out.push({ kind: 'reset' });
      if (a.type === 'text_delta' && str(a.delta)) out.push({ kind: 'delta', text: str(a.delta) });
    } else if (type === 'turn_end') {
      const m = obj(ev.message);
      const text = contentText(m.content);
      if (text.trim()) out.push({ kind: 'text', text });
      const u = obj(m.usage);
      if (Object.keys(u).length) {
        out.push({
          kind: 'usage',
          input: num(u.input) + num(u.cacheWrite) + num(u.cacheRead),
          output: num(u.output),
          cached: num(u.cacheRead),
          costUsd: num(obj(u.cost).total),
        });
      }
    } else if (type === 'tool_execution_start') {
      out.push({ kind: 'tool', text: describeTool(str(ev.toolName), obj(ev.args)), tool: str(ev.toolName) });
    } else if (type === 'auto_retry_end' && ev.success !== true) {
      out.push({ kind: 'error', message: str(ev.finalError) || 'Pi đã thử lại hết lượt mà không có phản hồi.' });
    } else if (type === 'error' && str(ev.message)) {
      out.push({ kind: 'error', message: str(ev.message) });
    }
    return out;
  };
}

function splitModel(model: string): { provider: string; id: string } {
  const i = model.indexOf('/');
  return i > 0 ? { provider: model.slice(0, i), id: model.slice(i + 1) } : { provider: '', id: model };
}

export const piAdapter: CliAdapter = {
  type: 'pi',
  supportsResume: true,
  createParser: piParser,
  requiresModel: m('Pi cần chọn model dạng nhà-cung-cấp/model (vd anthropic/claude-sonnet-5-5).'),
  apiKeyEnv: (_p, model) => [providerKeyEnv(splitModel(model).provider)],
  async build({ ctx, provider, model, resume, promptFile }) {
    const { provider: prov, id } = splitModel(model);
    const thinking = effortFor(ctx.department.effort, 'pi');
    const tools = ctx.permission === 'read' ? 'read,grep,find,ls' : ctx.permission === 'write' ? 'read,edit,write,grep,find,ls' : 'read,bash,edit,write,grep,find,ls';
    // Phiên của Pi là một tệp JSONL – giữ theo nhiệm vụ để làm tiếp được.
    const session = resume ?? path.join(await privateDir('pi-sessions'), `${ctx.task._id}.jsonl`);
    return {
      args: [
        '--mode',
        'json',
        '-p',
        ...(prov ? ['--provider', prov] : []),
        ...(id ? ['--model', id] : []),
        ...(thinking ? ['--thinking', thinking] : []),
        '--tools',
        tools,
        '--session',
        session,
        ...(provider.extraArgs ?? []),
        resume && ctx.task.round === 0 ? 'Tiếp tục nhiệm vụ từ chỗ đã dừng và hoàn tất. Nhớ kết thúc bằng khối jv-result.' : await promptFile(),
      ],
      sessionId: session,
    };
  },
  probe(_provider, model) {
    const { provider: prov, id } = splitModel(model);
    return { args: ['--mode', 'json', '-p', ...(prov ? ['--provider', prov] : []), ...(id ? ['--model', id] : []), 'Respond with hello.'] };
  },
  async listModels(command) {
    const lines = await commandLines(command, ['--list-models']);
    const out: string[] = [];
    for (const l of lines) {
      const cols = l.split(/\s{2,}/).map((c) => c.trim());
      if (cols.length >= 2 && !/^provider$/i.test(cols[0])) out.push(`${cols[0]}/${cols[1]}`);
    }
    return out;
  },
};

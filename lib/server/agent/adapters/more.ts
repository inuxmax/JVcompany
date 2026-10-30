// Kimi Code, Grok Build, Hermes Agent, Copilot, Qwen Code và lệnh tùy chỉnh.
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { CliAdapter, CliEvent, TextParse } from './types';
import { commandLines, describeTool, effortFor, errorText, num, obj, opt, optNum, optStr, str } from './shared';

const CONTINUE = 'Tiếp tục nhiệm vụ từ chỗ đã dừng và hoàn tất. Nhớ kết thúc bằng khối jv-result.';

// ---------------- Kimi Code ----------------

function kimiParser() {
  return (ev: Record<string, unknown>): CliEvent[] => {
    const out: CliEvent[] = [];
    const role = str(ev.role).toLowerCase();
    if (role === 'assistant') {
      const text = str(ev.content);
      if (text.trim()) out.push({ kind: 'text', text });
      for (const raw of (ev.tool_calls as unknown[]) ?? []) {
        const call = obj(raw);
        const fn = obj(call.function);
        let args: Record<string, unknown> = {};
        try {
          args = obj(JSON.parse(str(fn.arguments) || '{}'));
        } catch {
          /* tham số không phải JSON */
        }
        const name = str(fn.name) || str(call.name);
        if (name) out.push({ kind: 'tool', text: describeTool(name, args), tool: name });
      }
    } else if (role === 'meta' && str(ev.type) === 'session.resume_hint' && str(ev.session_id)) {
      out.push({ kind: 'session', id: str(ev.session_id) });
    } else if (role === 'error' || str(ev.type).toLowerCase() === 'error') {
      out.push({ kind: 'error', message: errorText(ev.error ?? ev.message ?? ev.content ?? ev.detail) });
    }
    return out;
  };
}

export const kimiAdapter: CliAdapter = {
  type: 'kimi',
  supportsResume: true,
  unknownSession: /unknown\s+session|session\s+.*\s+not\s+found|no such session/i,
  createParser: kimiParser,
  apiKeyEnv: () => ['KIMI_MODEL_API_KEY'],
  async prepareApiKeyEnv(provider, model) {
    return { KIMI_MODEL_API_KEY: provider.apiKey, ...(model ? { KIMI_MODEL_NAME: model } : {}) };
  },
  async build({ ctx, provider, model, resume, promptFile }) {
    const effort = /k3/i.test(model) ? effortFor(ctx.department.effort, 'kimi') : '';
    return {
      args: [
        '--output-format',
        'stream-json',
        ...(resume ? ['-r', resume] : []),
        ...(model ? ['-m', model] : []),
        ...(provider.extraArgs ?? []),
        '-p',
        resume && ctx.task.round === 0 ? CONTINUE : await promptFile(),
      ],
      env: { CI: '1', NO_COLOR: '1', KIMI_CODE_NO_AUTO_UPDATE: '1', TERM: 'dumb', ...(effort ? { KIMI_MODEL_THINKING_EFFORT: effort } : {}) },
    };
  },
  probe() {
    return { args: ['-p', 'Respond with hello.', '--output-format', 'stream-json'], env: { CI: '1', KIMI_CODE_NO_AUTO_UPDATE: '1', TERM: 'dumb' } };
  },
};

// ---------------- Grok Build ----------------

function grokParser() {
  return (ev: Record<string, unknown>): CliEvent[] => {
    const out: CliEvent[] = [];
    const type = str(ev.type);
    if (type === 'text' && str(ev.data)) out.push({ kind: 'delta', text: str(ev.data) });
    else if (type === 'tool' || type === 'tool_call') out.push({ kind: 'tool', text: describeTool(str(ev.name) || 'tool', obj(ev.input ?? ev.args)), tool: str(ev.name) });
    else if (type === 'end') {
      if (str(ev.sessionId)) out.push({ kind: 'session', id: str(ev.sessionId) });
      const u = obj(ev.usage);
      out.push({ kind: 'usage', input: num(u.input_tokens), output: num(u.output_tokens), cached: num(u.cache_read_input_tokens), costUsd: num(ev.total_cost_usd), replace: true });
      out.push({ kind: 'result' });
    } else if (type === 'error') {
      out.push({ kind: 'error', message: errorText(ev.error ?? ev.message ?? ev.detail ?? ev.data) });
    }
    return out;
  };
}

export const grokAdapter: CliAdapter = {
  type: 'grok',
  supportsResume: true,
  unknownSession: /unknown\s+session|session(?:\s+.*)?\s+not\s+found|invalid\s+session/i,
  createParser: grokParser,
  apiKeyEnv: () => ['XAI_API_KEY'],
  async build({ ctx, provider, model, resume, promptFile, cwd }) {
    const effort = effortFor(ctx.department.effort, 'grok');
    const maxTurns = optNum(provider, 'maxTurns');
    return {
      args: [
        '--cwd',
        cwd,
        '--output-format',
        'streaming-json',
        ...(resume ? ['--resume', resume] : []),
        ...(model && model !== 'grok-build' ? ['--model', model] : []),
        ...(effort ? ['--reasoning-effort', effort] : []),
        ...(maxTurns ? ['--max-turns', String(maxTurns)] : []),
        ...(ctx.permission === 'read' ? [] : ['--always-approve']),
        ...(opt(provider, 'webSearch') ? [] : ['--disable-web-search']),
        ...(provider.extraArgs ?? []),
        '--single',
        resume && ctx.task.round === 0 ? CONTINUE : await promptFile(),
      ],
    };
  },
  probe() {
    return { args: ['--output-format', 'streaming-json', '--single', 'Respond with exactly hello.'] };
  },
  async listModels(command) {
    const lines = await commandLines(command, ['models']);
    return lines
      .filter((l) => !l.includes(':'))
      .map((l) => l.replace(/^[-*•]\s*/, '').split(/\s+/)[0])
      .filter((m) => /^[a-z0-9][\w.\-]*$/i.test(m) && !/^models?$/i.test(m));
  },
};

// ---------------- Hermes Agent ----------------

/** Hermes in chữ thường: tách mã phiên, token, chi phí ra khỏi nội dung. */
function hermesText(stdout: string): TextParse {
  let sessionId: string | null = null;
  let input = 0;
  let output = 0;
  let cost: number | undefined;
  const keep: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const s = /^\s*session_id:\s*(\S+)/i.exec(line);
    if (s) {
      sessionId = s[1];
      continue;
    }
    const t = /tokens?[:\s]+(\d+)\s*(?:input|in)\b.*?(\d+)\s*(?:output|out)\b/i.exec(line);
    if (t) {
      input = Number(t[1]);
      output = Number(t[2]);
      continue;
    }
    const c = /^\s*(?:cost|spent)[:\s]*\$?([\d.]+)/i.exec(line);
    if (c) {
      cost = Number(c[1]);
      continue;
    }
    keep.push(line);
  }
  return { text: keep.join('\n').trim(), sessionId, usage: { input, output, costUsd: cost } };
}

/** Model đang chọn trong ~/.hermes/config.yaml. */
async function hermesConfigModel(): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(os.homedir(), '.hermes', 'config.yaml'), 'utf8');
    const m = /^\s*(?:default_)?model:\s*["']?([^"'\s#]+)/m.exec(raw);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export const hermesAdapter: CliAdapter = {
  type: 'hermes',
  supportsResume: true,
  parseText: hermesText,
  async build({ ctx, provider, model, resume, promptFile }) {
    const hp = optStr(provider, 'hermesProvider');
    const toolsets = optStr(provider, 'toolsets');
    const maxTurns = optNum(provider, 'maxTurns');
    return {
      args: [
        'chat',
        '-q',
        resume && ctx.task.round === 0 ? CONTINUE : await promptFile(),
        '-Q',
        '-m',
        model || 'auto',
        ...(hp && hp !== 'auto' ? ['--provider', hp] : []),
        ...(toolsets ? ['-t', toolsets] : []),
        ...(maxTurns ? ['--max-turns', String(maxTurns)] : []),
        '--source',
        'tool',
        ...(ctx.permission === 'read' ? [] : ['--yolo']),
        ...(resume ? ['--resume', resume] : []),
        ...(provider.extraArgs ?? []),
      ],
    };
  },
  probe() {
    return { args: ['chat', '-Q', '-q', 'Respond with hello. Do not use tools.', '--max-turns', '1'] };
  },
  async listModels() {
    const m = await hermesConfigModel();
    return ['auto', ...(m ? [m] : [])];
  },
};

// ---------------- Copilot / Qwen / lệnh tùy chỉnh (đầu ra chữ thường) ----------------

export const copilotAdapter: CliAdapter = {
  type: 'copilot',
  async build({ ctx, provider, model, promptFile }) {
    const all = ctx.permission === 'auto' || ctx.permission === 'full';
    return { args: ['-p', await promptFile(), ...(model ? ['--model', model] : []), ...(all ? ['--allow-all-tools'] : []), ...(provider.extraArgs ?? [])] };
  },
  probe(_p, model) {
    return { args: ['-p', 'Respond with hello.', ...(model ? ['--model', model] : [])] };
  },
};

export const qwenAdapter: CliAdapter = {
  type: 'qwen-code',
  async build({ ctx, provider, model, promptFile }) {
    const all = ctx.permission === 'auto' || ctx.permission === 'full';
    return { args: [...(model ? ['-m', model] : []), ...(all ? ['--yolo'] : []), ...(provider.extraArgs ?? []), '-p', await promptFile()] };
  },
  probe(_p, model) {
    return { args: [...(model ? ['-m', model] : []), '-p', 'Respond with hello.'] };
  },
};

export const customAdapter: CliAdapter = {
  type: 'custom-cli',
  async build({ ctx, provider, model, prompt, promptFile }) {
    const args = (provider.extraArgs ?? []).map((a) => a.replace('{model}', model));
    const mode = provider.promptMode ?? 'stdin';
    // Lệnh tuỳ chỉnh tự giới hạn theo mức quyền: read | write | auto | full (+ thư mục dự án)
    const env = { JV_PERMISSION: ctx.permission, JV_PROJECT_DIR: ctx.root };
    if (mode === 'stdin') return { args, input: prompt, env };
    return { args: [...args, await promptFile()], env };
  },
  probe: () => null,
};

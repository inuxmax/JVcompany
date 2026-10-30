// Agent chạy qua CLI cài trên máy (gói đăng ký hoặc API key): Claude Code, Codex, Gemini, Cursor, OpenCode, Pi, Kimi, Grok, Hermes, Copilot, Qwen…
// Mỗi loại có bộ kết nối riêng (lib/server/agent/adapters); tệp này chạy tiến trình và gom sự kiện chuẩn hoá.
import fs from 'fs/promises';
import path from 'path';
import type { Provider } from '../../../types';
import { PERMISSION_CAVEATS, getPreset } from '../../../catalog';
import { runProcess, truncate } from '../../platform';
import { updateTask } from '../../repo';
import type { AgentContext, AgentOutcome } from '../context';
import { buildSystemPrompt, buildTaskPrompt, parseProtocol, stripProtocol } from '../prompts';
import { CancelledError, LimitError, ProviderError, looksLikeLimit, looksTransient, parseResetTime } from '../errors';
import { getCliAdapter, type CliAdapter, type CliEvent } from '../adapters';
import { resolveSecretEnv } from '../../secrets';
import { AUTH_RE, CHILD_ENV, MODEL_ACCESS_RE, NOT_INSTALLED, QUOTA_RE, cleanStderr, resolveCommand } from '../adapters/shared';

export { NOT_INSTALLED };

const CLI_TIMEOUT_MS = 60 * 60 * 1000;
const CONTINUE_EFFORT_RE = /(unknown|unrecognized|invalid|unexpected)[^\n]{0,40}(option|argument|flag)[^\n]{0,40}effort|--effort[^\n]{0,60}(not supported|invalid|unknown|unsupported)/i;

/** Mô hình thay thế khi tài khoản không dùng được tên đầy đủ: bí danh cùng hạng của Claude Code (opus/sonnet/haiku), không thì mặc định của CLI. */
function fallbackModel(provider: Provider, model: string): string {
  if (provider.type !== 'claude-code') return '';
  const tier = /opus|sonnet|haiku/i.exec(model)?.[0].toLowerCase() ?? '';
  return tier && tier !== model.toLowerCase() ? tier : '';
}

async function promptFile(ctx: AgentContext, prompt: string): Promise<string> {
  const dir = path.join(ctx.root, '.vanphong', 'tasks');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${ctx.task._id}.md`);
  await fs.writeFile(file, prompt, 'utf8');
  return `Đọc kỹ và thực hiện TOÀN BỘ yêu cầu trong tệp "${file}". Trả lời đúng định dạng nộp kết quả mô tả trong tệp đó.`;
}

/** Môi trường chạy: bỏ dấu vết phiên cha → biến môi trường của kết nối → API key (nếu dùng chế độ API key) → biến riêng của lượt chạy. */
export async function runEnv(
  adapter: CliAdapter,
  provider: Provider,
  model: string,
  extra?: Record<string, string | undefined>,
): Promise<Record<string, string | undefined>> {
  // Biến môi trường của kết nối – "secret:KHOA" được giải từ kho bí mật
  const own = await resolveSecretEnv(provider.env, { label: provider.name });
  const env: Record<string, string | undefined> = { ...CHILD_ENV, ...own.env };
  if (provider.authMode === 'api_key') {
    if (!provider.apiKey) throw new ProviderError(`${provider.name}: đang chọn "API key" nhưng chưa nhập key.`);
    const keyEnv = adapter.prepareApiKeyEnv
      ? await adapter.prepareApiKeyEnv(provider, model)
      : Object.fromEntries((adapter.apiKeyEnv?.(provider, model) ?? []).map((k) => [k, provider.apiKey]));
    Object.assign(env, keyEnv);
  }
  Object.assign(env, extra ?? {});
  return env;
}

/** Gom sự kiện chuẩn của CLI / gateway: chữ hiện dần, nhật ký suy nghĩ & công cụ, phiên, token. */
export function createSink(ctx: AgentContext) {
  const base = { ...ctx.usage };
  const st = {
    partial: '',
    committed: true,
    texts: [] as string[],
    resultText: null as string | null,
    resultError: false,
    errors: [] as string[],
    sessionId: ctx.task.sessionId ?? null,
    model: null as string | null,
    pending: [] as Promise<void>[],
  };
  const commit = (text: string) => {
    st.texts.push(text);
    ctx.setLive(text);
    st.pending.push(ctx.log('thought', stripProtocol(text) || '…'));
  };
  const flush = () => {
    if (!st.committed && st.partial.trim()) commit(st.partial);
    st.committed = true;
  };
  const handle = (e: CliEvent) => {
    switch (e.kind) {
      case 'reset':
        flush();
        st.partial = '';
        break;
      case 'delta':
        st.partial += e.text;
        st.committed = false;
        ctx.setLive(st.partial);
        break;
      case 'text':
        st.partial = '';
        st.committed = true;
        commit(e.text);
        break;
      case 'tool':
        flush();
        st.partial = '';
        st.pending.push(ctx.log('tool', e.text, { tool: e.tool }));
        break;
      case 'session':
        if (e.id && e.id !== st.sessionId) {
          st.sessionId = e.id;
          st.pending.push(updateTask(ctx.task._id, { sessionId: e.id }, true).then(() => undefined));
        }
        break;
      case 'model':
        st.model = e.id;
        break;
      case 'usage': {
        const u = ctx.usage;
        if (e.replace) {
          u.inputTokens = base.inputTokens + (e.input ?? 0);
          u.outputTokens = base.outputTokens + (e.output ?? 0);
          u.cachedInputTokens = (base.cachedInputTokens ?? 0) + (e.cached ?? 0);
          u.costUsd = base.costUsd + (e.costUsd ?? 0);
        } else {
          u.inputTokens += e.input ?? 0;
          u.outputTokens += e.output ?? 0;
          u.cachedInputTokens = (u.cachedInputTokens ?? 0) + (e.cached ?? 0);
          u.costUsd += e.costUsd ?? 0;
        }
        break;
      }
      case 'result':
        flush();
        if (e.text !== undefined) st.resultText = e.text;
        if (e.isError) st.resultError = true;
        break;
      case 'error':
        if (e.message) st.errors.push(e.message);
        st.resultError = true;
        break;
    }
  };
  return { st, handle, finish: flush };
}

/** Kết quả cuối thiếu khối vp-result (vd agent viết nó ở lượt trước rồi tóm tắt lại) → lấy khối gần nhất đã viết. */
export function outcomeFrom(finalText: string, texts: string[], sessionId: string | null): AgentOutcome {
  let parsed = parseProtocol(finalText);
  if (!parsed.found) {
    const earlier = [...texts].reverse().find((t) => t.includes('```vp-result'));
    if (earlier) {
      const recovered = parseProtocol(earlier);
      if (recovered.found) parsed = { ...recovered, summary: recovered.summary || parsed.summary };
    }
  }
  return {
    status: 'done',
    text: stripProtocol(finalText),
    summary: parsed.summary || stripProtocol(finalText).slice(-1500),
    decision: parsed.decision,
    delegations: parsed.delegate,
    artifacts: parsed.artifacts,
    sessionId,
    extras: parsed.extras,
  };
}

interface RunOpts {
  /** Đã chạy lại bằng model thay thế. */
  retried?: boolean;
  /** Bỏ phiên cũ, chạy phiên mới. */
  fresh?: boolean;
  /** Tham số CLI không hỗ trợ cần bỏ. */
  without?: Set<string>;
}

export async function runCli(ctx: AgentContext, provider: Provider, model: string, opts: RunOpts = {}): Promise<AgentOutcome> {
  const adapter = getCliAdapter(provider.type);
  const preset = getPreset(provider.type);
  const { command, path: resolved } = resolveCommand(provider);
  if (!resolved) throw new ProviderError(`Không tìm thấy lệnh "${command}" trên máy. ${preset.setup}`);
  if (adapter.requiresModel && !model) throw new ProviderError(adapter.requiresModel);

  const system = await buildSystemPrompt(ctx, 'cli');
  const task = await buildTaskPrompt(ctx, 'cli');
  const prompt = `${system}\n\n---\n\n${task}`;
  const resume = !opts.fresh && adapter.supportsResume ? (ctx.task.sessionId ?? null) : null;
  const cwd = provider.cwd?.trim() || ctx.root;
  const without = opts.without ?? new Set<string>();
  const spec = await adapter.build({ ctx, provider, model, prompt, system, task, resume, promptFile: () => promptFile(ctx, prompt), cwd, without });
  let env: Record<string, string | undefined>;
  try {
    env = await runEnv(adapter, provider, model, { ...(ctx.env ?? {}), ...(spec.env ?? {}) });
  } catch (err) {
    throw err instanceof ProviderError ? err : new ProviderError(err instanceof Error ? err.message : String(err));
  }
  ctx.billing = { providerType: provider.type, model, billingType: provider.authMode === 'api_key' ? 'api' : 'subscription' };
  // Kết nối không làm đúng mức quyền đã chọn → nói rõ trong nhật ký (để chủ công ty biết mà chọn mức / kết nối phù hợp)
  const caveat = PERMISSION_CAVEATS[provider.type]?.[ctx.permission];
  if (caveat && !opts.retried && !opts.fresh) await ctx.log('system', `⚠️ ${caveat}`, { permissionCaveat: true });

  await ctx.log('system', `Khởi chạy ${provider.name}${model ? ` (${model})` : ''} trong \`${cwd}\`${resume ? ' · làm tiếp phiên trước' : ''}`, {
    provider: provider.type,
  });

  const sink = createSink(ctx);
  if (spec.sessionId) sink.handle({ kind: 'session', id: spec.sessionId });
  const parse = adapter.createParser?.();
  let buffer = '';
  let live = '';
  const handleLine = (line: string) => {
    const t = line.trim();
    if (!parse || !t.startsWith('{')) return;
    let ev: unknown;
    try {
      ev = JSON.parse(t);
    } catch {
      return;
    }
    if (ev && typeof ev === 'object') for (const e of parse(ev as Record<string, unknown>)) sink.handle(e);
  };

  const timeoutMs = provider.timeoutSec ? provider.timeoutSec * 1000 : CLI_TIMEOUT_MS;
  const r = await runProcess(resolved, spec.args, {
    cwd,
    input: spec.input,
    timeoutMs,
    signal: ctx.signal,
    env,
    onStdout: (chunk) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        handleLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
      }
      if (!parse) {
        live = (live + chunk).slice(-4000);
        ctx.setLive(live);
      }
    },
  });
  if (buffer) handleLine(buffer);
  sink.finish();
  ctx.setLive(null);
  await Promise.allSettled(sink.st.pending);

  if (r.aborted || ctx.signal.aborted) throw new CancelledError();

  let finalText: string;
  if (parse) {
    finalText = (sink.st.resultText || sink.st.texts[sink.st.texts.length - 1] || '').trim();
  } else {
    const tp = adapter.parseText?.(r.stdout) ?? { text: r.stdout.trim() };
    finalText = tp.text;
    if (tp.sessionId) sink.handle({ kind: 'session', id: tp.sessionId });
    if (tp.usage) sink.handle({ kind: 'usage', input: tp.usage.input, output: tp.usage.output, costUsd: tp.usage.costUsd });
    await Promise.allSettled(sink.st.pending);
  }
  const stderr = cleanStderr(r.stderr);
  const errText = sink.st.errors.join('\n').trim();
  const diagnostics = `${finalText}\n${errText}\n${sink.st.texts.slice(-3).join('\n')}\n${stderr}\n${r.error ?? ''}`;

  if (r.timedOut) throw new ProviderError(`${provider.name} chạy quá ${Math.round(timeoutMs / 60000)} phút và đã bị dừng.`, true);
  const failed = r.code !== 0 || !finalText || (sink.st.resultError && !finalText.includes('```vp-result'));
  if (failed) {
    // Phiên cũ không còn (CLI đã dọn) → chạy lại một lần bằng phiên mới.
    if (resume && adapter.unknownSession?.test(diagnostics)) {
      await ctx.log('system', `Phiên làm việc trước của ${provider.name} không còn – bắt đầu phiên mới.`);
      await updateTask(ctx.task._id, { sessionId: null }, true);
      ctx.task = { ...ctx.task, sessionId: null };
      return runCli(ctx, provider, model, { ...opts, fresh: true });
    }
    // CLI cũ chưa có tham số --effort → bỏ đi và chạy lại.
    if (!without.has('effort') && CONTINUE_EFFORT_RE.test(diagnostics)) {
      await ctx.log('system', `${provider.name} chưa hỗ trợ mức "effort" – chạy lại không kèm tham số này.`);
      return runCli(ctx, provider, model, { ...opts, without: new Set([...without, 'effort']) });
    }
    if (looksLikeLimit(diagnostics) && (QUOTA_RE.test(diagnostics) || !AUTH_RE.test(errText || stderr))) {
      throw new LimitError(`${provider.name}: hết hạn mức – ${truncate(diagnostics.trim(), 400)}`, parseResetTime(diagnostics));
    }
    const noModelAccess = Boolean(model) && MODEL_ACCESS_RE.test(diagnostics);
    // Tài khoản không dùng được mô hình đã chọn → chạy lại một lần bằng mô hình cùng hạng / mặc định thay vì bỏ nhiệm vụ.
    if (noModelAccess && !opts.retried && !(provider.extraArgs ?? []).some((a) => a.includes('{model}'))) {
      const alt = fallbackModel(provider, model);
      await ctx.log(
        'system',
        `⚠️ Tài khoản ${provider.name} không dùng được mô hình "${model}" – chạy lại bằng ${alt ? `"${alt}"` : 'mô hình mặc định'}. Nên đổi mô hình của ${ctx.department.name} sang "Theo hạng".`,
        { provider: provider.type, modelFallback: alt || null },
      );
      await updateTask(ctx.task._id, { model: alt || null }, true);
      return runCli(ctx, provider, alt, { ...opts, retried: true });
    }
    // Lỗi thật nằm trong kết quả cuối / sự kiện lỗi (vd "API Error: 403 …"); stderr thường chỉ có cảnh báo.
    const reason = errText || (sink.st.resultError && finalText) || stderr || finalText || r.error || `thoát với mã ${r.code}`;
    const msg = truncate(reason.trim(), 1500);
    if (AUTH_RE.test(msg) && !QUOTA_RE.test(msg)) {
      const login = preset.loginCommand ? ` Chạy "${preset.loginCommand}" trong terminal để đăng nhập lại` : '';
      throw new ProviderError(`${provider.name}: chưa đăng nhập hoặc thông tin xác thực không hợp lệ – ${msg}.${login}`);
    }
    const hint = noModelAccess ? ` → Đổi mô hình của ${ctx.department.name} (đang là "${model}") sang "Theo hạng" hoặc mô hình khác.` : '';
    throw new ProviderError(`${provider.name} lỗi: ${msg}${hint}`, looksTransient(msg));
  }

  if (!parse && finalText) await ctx.log('thought', stripProtocol(finalText).slice(0, 8000) || '…');
  return outcomeFrom(finalText, sink.st.texts, sink.st.sessionId);
}

export async function cliVersion(provider: Provider): Promise<{ ok: boolean; version: string; path: string | null }> {
  const { path: resolved } = resolveCommand(provider);
  if (!resolved) return { ok: false, version: '', path: null };
  const r = await runProcess(resolved, ['--version'], { timeoutMs: 20_000, env: CHILD_ENV });
  const version = (r.stdout || r.stderr).trim().split(/\r?\n/)[0]?.slice(0, 120) ?? '';
  return { ok: r.code === 0 && !NOT_INSTALLED.test(version), version, path: resolved };
}

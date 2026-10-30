// Quét máy tìm agent CLI / máy chủ mô hình cục bộ; "Kiểm tra môi trường" cho mọi loại kết nối (như Paperclip).
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import type { EnvCheck, EnvTestResult, Provider, ProviderStatus, ProviderType } from '../../types';
import { PROVIDER_PRESETS, getPreset, modelAvailable } from '../../catalog';
import { appDataDir, runProcess, truncate } from '../platform';
import { listAnthropicModels } from './providers/anthropic';
import { listOpenAIModels } from './providers/openai';
import { getCliAdapter, type CliEvent } from './adapters';
import { getGateway } from './adapters/gateways';
import { AUTH_RE, CHILD_ENV, MODEL_ACCESS_RE, NOT_INSTALLED, QUOTA_RE, cleanStderr, envCheck, resolveCommand } from './adapters/shared';
import { runEnv } from './providers/cli';
import { looksLikeLimit, looksTransient } from './errors';
import { m } from '../../i18n';
import { sysMsg } from '../../i18n/format';

export interface DetectedAgent {
  type: ProviderType;
  label: string;
  command: string;
  path: string;
  version: string;
  models?: string[];
  /** Dấu hiệu đã đăng nhập (chỉ xem tệp/biến môi trường, không chạy CLI). */
  auth: AuthSignal;
}

export type AuthSignal = 'present' | 'absent' | 'unknown';

async function ollamaModels(baseUrl = 'http://127.0.0.1:11434'): Promise<string[] | null> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const j = (await res.json()) as { models?: { name: string }[] };
    return (j.models ?? []).map((m) => m.name);
  } catch {
    return null;
  }
}

/** Đã đăng nhập CLI chưa – chỉ kiểm tra sự tồn tại của tệp thông tin đăng nhập / biến môi trường, không đọc nội dung. */
export function authSignal(type: ProviderType): AuthSignal {
  const home = os.homedir();
  const has = (...p: string[]) => fs.existsSync(path.join(home, ...p));
  const env = (...k: string[]) => k.some((x) => Boolean(process.env[x]));
  switch (type) {
    case 'claude-code':
      if (env('CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY') || has('.claude', '.credentials.json')) return 'present';
      return process.platform === 'darwin' ? 'unknown' : 'absent';
    case 'codex':
      return env('OPENAI_API_KEY', 'CODEX_API_KEY') || has('.codex', 'auth.json') ? 'present' : 'absent';
    case 'gemini-cli':
      return env('GEMINI_API_KEY', 'GOOGLE_API_KEY') || has('.gemini', 'oauth_creds.json') ? 'present' : 'absent';
    case 'opencode':
      return has('.local', 'share', 'opencode', 'auth.json') ? 'present' : 'unknown';
    case 'cursor-agent':
      return env('CURSOR_API_KEY') ? 'present' : 'unknown';
    case 'grok':
      return env('XAI_API_KEY') ? 'present' : 'unknown';
    default:
      return 'unknown';
  }
}

export async function detectLocalAgents(): Promise<DetectedAgent[]> {
  const found: DetectedAgent[] = [];
  await Promise.all(
    PROVIDER_PRESETS.filter((p) => p.kind === 'cli' && p.command).map(async (preset) => {
      const { command, path: resolved } = resolveCommand({ type: preset.type } as Provider);
      if (!resolved) return;
      const r = await runProcess(resolved, ['--version'], { timeoutMs: 15_000, env: CHILD_ENV });
      const version = (r.stdout || r.stderr).trim().split(/\r?\n/)[0]?.slice(0, 120) ?? '';
      if (NOT_INSTALLED.test(version)) return;
      found.push({ type: preset.type, label: preset.label, command, path: resolved, version, auth: authSignal(preset.type) });
    }),
  );
  const models = await ollamaModels();
  if (models) {
    found.push({
      type: 'ollama',
      label: m('Ollama (máy cục bộ)'),
      command: 'ollama',
      path: 'http://127.0.0.1:11434',
      version: `${models.length} model`,
      models,
      auth: 'present',
    });
  }
  return found.sort((a, b) => a.label.localeCompare(b.label));
}

// Model không dùng để trò chuyện/viết code (nhúng, giọng nói, ảnh, video…) – bỏ khỏi danh sách chọn.
const NON_CHAT = /embed|whisper|tts|dall-e|moderation|transcri|imagen|veo|sora|image|audio|realtime|rerank|aqa|babbage|davinci/i;

/** Tải danh sách model thật: API → endpoint /models; CLI → lệnh liệt kê của CLI (nếu có); gateway → API của dịch vụ. */
export async function listModels(provider: Provider): Promise<string[]> {
  if (provider.kind === 'cli') {
    const adapter = getCliAdapter(provider.type);
    // CLI dùng API key của Anthropic/OpenAI → tải từ API đó
    if (provider.authMode === 'api_key' && provider.apiKey && (provider.type === 'claude-code' || provider.type === 'codex')) {
      const ids = provider.type === 'claude-code' ? await listAnthropicModels({ ...provider, baseUrl: undefined }) : await listOpenAIModels({ ...provider, baseUrl: 'https://api.openai.com/v1' });
      return ids.filter((m) => !NON_CHAT.test(m));
    }
    const { command, path: resolved } = resolveCommand(provider);
    if (resolved && adapter.listModels) {
      const ids = await adapter.listModels(command, provider);
      if (ids.length) return ids;
    }
    return getPreset(provider.type).models;
  }
  if (provider.kind === 'gateway') return (await getGateway(provider.type)?.listModels?.(provider)) ?? [];
  const ids = provider.type === 'anthropic' ? await listAnthropicModels(provider) : await listOpenAIModels(provider);
  const chat = ids.filter((m) => !NON_CHAT.test(m));
  return chat.length ? chat : ids;
}

function finish(checks: EnvCheck[], command?: string): EnvTestResult {
  const status = checks.some((c) => c.level === 'error') ? 'fail' : checks.some((c) => c.level === 'warn') ? 'warn' : 'pass';
  return { status, checks, testedAt: new Date().toISOString(), ...(command ? { command } : {}) };
}

function quoteArg(a: string): string {
  return /[\s"'|&<>]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
}

/** Chạy lượt thử "Respond with hello." và đọc kết quả bằng chính bộ đọc của CLI. */
async function helloProbe(provider: Provider, model: string, resolved: string, command: string): Promise<{ checks: EnvCheck[]; command: string }> {
  const adapter = getCliAdapter(provider.type);
  const preset = getPreset(provider.type);
  const spec = adapter.probe(provider, model);
  if (!spec) return { checks: [], command: '' };
  const code = provider.type.replace(/-/g, '_');
  const shown = `${command} ${spec.args.map(quoteArg).join(' ')}${spec.input ? `   (stdin: "${spec.input}")` : ''}`;
  let env: Record<string, string | undefined>;
  try {
    env = await runEnv(adapter, provider, model, spec.env);
  } catch (err) {
    return { checks: [{ code: `${code}_probe_env`, level: 'error', message: (err as Error).message }], command: shown };
  }
  const cwd = path.join(appDataDir(), 'probe');
  await fsp.mkdir(cwd, { recursive: true });
  const r = await runProcess(resolved, spec.args, { cwd, input: spec.input, timeoutMs: 120_000, env });
  const parse = adapter.createParser?.();
  const texts: string[] = [];
  const errors: string[] = [];
  let partial = '';
  let resultText = '';
  if (parse) {
    for (const line of r.stdout.split(/\r?\n/)) {
      const t = line.trim();
      if (!t.startsWith('{')) continue;
      let ev: unknown;
      try {
        ev = JSON.parse(t);
      } catch {
        continue;
      }
      for (const e of parse(ev as Record<string, unknown>) as CliEvent[]) {
        if (e.kind === 'text') texts.push(e.text);
        else if (e.kind === 'delta') partial += e.text;
        else if (e.kind === 'error') errors.push(e.message);
        else if (e.kind === 'result' && e.text) resultText = e.text;
      }
    }
  }
  const text = (parse ? resultText || texts[texts.length - 1] || partial : (adapter.parseText?.(r.stdout).text ?? r.stdout)).trim();
  const stderr = cleanStderr(r.stderr);
  const diag = `${errors.join('\n')}\n${text}\n${stderr}\n${r.error ?? ''}`;
  const detail = truncate((errors.join('\n') || stderr || text || r.error || '').trim(), 600);
  const login = preset.loginCommand ? sysMsg('Chạy "{command}" trong terminal để đăng nhập.', { command: preset.loginCommand }) : preset.setup;
  let check: EnvCheck;
  if (r.timedOut) {
    check = envCheck(`${code}_hello_probe_timed_out`, 'warn', sysMsg('Lượt thử quá 2 phút chưa trả lời.'), {
      hint: sysMsg('Thử chạy lệnh bên dưới trong terminal để xem CLI có đang hỏi gì không.'),
    });
  } else if (looksLikeLimit(diag) && (r.code !== 0 || errors.length) && (QUOTA_RE.test(diag) || !AUTH_RE.test(diag))) {
    check = envCheck(
      `${code}_hello_probe_usage_limited`,
      'warn',
      model
        ? sysMsg('Tài khoản đang hết hạn mức cho model "{model}" – nhiệm vụ sẽ tự chạy lại khi có hạn mức.', { model })
        : sysMsg('Tài khoản đang hết hạn mức – nhiệm vụ sẽ tự chạy lại khi có hạn mức.'),
      { detail, hint: sysMsg('Nạp thêm hạn mức, hoặc chọn model rẻ hơn (vd sonnet/haiku) làm model mặc định.') },
    );
  } else if (AUTH_RE.test(diag) && (r.code !== 0 || errors.length || !text)) {
    check = envCheck(`${code}_hello_probe_auth_required`, 'error', sysMsg('CLI chưa đăng nhập hoặc key không hợp lệ.'), { detail, hint: login });
  } else if (MODEL_ACCESS_RE.test(diag) && (r.code !== 0 || errors.length)) {
    check = envCheck(`${code}_hello_probe_model_unavailable`, 'error', sysMsg('Tài khoản không dùng được model "{model}".', { model: model || m('mặc định') }), {
      detail,
      hint: sysMsg('Chọn model khác hoặc để phòng ban dùng "Theo hạng".'),
    });
  } else if (r.code !== 0 || !text) {
    check = looksTransient(diag)
      ? envCheck(`${code}_hello_probe_transient_upstream`, 'warn', sysMsg('Nhà cung cấp đang quá tải / lỗi mạng tạm thời.'), { detail })
      : envCheck(`${code}_hello_probe_failed`, 'error', sysMsg('Lượt thử thất bại (mã thoát {code}).', { code: String(r.code) }), { detail });
  } else check = envCheck(`${code}_hello_probe_ok`, 'info', sysMsg('Agent trả lời: "{text}"', { text: text.replace(/\s+/g, ' ').slice(0, 80) }));
  return { checks: [check], command: shown };
}

export interface TestOptions {
  /** Chạy lượt thử "hello" thật (tốn rất ít hạn mức). */
  probe?: boolean;
}

/** "Kiểm tra môi trường" theo từng loại kết nối – danh sách mục Đạt / Cảnh báo / Lỗi. */
export async function testEnvironment(provider: Provider, opts: TestOptions = {}): Promise<{ result: EnvTestResult; version?: string; models?: string[]; defaultModel?: string }> {
  const checks: EnvCheck[] = [];
  const preset = getPreset(provider.type);
  const code = provider.type.replace(/-/g, '_');

  if (provider.kind === 'manual') {
    checks.push(envCheck('manual_ready', 'info', sysMsg('Sẵn sàng – bạn chuyển tiếp prompt qua trình duyệt.')));
    return { result: finish(checks) };
  }

  if (provider.kind === 'gateway') {
    const gw = getGateway(provider.type);
    checks.push(...(gw ? await gw.test(provider) : [envCheck('gateway_unsupported', 'error', sysMsg('Chưa hỗ trợ loại kết nối này.'))]));
    return { result: finish(checks) };
  }

  if (provider.kind === 'cli') {
    const adapter = getCliAdapter(provider.type);
    const { command, path: resolved } = resolveCommand(provider);
    const install = preset.installCommand ? sysMsg('Cài: {command}', { command: preset.installCommand }) : preset.setup;
    if (!resolved) {
      checks.push(envCheck(`${code}_command_unresolvable`, 'error', sysMsg('Không tìm thấy lệnh "{command}" trên máy.', { command: command || m('(chưa nhập)') }), { hint: install }));
      return { result: finish(checks) };
    }
    checks.push(
      envCheck(
        `${code}_command_resolvable`,
        'info',
        command === resolved ? sysMsg('Tìm thấy lệnh: {path}', { path: resolved }) : sysMsg('Tìm thấy "{command}" tại {path}', { command, path: resolved }),
      ),
    );
    const v = await runProcess(resolved, ['--version'], { timeoutMs: 20_000, env: CHILD_ENV });
    const version = (v.stdout || v.stderr).trim().split(/\r?\n/)[0]?.slice(0, 120) ?? '';
    if (NOT_INSTALLED.test(version)) {
      checks.push(envCheck(`${code}_cli_not_installed`, 'error', sysMsg('{path} chỉ là lệnh trung gian – chưa cài CLI thật.', { path: resolved }), { hint: install }));
      return { result: finish(checks), version };
    }
    if (version) checks.push(envCheck(`${code}_cli_version`, 'info', sysMsg('Phiên bản: {version}', { version })));
    if (provider.cwd?.trim()) {
      const ok = fs.existsSync(provider.cwd.trim()) && fs.statSync(provider.cwd.trim()).isDirectory();
      checks.push(
        ok
          ? envCheck(`${code}_cwd_valid`, 'info', sysMsg('Thư mục làm việc: {path}', { path: provider.cwd }))
          : envCheck(`${code}_cwd_invalid`, 'error', sysMsg('Thư mục làm việc không tồn tại: {path}', { path: provider.cwd })),
      );
    }
    if (provider.authMode === 'api_key') {
      const keys = adapter.apiKeyEnv?.(provider, provider.defaultModel ?? '') ?? [];
      checks.push(
        provider.apiKey
          ? envCheck(
              `${code}_api_key_present`,
              'info',
              keys.length ? sysMsg('Dùng API key (biến {vars}) – tính phí theo API.', { vars: keys.join(', ') }) : sysMsg('Dùng API key – tính phí theo API.'),
            )
          : envCheck(`${code}_api_key_missing`, 'error', sysMsg('Đang chọn "API key" nhưng chưa nhập key.')),
      );
    } else if (provider.type !== 'custom-cli') {
      const sig = authSignal(provider.type);
      checks.push(
        sig === 'absent'
          ? envCheck(`${code}_auth_absent`, 'warn', sysMsg('Chưa thấy dấu hiệu đã đăng nhập CLI.'), {
              hint: preset.loginCommand ? sysMsg('Chạy "{command}" trong terminal.', { command: preset.loginCommand }) : preset.setup,
            })
          : envCheck(
              `${code}_subscription_mode`,
              'info',
              sig === 'present' ? sysMsg('Dùng tài khoản đã đăng nhập trong CLI (gói đăng ký).') : sysMsg('Dùng tài khoản đăng nhập trong CLI (gói đăng ký) – chạy thử để xác nhận.'),
            ),
      );
    }
    const model = provider.defaultModel || preset.defaultModel || '';
    // requiresModel là câu dựng sẵn của bộ kết nối (đánh dấu m() trong adapters) → dùng chính nó làm khoá dịch
    if (adapter.requiresModel && !model) checks.push(envCheck(`${code}_model_required`, 'error', sysMsg(adapter.requiresModel)));
    if (adapter.extraChecks) checks.push(...(await adapter.extraChecks(provider, model)));
    let command2: string | undefined;
    if (opts.probe && !checks.some((c) => c.level === 'error')) {
      const p = await helloProbe(provider, model, resolved, command);
      checks.push(...p.checks);
      command2 = p.command || undefined;
    } else if (!opts.probe) {
      checks.push(envCheck(`${code}_hello_probe_skipped`, 'info', sysMsg('Chưa chạy thử – bấm "Kiểm tra môi trường" để agent trả lời thử một câu.')));
    }
    return { result: finish(checks, command2), version };
  }

  // ---- API key ----
  if (preset.needsApiKey && !provider.apiKey) {
    checks.push(envCheck(`${code}_api_key_missing`, 'error', sysMsg('Chưa nhập API key.'), { hint: preset.setup }));
    return { result: finish(checks) };
  }
  try {
    const models = await listModels(provider);
    checks.push(envCheck(`${code}_models_ok`, 'info', sysMsg('Kết nối thành công · {n} model khả dụng', { n: models.length })));
    let defaultModel: string | undefined;
    const live = { kind: provider.kind, models };
    if (models.length && !modelAvailable(live, provider.defaultModel)) {
      const next = [preset.defaultModel, ...preset.models].find((id) => modelAvailable(live, id)) ?? models[0];
      defaultModel = next;
      checks.push(
        envCheck(
          `${code}_default_model_changed`,
          provider.defaultModel ? 'warn' : 'info',
          provider.defaultModel
            ? sysMsg('"{old}" không còn trong danh sách – đổi model mặc định sang "{model}".', { old: provider.defaultModel, model: next })
            : sysMsg('Model mặc định: {model}', { model: next }),
        ),
      );
    }
    return { result: finish(checks), models, defaultModel };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.push(envCheck(`${code}_api_failed`, 'error', msg, { hint: AUTH_RE.test(msg) ? sysMsg('Kiểm tra lại API key.') : undefined }));
    return { result: finish(checks) };
  }
}

/** Tóm tắt kết quả kiểm tra thành trạng thái ngắn của kết nối (kèm khoá dịch của câu được chọn). */
export function statusFrom(result: EnvTestResult, version?: string): ProviderStatus {
  const first = result.checks.find((c) => c.level === 'error') ?? result.checks.find((c) => c.level === 'warn');
  const okMsg = [...result.checks].reverse().find((c) => /probe_ok|models_ok|_ok$/.test(c.code)) ?? result.checks[result.checks.length - 1];
  const pick = first ?? okMsg;
  const ready = sysMsg('Sẵn sàng');
  const messageI18n = pick ? pick.i18n : ready.i18n;
  return {
    ok: result.status !== 'fail',
    message: pick?.message ?? ready.content,
    ...(messageI18n ? { messageI18n } : {}),
    checkedAt: result.testedAt,
    ...(version ? { version } : {}),
  };
}

/**
 * Kiểm tra kết nối (dùng khi tạo / bấm "Kiểm tra"). Với API: tải danh sách model; nếu model mặc định không còn
 * thì trả về model thay thế (`defaultModel`) để lưu lại.
 */
export async function testProvider(
  provider: Provider,
  opts: TestOptions = {},
): Promise<{ status: ProviderStatus; envTest: EnvTestResult; models?: string[]; defaultModel?: string }> {
  const { result, version, models, defaultModel } = await testEnvironment(provider, opts);
  return { status: statusFrom(result, version), envTest: result, models, defaultModel };
}

// Agent ở máy / dịch vụ khác: Hermes Gateway (HTTP + SSE), OpenClaw Gateway (WebSocket v4), HTTP webhook, Cursor Cloud.
import crypto from 'crypto';
import type { EnvCheck, Provider, ProviderType } from '../../../types';
import { updateProvider } from '../../repo';
import type { AgentContext } from '../context';
import { LimitError, ProviderError } from '../errors';
import { newCallbackToken, waitForCallback } from '../callbacks';
import type { CliEvent } from './types';
import { sysMsg } from '../../../i18n/format';
import { type CheckText, envCheck, errorText, num, obj, opt, optStr, str } from './shared';

/** Lỗi đã biết trước (cùng câu với `msg`) → câu dịch được; lỗi khác giữ nguyên chữ thô. */
function known(err: unknown, msg: ReturnType<typeof sysMsg>): CheckText {
  const raw = (err as Error).message;
  return raw === msg.content ? msg : raw;
}

export interface GatewayRun {
  ctx: AgentContext;
  provider: Provider;
  model: string;
  system: string;
  task: string;
  prompt: string;
  emit: (e: CliEvent) => void;
}

export interface GatewayAdapter {
  type: ProviderType;
  run(r: GatewayRun): Promise<{ text: string }>;
  test(provider: Provider): Promise<EnvCheck[]>;
  listModels?(provider: Provider): Promise<string[]>;
}

/** Khoá phiên gửi cho gateway theo cách giữ phiên đã chọn. */
function sessionKey(r: GatewayRun, prefix: string): string | null {
  const s = optStr(r.provider, 'sessionKeyStrategy') || 'task';
  const t = r.ctx.task;
  if (s === 'none') return null;
  if (s === 'fixed') return optStr(r.provider, 'sessionKey') || prefix;
  if (s === 'department') return `${prefix}:dept:${r.ctx.department._id}`;
  if (s === 'run') return `${prefix}:run:${t._id}:${t.attempts}`;
  return `${prefix}:project:${t.projectId}:task:${t._id}`;
}

function template(provider: Provider): Record<string, unknown> {
  const raw = optStr(provider, 'payloadTemplate');
  if (!raw) return {};
  try {
    return obj(JSON.parse(raw));
  } catch {
    throw new ProviderError(`${provider.name}: "Mẫu dữ liệu gửi kèm" không phải JSON hợp lệ.`);
  }
}

function httpError(provider: Provider, status: number, body: string): Error {
  const detail = body.slice(0, 400);
  if (status === 401 || status === 403) return new ProviderError(`${provider.name}: sai API key / token (HTTP ${status}). ${detail}`);
  if (status === 404) return new ProviderError(`${provider.name}: địa chỉ không hỗ trợ (HTTP 404). Kiểm tra lại URL. ${detail}`);
  if (status === 429) return new LimitError(`${provider.name}: quá nhiều yêu cầu (HTTP 429). ${detail}`);
  return new ProviderError(`${provider.name}: HTTP ${status} ${detail}`, status >= 500);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------- Hermes Gateway (HTTP + SSE) ----------------

function hermesBase(provider: Provider): string {
  let base = (provider.baseUrl ?? '').trim().replace(/\/+$/, '');
  try {
    const u = new URL(base);
    // Địa chỉ trang quản trị (:9119) → API nằm ở /api
    if (u.port === '9119' && !u.pathname.startsWith('/api')) base = `${base}/api`;
  } catch {
    throw new ProviderError(`${provider.name}: URL không hợp lệ "${base}".`);
  }
  return base;
}

const TERMINAL = new Set(['completed', 'succeeded', 'success', 'failed', 'error', 'cancelled', 'canceled', 'stopped']);

function runText(o: Record<string, unknown>): string {
  return str(o.output) || str(o.result) || str(o.response) || str(o.text) || str(obj(o.output).text) || str(obj(o.result).text);
}

const hermesGateway: GatewayAdapter = {
  type: 'hermes-gateway',
  async run(r) {
    const { provider, ctx } = r;
    const base = hermesBase(provider);
    const key = sessionKey(r, `vanphong:${ctx.department._id}`);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Idempotency-Key': `${ctx.task._id}:${ctx.task.attempts}`,
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
      ...(key ? { 'X-Hermes-Session-Key': key } : {}),
      ...(provider.headers ?? {}),
    };
    const body = { ...template(provider), input: r.task, instructions: r.system, ...(key ? { session_id: key } : {}), ...(r.model ? { model: r.model } : {}) };
    const res = await fetch(`${base}/v1/runs`, { method: 'POST', headers, body: JSON.stringify(body), signal: ctx.signal });
    const created = await res.text();
    if (!res.ok) throw httpError(provider, res.status, created);
    let runId = '';
    try {
      const j = obj(JSON.parse(created));
      runId = str(j.run_id) || str(j.id);
    } catch {
      /* không phải JSON */
    }
    if (!runId) throw new ProviderError(`${provider.name}: gateway không trả về run_id.`);
    await ctx.log('system', `Hermes Gateway đã nhận việc (run ${runId}).`);

    const timeoutMs = (provider.timeoutSec || 600) * 1000;
    const deadline = Date.now() + timeoutMs;
    let finalRun: Record<string, unknown> | null = null;
    let streamed = '';
    const ac = new AbortController();
    const stop = () => ac.abort();
    ctx.signal.addEventListener('abort', stop);

    // Luồng sự kiện SSE: chữ hiện dần
    const sse = (async () => {
      try {
        const es = await fetch(`${base}/v1/runs/${runId}/events`, { headers: { ...headers, Accept: 'text/event-stream' }, signal: ac.signal });
        if (!es.ok || !es.body) return;
        const reader = es.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        let event = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).replace(/\r$/, '');
            buf = buf.slice(i + 1);
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) {
              let d: Record<string, unknown> = {};
              try {
                d = obj(JSON.parse(line.slice(5).trim()));
              } catch {
                continue;
              }
              const type = event || str(d.type) || str(d.event);
              const delta = str(d.delta) || str(obj(d.data).delta);
              if (/message\.delta|delta/.test(type) && delta) {
                streamed += delta;
                r.emit({ kind: 'delta', text: delta });
              }
              if (/tool/.test(type) && str(d.name)) r.emit({ kind: 'tool', text: str(d.name), tool: str(d.name) });
              const status = (str(d.status) || type.replace(/^run\./, '')).toLowerCase();
              if (TERMINAL.has(status)) finalRun = { ...d, status };
            } else if (!line) event = '';
          }
          if (finalRun) break;
        }
      } catch {
        /* luồng SSE ngắt – vẫn còn hỏi trạng thái */
      }
    })();

    try {
      // Hỏi trạng thái song song (dự phòng khi SSE không có)
      while (!finalRun) {
        if (ctx.signal.aborted) {
          await fetch(`${base}/v1/runs/${runId}/stop`, { method: 'POST', headers }).catch(() => undefined);
          throw new ProviderError('Đã huỷ');
        }
        if (Date.now() > deadline) {
          await fetch(`${base}/v1/runs/${runId}/stop`, { method: 'POST', headers }).catch(() => undefined);
          throw new ProviderError(`${provider.name}: quá ${Math.round(timeoutMs / 60000)} phút chưa xong – đã dừng.`, true);
        }
        await sleep(1000);
        const st = await fetch(`${base}/v1/runs/${runId}`, { headers, signal: ctx.signal }).catch(() => null);
        if (st?.ok) {
          const j = obj(await st.json().catch(() => ({})));
          if (TERMINAL.has(str(j.status).toLowerCase())) finalRun = j;
        }
      }
    } finally {
      ac.abort();
      ctx.signal.removeEventListener('abort', stop);
      await sse;
    }
    const fr = finalRun as Record<string, unknown>;
    const status = str(fr.status).toLowerCase();
    const u = obj(fr.usage);
    r.emit({ kind: 'usage', input: num(u.input_tokens), output: num(u.output_tokens), cached: num(u.cached_input_tokens), costUsd: num(fr.cost_usd) });
    if (!/complete|succe/.test(status)) throw new ProviderError(`${provider.name}: lượt chạy ${status} – ${errorText(fr.error ?? fr.message) || 'không rõ lý do'}`);
    return { text: runText(fr) || streamed };
  },
  async test(provider) {
    const checks: EnvCheck[] = [];
    let base: string;
    try {
      base = hermesBase(provider);
    } catch (err) {
      const url = (provider.baseUrl ?? '').trim().replace(/\/+$/, '');
      return [envCheck('hermes_gateway_url_invalid', 'error', known(err, sysMsg('{name}: URL không hợp lệ "{url}".', { name: provider.name, url })))];
    }
    try {
      const u = new URL(base);
      if (u.protocol === 'http:' && !['127.0.0.1', 'localhost', '::1'].includes(u.hostname)) {
        checks.push(envCheck('hermes_gateway_plain_http', 'warn', sysMsg('Đang dùng http:// tới máy khác – nên dùng https://.')));
      }
      const res = await fetch(`${base}/health`, { headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}, signal: AbortSignal.timeout(5000) });
      checks.push(
        res.ok
          ? envCheck('hermes_gateway_health_ok', 'info', sysMsg('Gateway phản hồi ({status}).', { status: res.status }))
          : envCheck('hermes_gateway_health_failed', res.status === 401 || res.status === 403 ? 'error' : 'warn', sysMsg('Gateway trả về HTTP {status}.', { status: res.status })),
      );
    } catch (err) {
      checks.push(
        envCheck('hermes_gateway_unreachable', 'error', sysMsg('Không kết nối được {url}: {error}', { url: base, error: (err as Error).message }), {
          hint: sysMsg('Kiểm tra gateway đã chạy và địa chỉ đúng.'),
        }),
      );
    }
    return checks;
  },
};

// ---------------- OpenClaw Gateway (WebSocket, giao thức v4) ----------------

const PROTOCOL_VERSION = 4;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

type WsCtor = new (url: string, init?: { headers?: Record<string, string> }) => WebSocket;

function b64url(buf: Buffer): string {
  return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

interface DeviceIdentity {
  deviceId: string;
  publicKey: string;
  privateKeyPem: string;
}

function deviceFromPem(privateKeyPem: string): DeviceIdentity {
  const pub = crypto.createPublicKey(crypto.createPrivateKey(privateKeyPem));
  const spki = pub.export({ type: 'spki', format: 'der' }) as Buffer;
  const raw = spki.length === ED25519_SPKI_PREFIX.length + 32 && spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX) ? spki.subarray(ED25519_SPKI_PREFIX.length) : spki;
  return { deviceId: crypto.createHash('sha256').update(raw).digest('hex'), publicKey: b64url(raw), privateKeyPem };
}

/** Khoá thiết bị Ed25519: tạo một lần rồi lưu vào kết nối để lần sau gateway nhận ra (đã ghép cặp). */
async function deviceIdentity(provider: Provider): Promise<DeviceIdentity | null> {
  if (opt(provider, 'disableDeviceAuth')) return null;
  let pem = provider.secretOptions?.devicePrivateKeyPem;
  if (!pem) {
    pem = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    await updateProvider(provider._id, { secretOptions: { ...(provider.secretOptions ?? {}), devicePrivateKeyPem: pem } });
    provider.secretOptions = { ...(provider.secretOptions ?? {}), devicePrivateKeyPem: pem };
  }
  return deviceFromPem(pem);
}

class GatewayClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; expectFinal: boolean; timer: NodeJS.Timeout }>();
  private nonce: Promise<string>;
  private gotNonce!: (n: string) => void;

  constructor(
    private url: string,
    private headers: Record<string, string>,
    private onEvent: (event: string, payload: Record<string, unknown>) => void,
  ) {
    this.nonce = new Promise((res) => (this.gotNonce = res));
  }

  async connect(params: (nonce: string) => Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
    const WS = globalThis.WebSocket as unknown as WsCtor;
    const ws = new WS(this.url, { headers: this.headers });
    this.ws = ws;
    ws.addEventListener('message', (m: MessageEvent) => this.handle(String(m.data)));
    ws.addEventListener('close', () => this.failAll(new Error('gateway đóng kết nối')));
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        ws.addEventListener('open', () => resolve(), { once: true });
        ws.addEventListener('error', () => reject(new Error('không mở được WebSocket')), { once: true });
      }),
      timeoutMs,
      'quá thời gian mở WebSocket',
    );
    const nonce = await withTimeout(this.nonce, timeoutMs, 'gateway không gửi thử thách kết nối');
    return obj(await this.request('connect', params(nonce), timeoutMs));
  }

  request(method: string, params: unknown, timeoutMs: number, expectFinal = false): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== 1) return Promise.reject(new Error('gateway chưa kết nối'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`gateway quá thời gian (${method})`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, expectFinal, timer });
      this.ws!.send(JSON.stringify({ type: 'req', id, method, params }));
    });
  }

  close() {
    try {
      this.ws?.close(1000, 'vanphong-done');
    } catch {
      /* đã đóng */
    }
    this.ws = null;
  }

  private failAll(err: Error) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  private handle(raw: string) {
    let f: Record<string, unknown>;
    try {
      f = obj(JSON.parse(raw));
    } catch {
      return;
    }
    if (f.type === 'event' && typeof f.event === 'string') {
      const payload = obj(f.payload);
      if (f.event === 'connect.challenge' && str(payload.nonce)) this.gotNonce(str(payload.nonce));
      else this.onEvent(f.event, payload);
      return;
    }
    if (f.type !== 'res' || typeof f.id !== 'string') return;
    const p = this.pending.get(f.id);
    if (!p) return;
    const payload = obj(f.payload);
    if (p.expectFinal && str(payload.status).toLowerCase() === 'accepted') return;
    clearTimeout(p.timer);
    this.pending.delete(f.id);
    if (f.ok) p.resolve(f.payload ?? null);
    else p.reject(new Error(errorText(f.error) || 'gateway từ chối yêu cầu'));
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
}

function openclawConfig(provider: Provider) {
  const url = (provider.baseUrl ?? '').trim();
  if (!/^wss?:\/\//i.test(url)) throw new ProviderError(`${provider.name}: địa chỉ phải bắt đầu bằng ws:// hoặc wss://.`);
  const scopes = (optStr(provider, 'scopes') || 'operator.admin')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    url,
    token: provider.apiKey || null,
    password: provider.secretOptions?.password || null,
    scopes,
    role: 'operator',
    clientId: 'gateway-client',
    clientMode: 'backend',
    headers: { ...(provider.headers ?? {}), ...(provider.apiKey ? { 'x-openclaw-token': provider.apiKey } : {}) },
  };
}

function connectParams(cfg: ReturnType<typeof openclawConfig>, nonce: string, device: DeviceIdentity | null, scopes = cfg.scopes): Record<string, unknown> {
  const signedAt = Date.now();
  const params: Record<string, unknown> = {
    minProtocol: PROTOCOL_VERSION,
    maxProtocol: PROTOCOL_VERSION,
    client: { id: cfg.clientId, version: 'vanphong', platform: process.platform, mode: cfg.clientMode },
    role: cfg.role,
    scopes,
    auth: cfg.token || cfg.password ? { ...(cfg.token ? { token: cfg.token } : {}), ...(cfg.password ? { password: cfg.password } : {}) } : undefined,
  };
  if (device) {
    const payload = ['v3', device.deviceId, cfg.clientId, cfg.clientMode, cfg.role, scopes.join(','), String(signedAt), cfg.token ?? '', nonce, process.platform, ''].join('|');
    const sig = crypto.sign(null, Buffer.from(payload, 'utf8'), crypto.createPrivateKey(device.privateKeyPem));
    params.device = { id: device.deviceId, publicKey: device.publicKey, signature: b64url(sig), signedAt, nonce };
  }
  return params;
}

/** Tự duyệt yêu cầu ghép cặp thiết bị (cần token/mật khẩu chung của gateway). */
async function autoPair(cfg: ReturnType<typeof openclawConfig>, deviceId: string | null): Promise<string | null> {
  if (!cfg.token && !cfg.password) return null;
  const client = new GatewayClient(cfg.url, cfg.headers, () => {});
  try {
    await client.connect((nonce) => connectParams(cfg, nonce, null, [...new Set([...cfg.scopes, 'operator.pairing'])]), 10_000);
    const list = obj(await client.request('device.pair.list', {}, 10_000));
    const pending = ((list.pending as unknown[]) ?? []).map(obj);
    const match = (deviceId ? pending.find((p) => str(p.deviceId) === deviceId) : null) ?? pending[pending.length - 1];
    const requestId = str(match?.requestId);
    if (!requestId) return null;
    await client.request('device.pair.approve', { requestId }, 10_000);
    return requestId;
  } catch {
    return null;
  } finally {
    client.close();
  }
}

const openclawGateway: GatewayAdapter = {
  type: 'openclaw-gateway',
  async run(r) {
    const { provider, ctx } = r;
    const cfg = openclawConfig(provider);
    const device = await deviceIdentity(provider);
    const timeoutMs = (provider.timeoutSec || 1800) * 1000;
    const agentId = optStr(provider, 'agentId');
    let key = sessionKey(r, 'vanphong') ?? `vanphong:run:${ctx.task._id}`;
    if (agentId && !key.startsWith('agent:')) key = `agent:${agentId}:${key}`;
    const runKey = `${ctx.task._id}-${ctx.task.attempts}`;

    for (let attempt = 0; attempt < 2; attempt++) {
      const tracked = new Set([runKey]);
      let chunks = '';
      let lifecycleError: string | null = null;
      const client = new GatewayClient(cfg.url, cfg.headers, (event, payload) => {
        if (event !== 'agent' || !tracked.has(str(payload.runId))) return;
        const data = obj(payload.data);
        const stream = str(payload.stream);
        if (stream === 'assistant') {
          const t = str(data.delta) || str(data.text);
          if (t) {
            chunks += t;
            r.emit({ kind: 'delta', text: t });
          }
        } else if (stream === 'tool' && str(data.name)) r.emit({ kind: 'tool', text: str(data.name), tool: str(data.name) });
        else if (stream === 'error') lifecycleError = str(data.error) || str(data.message) || lifecycleError;
        else if (stream === 'lifecycle' && /error|failed|cancelled/.test(str(data.phase))) lifecycleError = str(data.error) || str(data.message) || lifecycleError;
      });
      const onAbort = () => client.close();
      ctx.signal.addEventListener('abort', onAbort);
      try {
        await client.connect((nonce) => connectParams(cfg, nonce, device), 15_000);
        const params = { ...template(provider), message: r.prompt, sessionKey: key, idempotencyKey: runKey, ...(agentId ? { agentId } : {}), timeout: timeoutMs };
        const accepted = obj(await client.request('agent', params, 30_000));
        const acceptedRunId = str(accepted.runId) || runKey;
        tracked.add(acceptedRunId);
        let result = accepted;
        const status = str(accepted.status).toLowerCase();
        if (status === 'error') throw new ProviderError(`${provider.name}: ${str(accepted.summary) || lifecycleError || 'agent báo lỗi'}`);
        if (status !== 'ok') {
          result = obj(await client.request('agent.wait', { runId: acceptedRunId, timeoutMs }, timeoutMs + 15_000));
          const ws = str(result.status).toLowerCase();
          if (ws === 'timeout') throw new ProviderError(`${provider.name}: agent chạy quá ${Math.round(timeoutMs / 60000)} phút.`, true);
          if (ws === 'error') throw new ProviderError(`${provider.name}: ${str(result.error) || lifecycleError || 'agent báo lỗi'}`);
        }
        const res = obj(result.result);
        const meta = obj(obj(res.meta).agentMeta ?? obj(result.meta).agentMeta);
        const u = obj(meta.usage);
        r.emit({ kind: 'usage', input: num(u.inputTokens), output: num(u.outputTokens), cached: num(u.cacheRead), costUsd: num(meta.costUsd) });
        const text = chunks.trim() || str(res.text) || str(res.summary) || str(res.output) || str(result.summary) || str(result.text);
        return { text };
      } catch (err) {
        if (ctx.signal.aborted) throw err;
        const msg = (err as Error).message ?? '';
        if (attempt === 0 && /pairing required|not paired/i.test(msg) && opt(provider, 'autoPair') !== false) {
          const req = await autoPair(cfg, device?.deviceId ?? null);
          if (req) {
            await ctx.log('system', `OpenClaw: đã tự duyệt ghép cặp thiết bị (${req}) – chạy lại.`);
            continue;
          }
          throw new ProviderError(`${provider.name}: gateway yêu cầu ghép cặp thiết bị. Duyệt thiết bị ${device?.deviceId.slice(0, 12)}… trên OpenClaw rồi chạy lại.`);
        }
        if (err instanceof ProviderError || err instanceof LimitError) throw err;
        throw new ProviderError(`${provider.name}: ${msg}`, /quá thời gian|đóng kết nối|không mở được/.test(msg));
      } finally {
        ctx.signal.removeEventListener('abort', onAbort);
        client.close();
      }
    }
    throw new ProviderError(`${provider.name}: không ghép cặp được thiết bị.`);
  },
  async test(provider) {
    let cfg: ReturnType<typeof openclawConfig>;
    try {
      cfg = openclawConfig(provider);
    } catch (err) {
      return [envCheck('openclaw_gateway_url_invalid', 'error', known(err, sysMsg('{name}: địa chỉ phải bắt đầu bằng ws:// hoặc wss://.', { name: provider.name })))];
    }
    const checks: EnvCheck[] = [];
    const u = new URL(cfg.url);
    if (u.protocol === 'ws:' && !['127.0.0.1', 'localhost', '::1'].includes(u.hostname)) {
      checks.push(envCheck('openclaw_gateway_plaintext', 'warn', sysMsg('Đang dùng ws:// tới máy khác – nên dùng wss://.')));
    }
    if (!cfg.token && !cfg.password) checks.push(envCheck('openclaw_gateway_no_auth', 'warn', sysMsg('Chưa nhập token/mật khẩu gateway.')));
    const client = new GatewayClient(cfg.url, cfg.headers, () => {});
    try {
      const device = await deviceIdentity(provider);
      const hello = await client.connect((nonce) => connectParams(cfg, nonce, device), 5000);
      checks.push(envCheck('openclaw_gateway_probe_ok', 'info', sysMsg('Kết nối được gateway (giao thức {protocol}).', { protocol: num(hello.protocol) || PROTOCOL_VERSION })));
    } catch (err) {
      const msg = (err as Error).message;
      checks.push(
        /pairing required|not paired/i.test(msg)
          ? envCheck('openclaw_gateway_pairing_required', 'warn', sysMsg('Gateway cần ghép cặp thiết bị – lần chạy đầu sẽ tự ghép (nếu có token).'))
          : envCheck('openclaw_gateway_probe_failed', 'error', sysMsg('Không kết nối được: {error}', { error: msg }), { hint: sysMsg('Kiểm tra địa chỉ ws://, token và gateway đã chạy.') }),
      );
    } finally {
      client.close();
    }
    return checks;
  },
};

// ---------------- HTTP webhook ----------------

function callbackBase(provider: Provider): string {
  return (optStr(provider, 'callbackBaseUrl') || process.env.VANPHONG_PUBLIC_URL || `http://127.0.0.1:${process.env.PORT || 2501}`).replace(/\/+$/, '');
}

const httpWebhook: GatewayAdapter = {
  type: 'http-webhook',
  async run(r) {
    const { provider, ctx } = r;
    const url = (provider.baseUrl ?? '').trim();
    if (!/^https?:\/\//i.test(url)) throw new ProviderError(`${provider.name}: URL phải bắt đầu bằng http:// hoặc https://.`);
    const runId = `${ctx.task._id}-${ctx.task.attempts}`;
    const token = newCallbackToken();
    const callbackUrl = `${callbackBase(provider)}/api/agent-callback/${runId}`;
    const timeoutMs = (provider.timeoutSec || 3600) * 1000;
    // Đăng ký chờ trước khi gửi (agent có thể gọi lại rất nhanh)
    const waiting = waitForCallback(runId, token, timeoutMs, ctx.signal, (t) => r.emit({ kind: 'delta', text: t }));
    waiting.catch(() => undefined);
    const body = {
      ...template(provider),
      runId,
      taskId: ctx.task._id,
      projectId: ctx.project._id,
      projectName: ctx.project.name,
      department: { id: ctx.department._id, name: ctx.department.name, role: ctx.department.role },
      model: r.model || null,
      permission: ctx.permission,
      workspace: ctx.root,
      system: r.system,
      task: r.task,
      prompt: r.prompt,
      callbackUrl,
      callbackToken: token,
    };
    const method = optStr(provider, 'method') || 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}), ...(provider.headers ?? {}) },
      body: JSON.stringify(body),
      signal: ctx.signal,
    });
    const text = await res.text();
    if (!res.ok) throw httpError(provider, res.status, text);
    // Trả kết quả ngay trong phản hồi
    try {
      const j = obj(JSON.parse(text));
      const direct = str(j.result) || str(j.text) || str(j.summary) || str(j.output);
      if (direct) return { text: direct };
    } catch {
      /* phản hồi không phải JSON → chờ gọi lại */
    }
    await ctx.log('system', `Đã gửi việc tới ${provider.name}. Đang chờ agent bên ngoài gọi lại…`);
    try {
      const p = await waiting;
      const u = p.usage ?? {};
      r.emit({ kind: 'usage', input: u.inputTokens ?? 0, output: u.outputTokens ?? 0, costUsd: u.costUsd ?? 0 });
      return { text: p.result ?? p.text ?? p.summary ?? '' };
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      throw new ProviderError(`${provider.name}: ${(err as Error).message}`);
    }
  },
  async test(provider) {
    const url = (provider.baseUrl ?? '').trim();
    if (!/^https?:\/\//i.test(url)) return [envCheck('http_url_invalid', 'error', sysMsg('URL phải bắt đầu bằng http:// hoặc https://.'))];
    const checks: EnvCheck[] = [envCheck('http_callback_url', 'info', sysMsg('Agent gọi lại về {url}/api/agent-callback/<runId>.', { url: callbackBase(provider) }))];
    try {
      const res = await fetch(url, { method: 'HEAD', headers: provider.headers ?? {}, signal: AbortSignal.timeout(5000) });
      checks.push(
        res.status < 500
          ? envCheck('http_endpoint_probe_ok', 'info', sysMsg('Địa chỉ phản hồi (HTTP {status}).', { status: res.status }))
          : envCheck('http_endpoint_probe_unexpected_status', 'warn', sysMsg('Địa chỉ trả về HTTP {status}.', { status: res.status })),
      );
    } catch (err) {
      checks.push(envCheck('http_endpoint_probe_failed', 'error', sysMsg('Không kết nối được: {error}', { error: (err as Error).message })));
    }
    return checks;
  },
};

// ---------------- Cursor Cloud (thư viện @cursor/sdk) ----------------

type CursorSdk = typeof import('@cursor/sdk');

async function cursorSdk(): Promise<CursorSdk> {
  try {
    return await import('@cursor/sdk');
  } catch {
    throw new ProviderError('Chưa cài thư viện @cursor/sdk. Chạy: npm i @cursor/sdk');
  }
}

const cursorCloud: GatewayAdapter = {
  type: 'cursor-cloud',
  async run(r) {
    const { provider, ctx } = r;
    if (!provider.apiKey) throw new ProviderError(`${provider.name}: chưa nhập CURSOR_API_KEY.`);
    const repoUrl = optStr(provider, 'repoUrl');
    if (!repoUrl) throw new ProviderError(`${provider.name}: chưa nhập URL repo GitHub.`);
    const { Agent } = await cursorSdk();
    const model = r.model ? { id: r.model } : undefined;
    let agent;
    if (ctx.task.sessionId) {
      try {
        agent = await Agent.resume(ctx.task.sessionId, { apiKey: provider.apiKey });
      } catch {
        agent = null;
      }
    }
    if (!agent) {
      const startingRef = optStr(provider, 'startingRef');
      agent = await Agent.create({
        apiKey: provider.apiKey,
        ...(model ? { model } : {}),
        cloud: {
          repos: [{ url: repoUrl, ...(startingRef ? { startingRef } : {}) }],
          workOnCurrentBranch: Boolean(opt(provider, 'workOnCurrentBranch')),
          // Nhiệm vụ chỉ đọc không được tự tạo Pull Request
          autoCreatePR: ctx.permission !== 'read' && opt(provider, 'autoCreatePR') !== false,
        },
      });
    }
    r.emit({ kind: 'session', id: agent.agentId });
    const run = await agent.send(r.prompt, model ? { model } : undefined);
    const onAbort = () => void run.cancel().catch(() => undefined);
    ctx.signal.addEventListener('abort', onAbort);
    try {
      for await (const m of run.stream()) {
        if (m.type === 'assistant') {
          for (const b of m.message.content) if (b.type === 'text' && b.text) r.emit({ kind: 'delta', text: b.text });
        } else if (m.type === 'tool_call' && m.status === 'running') {
          r.emit({ kind: 'tool', text: m.name, tool: m.name });
        }
      }
      const result = await run.wait();
      if (result.usage) {
        r.emit({ kind: 'usage', input: result.usage.inputTokens + result.usage.cacheReadTokens + result.usage.cacheWriteTokens, output: result.usage.outputTokens, cached: result.usage.cacheReadTokens });
      }
      for (const b of result.git?.branches ?? []) {
        if (b.prUrl) await ctx.log('system', `Cursor Cloud đã tạo Pull Request: ${b.prUrl}`);
      }
      if (result.status !== 'finished') throw new ProviderError(`${provider.name}: lượt chạy ${result.status} – ${result.error?.message ?? 'không rõ lý do'}`);
      return { text: result.result ?? '' };
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
      try {
        agent.close();
      } catch {
        /* đã đóng */
      }
    }
  },
  async test(provider) {
    const checks: EnvCheck[] = [];
    if (!provider.apiKey) return [envCheck('cursor_cloud_api_key_missing', 'error', sysMsg('Chưa nhập CURSOR_API_KEY.'), { hint: sysMsg('Tạo key tại cursor.com/dashboard → Integrations.') })];
    if (!optStr(provider, 'repoUrl')) checks.push(envCheck('cursor_cloud_repo_missing', 'error', sysMsg('Chưa nhập URL repo GitHub.')));
    try {
      const { Cursor } = await cursorSdk();
      const me = obj(await Cursor.me({ apiKey: provider.apiKey }));
      checks.push(envCheck('cursor_cloud_auth_ok', 'info', sysMsg('Đăng nhập Cursor: {account}', { account: str(me.email) || str(me.name) || 'OK' })));
    } catch (err) {
      checks.push(envCheck('cursor_cloud_auth_failed', 'error', sysMsg('API key không hợp lệ: {error}', { error: (err as Error).message })));
    }
    return checks;
  },
  async listModels(provider) {
    if (!provider.apiKey) return [];
    const { Cursor } = await cursorSdk();
    const list = await Cursor.models.list({ apiKey: provider.apiKey });
    return list.map((m) => str(obj(m).id) || str(obj(obj(m).model).id) || str(obj(m).name)).filter(Boolean);
  },
};

const GATEWAYS: Partial<Record<ProviderType, GatewayAdapter>> = {
  'hermes-gateway': hermesGateway,
  'openclaw-gateway': openclawGateway,
  'http-webhook': httpWebhook,
  'cursor-cloud': cursorCloud,
};

export function getGateway(type: ProviderType): GatewayAdapter | null {
  return GATEWAYS[type] ?? null;
}

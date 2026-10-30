// Hạn mức của từng kết nối AI (giống "quota windows" của Paperclip): % giới hạn 5 giờ / 7 ngày của gói Claude,
// số dư tài khoản API (DeepSeek, OpenRouter), số dư token của máy chủ trung gian (one-api / new-api).
// Với Claude Code: đọc cấu hình + phiên đăng nhập của Claude Code trên máy (bạn đã cho phép). Token chỉ gửi tới
// api.anthropic.com hoặc đúng máy chủ trung gian Claude Code đang dùng – API chỉ trả về con số, không bao giờ trả token.
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Provider, ProviderQuota, QuotaWindow } from '../../types';
import { opt } from './adapters/shared';

const cache = new Map<string, { at: number; ttl: number; value: ProviderQuota | null }>();
const TTL = 60_000;
/** Anthropic giới hạn số lần hỏi mức dùng → bị 429 thì chờ lâu hơn rồi mới hỏi lại. */
const TTL_RATE_LIMITED = 5 * 60_000;

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

async function getJson(url: string, headers: Record<string, string>): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  let data: Record<string, unknown> = {};
  try {
    data = obj(await res.json());
  } catch {
    /* không phải JSON */
  }
  return { ok: res.ok, status: res.status, data };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Máy chủ trung gian kiểu one-api / new-api: số dư token qua API tính tiền tương thích OpenAI. */
async function relayBalance(base: string, token: string): Promise<ProviderQuota['balance']> {
  const root = base.replace(/\/+$/, '').replace(/\/v1$/, '');
  const h = { Authorization: `Bearer ${token}` };
  const sub = await getJson(`${root}/v1/dashboard/billing/subscription`, h);
  if (!sub.ok) return null;
  const limit = Number(sub.data.hard_limit_usd ?? sub.data.system_hard_limit_usd ?? NaN);
  if (!Number.isFinite(limit)) return null;
  // Token không giới hạn thường báo hạn mức rất lớn
  if (limit > 1e7) return { label: 'Số dư token', remaining: null, total: null, currency: 'USD', unlimited: true };
  const usage = await getJson(`${root}/v1/dashboard/billing/usage`, h).catch(() => null);
  const used = usage?.ok ? Number(usage.data.total_usage ?? NaN) / 100 : NaN;
  return { label: 'Số dư token', remaining: Number.isFinite(used) ? Math.max(0, limit - used) : limit, total: limit, currency: 'USD' };
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return obj(JSON.parse(await fs.readFile(file, 'utf8')));
  } catch {
    return null;
  }
}

/** Thư mục cấu hình của Claude Code (CLAUDE_CONFIG_DIR hoặc ~/.claude). */
function claudeDir(p: Provider): string {
  return p.env?.CLAUDE_CONFIG_DIR || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

const CLAUDE_WINDOWS: [string, string][] = [
  ['five_hour', '5 giờ'],
  ['seven_day', '7 ngày'],
  ['seven_day_opus', '7 ngày · Opus'],
  ['seven_day_sonnet', '7 ngày · Sonnet'],
];

/**
 * Claude Code: đi qua máy chủ trung gian (ANTHROPIC_BASE_URL trong môi trường hoặc ~/.claude/settings.json) → số dư token;
 * gói Pro/Max → % giới hạn 5 giờ / 7 ngày từ Anthropic bằng phiên đăng nhập của Claude Code (không tự làm mới token,
 * để không làm hỏng phiên của CLI).
 */
async function claudeQuota(p: Provider): Promise<ProviderQuota> {
  const checkedAt = new Date().toISOString();
  const dir = claudeDir(p);
  const settings = obj((await readJson(path.join(dir, 'settings.json')))?.env) as Record<string, string>;
  // Cùng thứ tự Claude Code dùng khi chạy: biến của máy (trừ khi kết nối bỏ qua key của máy) → settings.json → biến riêng của kết nối
  const host: Record<string, string | undefined> = opt(p, 'ignoreHostApiKey') && p.authMode !== 'api_key' ? { ...process.env, ANTHROPIC_API_KEY: undefined, ANTHROPIC_AUTH_TOKEN: undefined } : process.env;
  const env: Record<string, string | undefined> = { ...host, ...settings, ...(p.env ?? {}) };
  const base = env.ANTHROPIC_BASE_URL?.trim();
  const token = (p.authMode === 'api_key' ? p.apiKey : undefined) || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY;
  if (base && !/api\.anthropic\.com/.test(base)) {
    const source = `Máy chủ trung gian ${hostOf(base)}`;
    if (!token) return { source, windows: [], note: 'Không thấy token của máy chủ trung gian để hỏi số dư.', checkedAt };
    const balance = await relayBalance(base, token).catch(() => null);
    return balance ? { source, windows: [], balance, checkedAt } : { source, windows: [], note: 'Máy chủ trung gian không cho đọc số dư.', checkedAt };
  }
  if (p.authMode === 'api_key') return { source: 'Claude API key', windows: [], note: 'Tính tiền theo API key – không có hạn mức gói.', checkedAt };

  let oauth = env.CLAUDE_CODE_OAUTH_TOKEN;
  let plan = '';
  if (!oauth) {
    const creds = obj((await readJson(path.join(dir, '.credentials.json')))?.claudeAiOauth);
    oauth = typeof creds.accessToken === 'string' ? creds.accessToken : undefined;
    plan = typeof creds.subscriptionType === 'string' ? creds.subscriptionType : '';
    const expires = Number(creds.expiresAt ?? 0);
    if (oauth && expires && expires < Date.now()) {
      return { source: 'Gói Claude', windows: [], note: 'Phiên đăng nhập Claude Code đã hết hạn – chạy Claude Code một lần để tự làm mới, rồi bấm làm mới ở đây.', checkedAt };
    }
  }
  const source = plan ? `Claude ${plan.charAt(0).toUpperCase()}${plan.slice(1)}` : 'Gói Claude';
  if (!oauth) return { source, windows: [], note: 'Không thấy phiên đăng nhập Claude Code trên máy (mở terminal, chạy claude rồi /login).', checkedAt };
  const r = await getJson('https://api.anthropic.com/api/oauth/usage', { Authorization: `Bearer ${oauth}`, 'anthropic-beta': 'oauth-2025-04-20' });
  if (r.status === 401 || r.status === 403) return { source, windows: [], note: 'Anthropic từ chối phiên đăng nhập (có thể đã hết hạn) – chạy Claude Code một lần rồi bấm làm mới.', checkedAt };
  if (r.status === 429) return { source, windows: [], error: 'Anthropic đang giới hạn số lần hỏi (HTTP 429) – tự hỏi lại sau 5 phút.', checkedAt };
  if (!r.ok) return { source, windows: [], error: `Anthropic trả về HTTP ${r.status}`, checkedAt };
  const windows: QuotaWindow[] = CLAUDE_WINDOWS.map(([k, label]) => ({ label, w: obj(r.data[k]) }))
    .filter((x) => typeof x.w.utilization === 'number')
    .map((x) => ({ label: x.label, usedPercent: Math.round(x.w.utilization as number), resetsAt: isoFrom(x.w.resets_at) }));
  // Mức dùng thêm theo tháng (khi bật "extra usage" trên claude.ai)
  const extra = obj(r.data.extra_usage);
  if (extra.is_enabled && typeof extra.utilization === 'number') windows.push({ label: 'dùng thêm · tháng', usedPercent: Math.round(extra.utilization), resetsAt: null });
  return windows.length ? { source, windows, checkedAt } : { source, windows, note: 'Anthropic chưa trả về giới hạn nào cho tài khoản này.', checkedAt };
}

function isoFrom(v: unknown): string | null {
  if (typeof v === 'number' && v > 0) return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  if (typeof v === 'string' && v) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

/** CLI dùng gói đăng ký hoặc API key (Codex…). */
async function cliQuota(p: Provider, baseVar: string, tokenVars: string[], plan: string): Promise<ProviderQuota | null> {
  const checkedAt = new Date().toISOString();
  const env: Record<string, string | undefined> = { ...process.env, ...(p.env ?? {}) };
  const base = env[baseVar]?.trim();
  const token = (p.authMode === 'api_key' ? p.apiKey : undefined) || tokenVars.map((k) => env[k]).find(Boolean);
  // Đi qua máy chủ trung gian → hạn mức là số dư token của máy chủ đó
  if (base && token && !/api\.(anthropic|openai)\.com/.test(base)) {
    const source = `Máy chủ trung gian ${hostOf(base)}`;
    const balance = await relayBalance(base, token).catch(() => null);
    return balance ? { source, windows: [], balance, checkedAt } : { source, windows: [], note: 'Máy chủ trung gian không cho đọc số dư.', checkedAt };
  }
  if (p.authMode === 'api_key') return { source: 'API key', windows: [], note: 'Tính tiền theo API key – không có hạn mức gói.', checkedAt };
  return { source: plan, windows: [], needsLocalLogin: true, checkedAt };
}

async function apiQuota(p: Provider): Promise<ProviderQuota | null> {
  const checkedAt = new Date().toISOString();
  if (!p.apiKey) return null;
  const h = { Authorization: `Bearer ${p.apiKey}` };
  if (p.type === 'deepseek') {
    const base = (p.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '').replace(/\/v1$/, '');
    const r = await getJson(`${base}/user/balance`, h);
    const info = obj(((r.data.balance_infos as unknown[]) ?? [])[0]);
    if (!r.ok || !Object.keys(info).length) return { source: 'DeepSeek', windows: [], error: `DeepSeek trả về HTTP ${r.status}`, checkedAt };
    return { source: 'DeepSeek', windows: [], balance: { label: 'Số dư tài khoản', remaining: Number(info.total_balance ?? 0), total: null, currency: String(info.currency ?? 'USD') }, checkedAt };
  }
  if (p.type === 'openrouter') {
    const r = await getJson('https://openrouter.ai/api/v1/credits', h);
    if (!r.ok) return { source: 'OpenRouter', windows: [], error: `OpenRouter trả về HTTP ${r.status}`, checkedAt };
    const d = obj(r.data.data);
    const total = Number(d.total_credits ?? 0);
    return { source: 'OpenRouter', windows: [], balance: { label: 'Số dư credits', remaining: Math.max(0, total - Number(d.total_usage ?? 0)), total, currency: 'USD' }, checkedAt };
  }
  if (p.type === 'openai-compatible' && p.baseUrl) {
    const balance = await relayBalance(p.baseUrl, p.apiKey).catch(() => null);
    if (balance) return { source: `Máy chủ ${hostOf(p.baseUrl)}`, windows: [], balance, checkedAt };
  }
  return { source: 'API key', windows: [], note: 'Nhà cung cấp không có API xem số dư – theo dõi chi phí đã dùng bên dưới.', checkedAt };
}

/** Hạn mức của một kết nối (lưu tạm 60 giây). null = loại kết nối này không có hạn mức để hiện. */
export async function providerQuota(p: Provider, force = false): Promise<ProviderQuota | null> {
  const hit = cache.get(p._id);
  // Bấm làm mới liên tục vẫn chỉ hỏi nhà cung cấp tối đa 1 lần / 15 giây
  if (hit && Date.now() - hit.at < (force ? 15_000 : hit.ttl)) return hit.value;
  let value: ProviderQuota | null = null;
  try {
    if (p.type === 'claude-code') value = await claudeQuota(p);
    else if (p.type === 'codex') value = await cliQuota(p, 'OPENAI_BASE_URL', ['OPENAI_API_KEY'], 'Gói ChatGPT');
    else if (p.kind === 'cli' && p.authMode === 'api_key') value = { source: 'API key', windows: [], note: 'Tính tiền theo API key – không có hạn mức gói.', checkedAt: new Date().toISOString() };
    else if (p.kind === 'api') value = await apiQuota(p);
  } catch (err) {
    value = { source: p.name, windows: [], error: err instanceof Error ? err.message : String(err), checkedAt: new Date().toISOString() };
  }
  cache.set(p._id, { at: Date.now(), ttl: value?.error?.includes('429') ? TTL_RATE_LIMITED : TTL, value });
  return value;
}

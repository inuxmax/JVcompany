// Đăng nhập OAuth cho máy chủ MCP từ xa (theo đặc tả MCP Authorization): dò máy chủ cấp quyền từ máy chủ MCP,
// tự đăng ký ứng dụng (Dynamic Client Registration), PKCE S256, đổi mã lấy token, tự làm mới token.
// Token cất trong kho bí mật; cấu hình kết nối chỉ giữ tham chiếu "Bearer secret:…".
import crypto from 'crypto';
import type { McpConnection, McpOAuthState } from '../types';
import { currentCompanyId, getCollections, now, runWithCompany } from './db';
import { emit } from './bus';
import { logActivity } from './activity';
import { resolveSecretRefs, upsertSecretValue } from './secrets';
import { LocalizedError } from './http';
import { m } from '../i18n';

interface Pending {
  connectionId: string;
  companyId: string;
  verifier: string;
  clientId: string;
  clientSecret: string | null;
  tokenEndpoint: string;
  redirectUri: string;
  resource: string;
  scope: string | null;
  createdAt: number;
}

const g = globalThis as unknown as { __vpMcpOAuth?: Map<string, Pending> };
const pending: Map<string, Pending> = (g.__vpMcpOAuth ??= new Map());
const TEN_MINUTES = 10 * 60_000;

const b64url = (b: Buffer) => b.toString('base64url');
const secretBase = (key: string) => `MCP_${key.replace(/-/g, '_').toUpperCase()}`;

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Địa chỉ ".well-known" theo kiểu chèn đường dẫn (RFC 8414 / RFC 9728) – thử cả bản không có đường dẫn. */
function wellKnown(base: string, name: string): string[] {
  const u = new URL(base);
  const p = u.pathname.replace(/\/+$/, '');
  const list = [`${u.origin}/.well-known/${name}${p && p !== '/' ? p : ''}`, `${u.origin}/.well-known/${name}`];
  return Array.from(new Set(list));
}

/** Tìm máy chủ cấp quyền của một máy chủ MCP: 401 + WWW-Authenticate (resource_metadata) → protected-resource → authorization server. */
async function discover(resource: string): Promise<{ issuer: string; meta: Record<string, unknown>; scopes: string[] }> {
  let resourceMeta: Record<string, unknown> | null = null;
  try {
    const res = await fetch(resource, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'van-phong-ai', version: '2.0.0' } } }),
      signal: AbortSignal.timeout(15_000),
    });
    const hdr = res.headers.get('www-authenticate') ?? '';
    const m = /resource_metadata="([^"]+)"/i.exec(hdr);
    if (m) resourceMeta = await getJson(m[1]);
  } catch {
    /* máy chủ không phản hồi – thử .well-known */
  }
  if (!resourceMeta) {
    for (const u of wellKnown(resource, 'oauth-protected-resource')) {
      resourceMeta = await getJson(u);
      if (resourceMeta) break;
    }
  }
  const servers = Array.isArray(resourceMeta?.authorization_servers) ? (resourceMeta!.authorization_servers as string[]) : [];
  const issuer = servers[0] ?? new URL(resource).origin;
  let meta: Record<string, unknown> | null = null;
  for (const u of [...wellKnown(issuer, 'oauth-authorization-server'), ...wellKnown(issuer, 'openid-configuration')]) {
    meta = await getJson(u);
    if (meta?.authorization_endpoint && meta?.token_endpoint) break;
    meta = null;
  }
  if (!meta) throw new LocalizedError(m('Máy chủ MCP này không công bố máy chủ đăng nhập OAuth – hãy dùng token (nếu nhà cung cấp hỗ trợ) hoặc kiểm tra lại địa chỉ.'));
  const scopes = Array.isArray(resourceMeta?.scopes_supported) ? (resourceMeta!.scopes_supported as string[]) : [];
  return { issuer, meta, scopes };
}

/**
 * Bắt đầu đăng nhập: trả về địa chỉ để mở trong trình duyệt. Sau khi bạn đồng ý, nhà cung cấp chuyển về
 * `redirectUri` (/api/connections/oauth/callback) và `finishOAuth` lưu token.
 */
export async function startOAuth(connectionId: string, redirectUri: string): Promise<{ url: string }> {
  const c = await getCollections();
  const conn = await c.mcpConnections.findOne({ _id: connectionId });
  if (!conn) throw new LocalizedError(m('Không tìm thấy kết nối'), undefined, 404);
  if (conn.transport !== 'http' || !conn.url || conn.url.startsWith('secret:')) throw new LocalizedError(m('Chỉ kết nối MCP từ xa (HTTP) mới đăng nhập OAuth được.'));
  const resource = conn.url;
  const { meta, scopes } = await discover(resource);
  // Đăng ký ứng dụng tự động (mỗi lần đăng nhập lại cũng an toàn – nhà cung cấp cấp client_id mới)
  let clientId = '';
  let clientSecret: string | null = null;
  if (typeof meta.registration_endpoint === 'string') {
    const res = await fetch(meta.registration_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_name: 'Văn Phòng AI',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new LocalizedError(m('Nhà cung cấp từ chối đăng ký ứng dụng (HTTP {status}): {detail}'), { status: res.status, detail: (await res.text()).slice(0, 300) }, 500);
    const reg = (await res.json()) as { client_id?: string; client_secret?: string };
    clientId = reg.client_id ?? '';
    clientSecret = reg.client_secret ?? null;
  }
  if (!clientId) throw new LocalizedError(m('Nhà cung cấp không hỗ trợ đăng ký ứng dụng tự động – chưa kết nối OAuth được với máy chủ này.'));
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(24));
  const scope = scopes.length ? scopes.join(' ') : typeof meta.scopes_supported === 'object' && Array.isArray(meta.scopes_supported) ? null : null;
  for (const [k, p] of pending) if (Date.now() - p.createdAt > TEN_MINUTES) pending.delete(k);
  pending.set(state, { connectionId, companyId: await currentCompanyId(), verifier, clientId, clientSecret, tokenEndpoint: String(meta.token_endpoint), redirectUri, resource, scope, createdAt: Date.now() });
  const url = new URL(String(meta.authorization_endpoint));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('resource', resource);
  if (scope) url.searchParams.set('scope', scope);
  return { url: url.toString() };
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(endpoint: string, form: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !j.access_token) throw new LocalizedError(m('Không lấy được token: {detail}'), { detail: j.error_description ?? j.error ?? `HTTP ${res.status}` }, 500);
  return j;
}

async function storeTokens(conn: McpConnection, base: Omit<McpOAuthState, 'accessKey' | 'refreshKey' | 'expiresAt'>, t: TokenResponse): Promise<void> {
  const c = await getCollections();
  const prefix = secretBase(conn.key);
  const accessKey = `${prefix}_OAUTH_ACCESS`;
  await upsertSecretValue(accessKey, t.access_token!, `Token đăng nhập ${conn.name}`);
  let refreshKey = conn.oauth?.refreshKey ?? null;
  if (t.refresh_token) {
    refreshKey = `${prefix}_OAUTH_REFRESH`;
    await upsertSecretValue(refreshKey, t.refresh_token, `Token làm mới ${conn.name}`);
  }
  const oauth: McpOAuthState = {
    ...base,
    accessKey,
    refreshKey,
    expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : null,
    scope: t.scope ?? base.scope ?? null,
  };
  await c.mcpConnections.updateOne(
    { _id: conn._id },
    { $set: { oauth, headers: { ...(conn.headers ?? {}), Authorization: `Bearer secret:${accessKey}` }, updatedAt: now() } },
  );
}

/** Nhà cung cấp chuyển về sau khi bạn đồng ý: đổi mã lấy token, lưu vào kho bí mật, tải danh sách thao tác. */
export async function finishOAuth(state: string, code: string): Promise<McpConnection> {
  const p = pending.get(state);
  pending.delete(state);
  if (!p || Date.now() - p.createdAt > TEN_MINUTES) throw new LocalizedError(m('Phiên đăng nhập đã hết hạn – bấm "Kết nối" lại.'));
  return runWithCompany(p.companyId, async () => {
    const c = await getCollections();
    const conn = await c.mcpConnections.findOne({ _id: p.connectionId });
    if (!conn) throw new LocalizedError(m('Kết nối không còn tồn tại'), undefined, 404);
    const t = await tokenRequest(p.tokenEndpoint, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: p.redirectUri,
      client_id: p.clientId,
      code_verifier: p.verifier,
      resource: p.resource,
      ...(p.clientSecret ? { client_secret: p.clientSecret } : {}),
    });
    let clientSecretKey: string | null = null;
    if (p.clientSecret) {
      clientSecretKey = `${secretBase(conn.key)}_OAUTH_CLIENT_SECRET`;
      await upsertSecretValue(clientSecretKey, p.clientSecret, `Client secret OAuth ${conn.name}`);
    }
    await storeTokens(conn, { clientId: p.clientId, clientSecretKey, tokenEndpoint: p.tokenEndpoint, resource: p.resource, connectedAt: now(), scope: p.scope }, t);
    await logActivity({ action: 'connection.oauth_connected', entityType: 'connection', entityId: conn._id, summary: `Đăng nhập ${conn.name} qua OAuth` });
    const { refreshTools } = await import('./connections');
    const fresh = await refreshTools(conn._id).catch(async () => (await c.mcpConnections.findOne({ _id: conn._id }))!);
    await emit('connection.updated', null, { id: conn._id });
    return fresh;
  });
}

/** Token sắp hết hạn (còn < 2 phút) → dùng refresh token xin token mới. */
export async function ensureFreshToken(conn: McpConnection): Promise<void> {
  const o = conn.oauth;
  if (!o?.refreshKey || !o.expiresAt) return;
  if (new Date(o.expiresAt).getTime() - Date.now() > 120_000) return;
  const refs: Record<string, string> = { refresh: `secret:${o.refreshKey}` };
  if (o.clientSecretKey) refs.secret = `secret:${o.clientSecretKey}`;
  const r = await resolveSecretRefs(refs, { label: `Làm mới đăng nhập ${conn.name}` });
  const t = await tokenRequest(o.tokenEndpoint, {
    grant_type: 'refresh_token',
    refresh_token: r.map.refresh,
    client_id: o.clientId,
    resource: o.resource,
    ...(r.map.secret ? { client_secret: r.map.secret } : {}),
  });
  await storeTokens(conn, { clientId: o.clientId, clientSecretKey: o.clientSecretKey ?? null, tokenEndpoint: o.tokenEndpoint, resource: o.resource, connectedAt: o.connectedAt ?? null, scope: o.scope ?? null }, t);
  // Bản trong bộ nhớ của lượt chạy hiện tại cũng dùng token mới
  conn.oauth = (await (await getCollections()).mcpConnections.findOne({ _id: conn._id }))?.oauth ?? conn.oauth;
}

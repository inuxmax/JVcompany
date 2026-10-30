// Kết nối dịch vụ cho agent (theo Paperclip "MCP / service connections"): máy chủ MCP qua stdio hoặc HTTP,
// mỗi thao tác có chính sách Cho phép / Hỏi trước / Tắt.
// - Claude Code: ghi --mcp-config + hook PreToolUse gọi về /api/mcp/hook để quyết định (Hỏi trước → thẻ phê duyệt).
// - Kết nối API (Claude API / OpenAI…): thao tác MCP thành công cụ của agent, gọi qua máy khách MCP trong ứng dụng.
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import spawn from 'cross-spawn';
import type { ChildProcess } from 'child_process';
import type { McpConnection, McpPolicy, McpTool, PermissionLevel } from '../types';
import { MCP_KEY_RE, MCP_PRESETS, looksReadOnly, mcpToolName } from '../connections-catalog';
import { currentCompanyId, getCollections, newId, now, runWithCompany } from './db';
import { emit } from './bus';
import { logActivity } from './activity';
import { appDataDir, killTree } from './platform';
import { resolveSecretRefs, upsertSecretValue } from './secrets';
import { CHILD_ENV } from './agent/adapters/shared';
import { isReadOnlyCommand, type PermissionRequest } from './agent/permissions';
import { isInside } from './fsbrowse';
import { LocalizedError } from './http';
import { m } from '../i18n';

// ---------------- Dữ liệu ----------------

export async function listConnections(): Promise<McpConnection[]> {
  const c = await getCollections();
  return c.mcpConnections.find().sort({ createdAt: 1 }).toArray();
}

export async function getConnection(id: string): Promise<McpConnection | null> {
  const c = await getCollections();
  return c.mcpConnections.findOne({ _id: id });
}

export interface ConnectionInput {
  name?: string;
  key?: string;
  kind?: McpConnection['kind'];
  transport?: McpConnection['transport'];
  enabled?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  defaultPolicy?: McpPolicy;
  departments?: string[];
  /** Token nhập trực tiếp → lưu vào kho bí mật rồi tham chiếu "secret:KHOA". */
  token?: string;
  presetId?: string;
}

const POLICIES: McpPolicy[] = ['allow', 'ask', 'off'];
const cleanMap = (m: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries(m && typeof m === 'object' ? (m as Record<string, unknown>) : {})
      .map(([k, v]) => [k.trim(), String(v ?? '')] as const)
      .filter(([k]) => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(k)),
  );

export async function saveConnection(id: string | null, input: ConnectionInput): Promise<McpConnection> {
  const c = await getCollections();
  const existing = id ? await c.mcpConnections.findOne({ _id: id }) : null;
  if (id && !existing) throw new LocalizedError(m('Không tìm thấy kết nối'), undefined, 404);
  const preset = MCP_PRESETS.find((p) => p.id === input.presetId) ?? MCP_PRESETS.find((p) => p.kind === (input.kind ?? existing?.kind) && p.kind !== 'custom');
  const key = (input.key ?? existing?.key ?? preset?.key ?? '').trim().toLowerCase();
  if (!MCP_KEY_RE.test(key)) throw new LocalizedError(m('Mã kết nối: 2–31 ký tự chữ thường, số, gạch ngang, bắt đầu bằng chữ.'));
  const dup = await c.mcpConnections.findOne({ key, ...(existing ? { _id: { $ne: existing._id } } : {}) });
  if (dup) throw new LocalizedError(m('Đã có kết nối mã "{key}".'), { key });
  const transport = input.transport ?? existing?.transport ?? preset?.transport ?? 'stdio';
  const env = input.env !== undefined ? cleanMap(input.env) : (existing?.env ?? {});
  const headers = input.headers !== undefined ? cleanMap(input.headers) : (existing?.headers ?? {});
  // Token nhập tay → kho bí mật; cấu hình chỉ giữ tham chiếu
  if (input.token?.trim()) {
    const secretKey = preset?.token?.secretKey ?? `MCP_${key.replace(/-/g, '_').toUpperCase()}_TOKEN`;
    await upsertSecretValue(secretKey, input.token.trim(), `Token kết nối dịch vụ ${input.name ?? existing?.name ?? key}`);
    if (transport === 'http') headers[preset?.token?.header ?? 'Authorization'] = `${preset?.token?.prefix ?? 'Bearer '}secret:${secretKey}`;
    else env[preset?.token?.env ?? `${key.replace(/-/g, '_').toUpperCase()}_TOKEN`] = `secret:${secretKey}`;
  }
  const ts = now();
  const doc: McpConnection = {
    _id: existing?._id ?? newId(),
    name: (input.name ?? existing?.name ?? preset?.label ?? key).trim().slice(0, 80),
    key,
    kind: input.kind ?? existing?.kind ?? preset?.kind ?? 'custom',
    transport,
    enabled: input.enabled ?? existing?.enabled ?? true,
    command: transport === 'stdio' ? (input.command ?? existing?.command ?? preset?.command ?? '').trim() : undefined,
    args: transport === 'stdio' ? (input.args ?? existing?.args ?? preset?.args ?? []).map(String).filter((a) => a !== '') : undefined,
    env,
    url: transport === 'http' ? (input.url ?? existing?.url ?? preset?.url ?? '').trim() : undefined,
    headers,
    defaultPolicy: POLICIES.includes(input.defaultPolicy as McpPolicy) ? (input.defaultPolicy as McpPolicy) : (existing?.defaultPolicy ?? 'ask'),
    tools: existing?.tools ?? [],
    departments: Array.isArray(input.departments) ? input.departments.map(String) : (existing?.departments ?? []),
    status: existing?.status,
    // Giữ nguồn gốc (danh bạ / plugin) và trạng thái đăng nhập OAuth khi sửa cấu hình hay bật / tắt
    directoryId: existing?.directoryId ?? null,
    pluginId: existing?.pluginId ?? null,
    oauth: existing?.oauth ?? null,
    createdAt: existing?.createdAt ?? ts,
    updatedAt: ts,
  };
  if (doc.transport === 'stdio' && !doc.command) throw new LocalizedError(m('Nhập lệnh chạy máy chủ MCP.'));
  if (doc.transport === 'http' && !/^(https?:\/\/|secret:[A-Z])/.test(doc.url ?? '')) throw new LocalizedError(m('Nhập địa chỉ HTTP(S) của máy chủ MCP.'));
  await c.mcpConnections.replaceOne({ _id: doc._id }, doc, { upsert: true });
  await emit('connection.updated', null, { id: doc._id });
  await logActivity({ action: existing ? 'connection.updated' : 'connection.created', entityType: 'connection', entityId: doc._id, summary: `${existing ? 'Sửa' : 'Thêm'} kết nối dịch vụ ${doc.name}` });
  return doc;
}

export async function setToolPolicies(id: string, policies: Record<string, McpPolicy>, defaultPolicy?: McpPolicy): Promise<McpConnection | null> {
  const c = await getCollections();
  const conn = await c.mcpConnections.findOne({ _id: id });
  if (!conn) return null;
  const tools = conn.tools.map((t) => (POLICIES.includes(policies[t.name]) ? { ...t, policy: policies[t.name] } : t));
  await c.mcpConnections.updateOne({ _id: id }, { $set: { tools, ...(defaultPolicy && POLICIES.includes(defaultPolicy) ? { defaultPolicy } : {}), updatedAt: now() } });
  await emit('connection.updated', null, { id });
  await logActivity({ action: 'connection.policies_updated', entityType: 'connection', entityId: id, summary: `Đổi quyền thao tác của ${conn.name}`, details: { policies } });
  return c.mcpConnections.findOne({ _id: id });
}

export async function deleteConnection(id: string): Promise<void> {
  const c = await getCollections();
  const conn = await c.mcpConnections.findOne({ _id: id });
  await c.mcpConnections.deleteOne({ _id: id });
  await emit('connection.updated', null, { id, deleted: true });
  if (conn) await logActivity({ action: 'connection.deleted', entityType: 'connection', entityId: id, summary: `Xoá kết nối dịch vụ ${conn.name}` });
}

export function policyFor(conn: Pick<McpConnection, 'tools' | 'defaultPolicy'>, tool: string): McpPolicy {
  return conn.tools.find((t) => t.name === tool)?.policy ?? conn.defaultPolicy;
}

// ---------------- Máy khách MCP (stdio / Streamable HTTP) ----------------

const PROTOCOL = '2025-06-18';
const CLIENT_INFO = { name: 'van-phong-ai', version: '2.0.0' };

interface RpcResponse {
  id?: number | string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; localized?: LocalizedError };
}

export interface ResolvedConn {
  conn: McpConnection;
  env: Record<string, string>;
  headers: Record<string, string>;
  /** Địa chỉ máy chủ đã giải bí mật (vd Zapier: mã bí mật nằm trong địa chỉ). */
  url: string;
  /** Tham số lệnh đã giải bí mật. */
  args: string[];
  secretValues: string[];
}

export async function resolveConnection(conn: McpConnection, who: { taskId?: string; label: string }): Promise<ResolvedConn> {
  // Đăng nhập OAuth: làm mới token sắp hết hạn trước khi dùng
  if (conn.oauth) {
    const { ensureFreshToken } = await import('./mcp-oauth');
    await ensureFreshToken(conn).catch(() => undefined);
  }
  const env = await resolveSecretRefs(conn.env, who);
  const headers = await resolveSecretRefs(conn.headers, who);
  const url = await resolveSecretRefs(conn.url ? { url: conn.url } : {}, who);
  const args = await resolveSecretRefs(Object.fromEntries((conn.args ?? []).map((a, i) => [String(i), a])), who);
  return {
    conn,
    env: env.map,
    headers: headers.map,
    url: url.map.url ?? '',
    args: (conn.args ?? []).map((_, i) => args.map[String(i)]),
    secretValues: [...env.values, ...headers.values, ...url.values, ...args.values],
  };
}

export class McpClient {
  private child: ChildProcess | null = null;
  private buf = '';
  private nextId = 1;
  private waiting = new Map<number, (r: RpcResponse) => void>();
  private sessionId: string | null = null;
  private stderr = '';
  serverName = '';

  constructor(private r: ResolvedConn) {}

  async connect(timeoutMs = 90_000): Promise<void> {
    const { conn } = this.r;
    if (conn.transport === 'stdio') {
      this.child = spawn(conn.command!, this.r.args, { env: { ...CHILD_ENV, ...this.r.env } as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      this.child.stdout?.setEncoding('utf8');
      this.child.stdout?.on('data', (chunk: string) => this.onData(chunk));
      this.child.stderr?.on('data', (d: Buffer) => (this.stderr = (this.stderr + d.toString()).slice(-4000)));
      this.child.on('exit', (code) => {
        const e = new LocalizedError(m('Máy chủ MCP đã thoát (mã {code}). {detail}'), { code: String(code), detail: this.stderr.trim().slice(-600) }, 500);
        for (const [, cb] of this.waiting) cb({ error: { code: -1, message: e.message, localized: e } });
        this.waiting.clear();
      });
      this.child.on('error', (err) => {
        const e = new LocalizedError(m('Không chạy được "{command}": {error}'), { command: String(conn.command), error: err.message }, 500);
        for (const [, cb] of this.waiting) cb({ error: { code: -1, message: e.message, localized: e } });
        this.waiting.clear();
      });
    }
    const init = await this.request('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: CLIENT_INFO }, timeoutMs);
    const info = (init.serverInfo ?? {}) as { name?: string; version?: string };
    this.serverName = [info.name, info.version].filter(Boolean).join(' ');
    await this.notify('notifications/initialized');
  }

  private onData(chunk: string) {
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line.startsWith('{')) continue;
      try {
        this.deliver(JSON.parse(line) as RpcResponse);
      } catch {
        /* dòng không phải JSON-RPC */
      }
    }
  }

  private deliver(msg: RpcResponse) {
    if (typeof msg.id !== 'number') return;
    const cb = this.waiting.get(msg.id);
    if (cb) {
      this.waiting.delete(msg.id);
      cb(msg);
    }
  }

  private async postHttp(body: Record<string, unknown>, wantId: number | null, timeoutMs: number): Promise<RpcResponse | null> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...this.r.headers,
      ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
      ...(wantId !== 1 ? { 'mcp-protocol-version': PROTOCOL } : {}),
    };
    const res = await fetch(this.r.url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;
    if (wantId === null) return null;
    if (!res.ok) {
      const text = (await res.text()).slice(0, 500);
      throw res.status === 401 || res.status === 403 ? new LocalizedError(m('Máy chủ từ chối xác thực (HTTP {status}) – kiểm tra token. {detail}'), { status: res.status, detail: text }, 500) : new Error(`HTTP ${res.status}: ${text}`);
    }
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('text/event-stream')) {
      const text = await res.text();
      for (const block of text.split(/\r?\n\r?\n/)) {
        const data = block
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('\n');
        if (!data) continue;
        try {
          const msg = JSON.parse(data) as RpcResponse;
          if (msg.id === wantId) return msg;
        } catch {
          /* bỏ qua */
        }
      }
      throw new LocalizedError(m('Máy chủ MCP không trả kết quả.'), undefined, 500);
    }
    return (await res.json()) as RpcResponse;
  }

  async request(method: string, params: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    const body = { jsonrpc: '2.0', id, method, params };
    let msg: RpcResponse | null;
    if (this.r.conn.transport === 'http') {
      msg = await this.postHttp(body, id, timeoutMs);
    } else {
      msg = await new Promise<RpcResponse>((resolve) => {
        const timer = setTimeout(() => {
          this.waiting.delete(id);
          const e = new LocalizedError(m('Máy chủ MCP không phản hồi "{method}" sau {seconds} giây. {detail}'), { method, seconds: Math.round(timeoutMs / 1000), detail: this.stderr.trim().slice(-400) }, 500);
          resolve({ error: { code: -2, message: e.message, localized: e } });
        }, timeoutMs);
        this.waiting.set(id, (r) => {
          clearTimeout(timer);
          resolve(r);
        });
        this.child?.stdin?.write(JSON.stringify(body) + '\n');
      });
    }
    if (!msg) throw new LocalizedError(m('Không có phản hồi'), undefined, 500);
    if (msg.error) throw msg.error.localized ?? new Error(msg.error.message);
    return msg.result ?? {};
  }

  async notify(method: string, params: Record<string, unknown> = {}): Promise<void> {
    const body = { jsonrpc: '2.0', method, params };
    if (this.r.conn.transport === 'http') await this.postHttp(body, null, 15_000).catch(() => null);
    else this.child?.stdin?.write(JSON.stringify(body) + '\n');
  }

  async listTools(): Promise<{ name: string; description?: string; inputSchema?: Record<string, unknown>; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }[]> {
    const out: { name: string; description?: string; inputSchema?: Record<string, unknown>; annotations?: { readOnlyHint?: boolean } }[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const r = await this.request('tools/list', cursor ? { cursor } : {});
      out.push(...((r.tools as typeof out) ?? []));
      cursor = typeof r.nextCursor === 'string' && r.nextCursor ? r.nextCursor : undefined;
      if (!cursor) break;
    }
    return out;
  }

  async callTool(name: string, args: Record<string, unknown>, timeoutMs = 10 * 60_000): Promise<{ text: string; isError: boolean }> {
    const r = await this.request('tools/call', { name, arguments: args }, timeoutMs);
    const parts = (Array.isArray(r.content) ? r.content : []) as { type?: string; text?: string; mimeType?: string; resource?: { uri?: string; text?: string } }[];
    const text = parts
      .map((p) => (p.type === 'text' ? (p.text ?? '') : p.type === 'resource' ? (p.resource?.text ?? p.resource?.uri ?? '') : `[${p.type ?? 'nội dung'}${p.mimeType ? ` ${p.mimeType}` : ''}]`))
      .join('\n')
      .trim();
    return { text: text || (r.structuredContent ? JSON.stringify(r.structuredContent) : '(không có nội dung)'), isError: r.isError === true };
  }

  close() {
    if (this.r.conn.transport === 'http' && this.sessionId) {
      void fetch(this.r.url, { method: 'DELETE', headers: { ...this.r.headers, 'mcp-session-id': this.sessionId } }).catch(() => null);
    }
    if (this.child) {
      try {
        this.child.stdin?.end();
      } catch {
        /* bỏ qua */
      }
      killTree(this.child);
      this.child = null;
    }
  }
}

/** Kết nối thử + tải danh sách thao tác; giữ chính sách đã chọn, thao tác mới lấy mặc định (đọc → cho phép, còn lại → mặc định của kết nối). */
export async function refreshTools(id: string): Promise<McpConnection> {
  const c = await getCollections();
  const conn = await c.mcpConnections.findOne({ _id: id });
  if (!conn) throw new LocalizedError(m('Không tìm thấy kết nối'), undefined, 404);
  const client = new McpClient(await resolveConnection(conn, { label: `Kết nối ${conn.name}` }));
  try {
    await client.connect();
    const listed = await client.listTools();
    const prev = new Map(conn.tools.map((t) => [t.name, t]));
    const tools: McpTool[] = listed.map((t) => {
      const readOnly = t.annotations?.readOnlyHint ?? looksReadOnly(t.name);
      return {
        name: t.name,
        description: (t.description ?? '').slice(0, 600),
        inputSchema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} },
        readOnly,
        policy: prev.get(t.name)?.policy ?? (readOnly ? 'allow' : conn.defaultPolicy === 'allow' ? 'ask' : conn.defaultPolicy),
      };
    });
    const status = { ok: true, message: `Đã kết nối – ${tools.length} thao tác`, checkedAt: now(), serverName: client.serverName };
    await c.mcpConnections.updateOne({ _id: id }, { $set: { tools, status, updatedAt: now() } });
    await emit('connection.updated', null, { id });
    return (await c.mcpConnections.findOne({ _id: id }))!;
  } catch (err) {
    const status = { ok: false, message: err instanceof Error ? err.message : String(err), checkedAt: now() };
    await c.mcpConnections.updateOne({ _id: id }, { $set: { status, updatedAt: now() } });
    await emit('connection.updated', null, { id });
    throw err;
  } finally {
    client.close();
  }
}

// ---------------- Đưa vào lượt chạy agent ----------------

/** Kết nối đang bật mà phòng được dùng. */
export async function connectionsFor(departmentId: string): Promise<McpConnection[]> {
  const c = await getCollections();
  const all = await c.mcpConnections.find({ enabled: true }).toArray();
  return all.filter((x) => !x.departments.length || x.departments.includes(departmentId));
}

interface HookRun {
  taskId: string;
  /** Công ty của lượt chạy (hook gọi về không mang cookie). */
  companyId?: string;
  connections: McpConnection[];
  /** Thư mục dự án + thư mục thêm (kỹ năng, ảnh đính kèm) – ghi tệp trong đây không cần hỏi. */
  roots: string[];
  /** Mức quyền của nhiệm vụ (chỉ đọc → chỉ thao tác MCP dạng đọc). */
  permission?: PermissionLevel;
  /**
   * Xin phép theo quy tắc chung của ứng dụng (permissions.ts): cho phép / từ chối / tạo thẻ phê duyệt rồi chờ.
   * Trả về null = được phép, chuỗi = lý do từ chối.
   */
  request: (req: PermissionRequest) => Promise<string | null>;
  log: (text: string) => Promise<void>;
}

const g = globalThis as unknown as { __vpMcpRuns?: Map<string, HookRun> };
const hookRuns: Map<string, HookRun> = (g.__vpMcpRuns ??= new Map());

/** Địa chỉ ứng dụng cho tiến trình con gọi về (hook của Claude Code). */
export function localOrigin(): string {
  return `http://127.0.0.1:${process.env.PORT || 2501}`;
}

const HOOK_SCRIPT = `// Hook PreToolUse của Văn Phòng AI: hỏi ứng dụng có cho chạy thao tác không (lệnh shell, ghi tệp, thao tác MCP).
// Dùng http.request (không giới hạn thời gian) thay vì fetch: fetch bỏ cuộc sau 5 phút trong khi chủ công ty có thể duyệt lâu hơn.
// "defer" = không phải việc của Văn Phòng AI → không in gì, để Claude Code tự quyết theo quyền của nó.
const http = require('http');
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const done = (decision, reason) => {
    if (decision !== 'defer') process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision === 'allow' ? 'allow' : 'deny', permissionDecisionReason: reason || '' } }));
    process.exit(0);
  };
  const fail = (e) => done('deny', 'Không liên lạc được Văn Phòng AI để xin phép thao tác này. ' + (e && e.message ? e.message : e || ''));
  try {
    const body = Buffer.from(input || '{}');
    const req = http.request(process.env.VP_HOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': body.length, 'x-vp-hook-token': process.env.VP_HOOK_TOKEN || '' } }, (res) => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (out += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(out);
          done(j.decision, j.reason);
        } catch (e) {
          fail(e);
        }
      });
    });
    req.setTimeout(0);
    req.on('error', fail);
    req.end(body);
  } catch (e) {
    fail(e);
  }
});
`;

async function hookScriptPath(): Promise<string> {
  const dir = path.join(appDataDir(), 'mcp');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'vp-mcp-hook.cjs');
  try {
    if ((await fs.readFile(file, 'utf8')) === HOOK_SCRIPT) return file;
  } catch {
    /* chưa có */
  }
  await fs.writeFile(file, HOOK_SCRIPT, 'utf8');
  return file;
}

export interface ClaudeHookRun {
  args: string[];
  env: Record<string, string>;
  secretValues: string[];
  cleanup: () => Promise<void>;
}

/** Công cụ ghi tệp của Claude Code (đường dẫn trong file_path / notebook_path). */
const FILE_TOOLS = 'Edit|Write|MultiEdit|NotebookEdit';
/** Công cụ chạy lệnh (Claude Code dùng Bash; bản Windows mới có thêm PowerShell). */
const SHELL_TOOLS = 'Bash|PowerShell';

/**
 * Chuẩn bị cho một lượt Claude Code:
 * - kết nối dịch vụ: tệp --mcp-config (đã giải bí mật, xoá sau lượt chạy), --allowedTools / --disallowedTools theo chính sách;
 * - hook PreToolUse gọi về ứng dụng để áp ĐÚNG quy tắc quyền của Văn Phòng AI (permissions.ts) – như agent API:
 *   · chỉ đọc: chỉ chạy lệnh xem/tìm kiếm; · ghi: lệnh shell tạo thẻ phê duyệt; · ghi/tự động: ghi tệp ngoài dự án tạo thẻ phê duyệt;
 *   · thao tác MCP "Hỏi trước" tạo thẻ phê duyệt, "Tắt" bị chặn.
 * Không cần hook (toàn quyền, không có kết nối dịch vụ) → null.
 */
export async function prepareClaudeHooks(
  run: Omit<HookRun, 'connections'> & { departmentId: string; permission: PermissionLevel; approvalTimeoutMinutes: number },
): Promise<ClaudeHookRun | null> {
  const conns = await connectionsFor(run.departmentId);
  const matchers: string[] = [];
  if (conns.length) matchers.push('mcp__.*');
  if (run.permission === 'read' || run.permission === 'write') matchers.push(SHELL_TOOLS);
  if (run.permission === 'write' || run.permission === 'auto') matchers.push(FILE_TOOLS);
  if (!matchers.length) return null;

  const servers: Record<string, unknown> = {};
  const secretValues: string[] = [];
  const allowed: string[] = [];
  const disallowed: string[] = [];
  for (const conn of conns) {
    const r = await resolveConnection(conn, { taskId: run.taskId, label: `Kết nối ${conn.name}` });
    secretValues.push(...r.secretValues);
    servers[conn.key] =
      conn.transport === 'http'
        ? { type: 'http', url: r.url, headers: r.headers }
        : { type: 'stdio', command: conn.command, args: r.args, env: { ...r.env } };
    for (const t of conn.tools) {
      // Chỉ đọc: thao tác có thể thay đổi dữ liệu bị tắt hẳn
      if (t.policy === 'off' || (run.permission === 'read' && !t.readOnly)) disallowed.push(mcpToolName(conn.key, t.name));
      else if (t.policy === 'allow') allowed.push(mcpToolName(conn.key, t.name));
    }
  }
  const token = crypto.randomBytes(24).toString('hex');
  const dir = path.join(appDataDir(), 'mcp', 'runs');
  await fs.mkdir(dir, { recursive: true });
  const configFile = conns.length ? path.join(dir, `${run.taskId}-${token.slice(0, 8)}.json`) : null;
  const settingsFile = path.join(dir, `${run.taskId}-${token.slice(0, 8)}.settings.json`);
  const hook = (await hookScriptPath()).replace(/\\/g, '/');
  const node = process.execPath.replace(/\\/g, '/');
  if (configFile) await fs.writeFile(configFile, JSON.stringify({ mcpServers: servers }, null, 2), { encoding: 'utf8', mode: 0o600 });
  // Chờ bạn duyệt tối đa bằng thời hạn phê duyệt trong Cài đặt (hook mặc định của Claude Code chỉ chờ 60 giây)
  const timeout = Math.max(120, run.approvalTimeoutMinutes * 60 + 30);
  await fs.writeFile(
    settingsFile,
    JSON.stringify({ hooks: { PreToolUse: [{ matcher: matchers.join('|'), hooks: [{ type: 'command', command: `"${node}" "${hook}"`, timeout }] }] } }),
    'utf8',
  );
  hookRuns.set(token, { ...run, connections: conns, companyId: await currentCompanyId() });
  return {
    args: [
      ...(configFile ? ['--mcp-config', configFile] : []),
      '--settings',
      settingsFile,
      ...(allowed.length ? ['--allowedTools', ...allowed] : []),
      ...(disallowed.length ? ['--disallowedTools', ...disallowed] : []),
    ],
    env: { VP_HOOK_URL: `${localOrigin()}/api/mcp/hook`, VP_HOOK_TOKEN: token },
    secretValues,
    cleanup: async () => {
      hookRuns.delete(token);
      await Promise.all([configFile ? fs.rm(configFile, { force: true }) : null, fs.rm(settingsFile, { force: true })]);
    },
  };
}

/** Quyết định cho hook PreToolUse (gọi từ /api/mcp/hook). */
export async function decideHook(token: string, toolName: string, toolInput: unknown): Promise<HookVerdict> {
  const run = hookRuns.get(token);
  if (!run) return { decision: 'deny', reason: 'Lượt chạy không còn hiệu lực.' };
  return runWithCompany(run.companyId ?? 'main', () => decideFor(run, toolName, toolInput));
}

/** allow / deny = Văn Phòng AI quyết; defer = để Claude Code tự quyết theo quyền của nó. */
export type HookVerdict = { decision: 'allow' | 'deny' | 'defer'; reason: string };

const verdict = (denied: string | null, okReason = ''): HookVerdict => (denied ? { decision: 'deny', reason: denied } : { decision: 'allow', reason: okReason });

async function decideFor(run: HookRun, toolName: string, toolInput: unknown): Promise<HookVerdict> {
  const input = (toolInput && typeof toolInput === 'object' ? toolInput : {}) as Record<string, unknown>;
  // Lệnh shell: áp quy tắc chung (chỉ đọc → chỉ lệnh xem; ghi → thẻ phê duyệt; tự động/toàn quyền → chạy)
  if (/^(Bash|PowerShell)$/.test(toolName)) {
    const command = String(input.command ?? '').trim();
    const denied = await run.request({
      type: 'shell',
      title: `Chạy lệnh: ${command.slice(0, 120)}`,
      detail: `${input.description ? `${String(input.description)}\n\n` : ''}${command}`,
      payload: { command, tool: toolName },
      inside: true,
      readOnly: isReadOnlyCommand(command),
    });
    if (denied) await run.log(`⛔ Không chạy lệnh \`${command.slice(0, 160)}\`: ${denied}`);
    return verdict(denied);
  }
  // Ghi tệp: trong dự án (hoặc thư mục thêm) → theo quyền; ngoài dự án → thẻ phê duyệt (trừ toàn quyền)
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(toolName)) {
    const file = String(input.file_path ?? input.notebook_path ?? '');
    const abs = file ? path.resolve(run.roots[0] ?? '.', file) : '';
    const denied = await run.request({
      type: 'write',
      title: `Ghi tệp ngoài dự án: ${abs}`,
      detail: abs,
      payload: { path: abs, tool: toolName },
      inside: Boolean(abs) && run.roots.some((r) => isInside(r, abs)),
    });
    return verdict(denied);
  }
  const m = /^mcp__(.+?)__(.+)$/.exec(toolName);
  const conn = m ? run.connections.find((x) => x.key === m[1]) : undefined;
  // Máy chủ MCP không do Văn Phòng AI cấu hình (vd cấu hình riêng của Claude Code) → để Claude Code tự quyết theo quyền
  // của nó (không "allow" thay, vì allow của hook vượt qua kiểm tra quyền của Claude Code)
  if (!m || !conn) return { decision: 'defer', reason: '' };
  const policy = policyFor(conn, m[2]);
  const tool = conn.tools.find((t) => t.name === m[2]);
  if (run.permission === 'read' && !tool?.readOnly) {
    return { decision: 'deny', reason: `Nhiệm vụ chỉ có quyền CHỈ ĐỌC – không dùng được thao tác "${m[2]}" (có thể thay đổi dữ liệu) của ${conn.name}.` };
  }
  if (policy === 'allow') return { decision: 'allow', reason: '' };
  if (policy === 'off') {
    await run.log(`⛔ Chặn thao tác ${conn.name} → ${m[2]} (đang tắt)`);
    return { decision: 'deny', reason: `Thao tác "${m[2]}" của ${conn.name} đang bị TẮT trong Văn Phòng AI. Hãy làm cách khác.` };
  }
  const denied = await run.request({
    type: 'mcp',
    title: `${conn.name}: ${m[2]}`,
    detail: `${conn.name} → ${m[2]}\n\n${JSON.stringify(toolInput ?? {}, null, 2).slice(0, 3000)}`,
    payload: { connectionId: conn._id, tool: m[2], input: toolInput ?? {} },
    inside: false,
  });
  return verdict(denied, 'Chủ công ty đã cho phép.');
}

// ---------------- Kết nối API: thao tác MCP thành công cụ của agent ----------------

export interface ApiMcpRun {
  tools: { name: string; description: string; parameters: { type: 'object'; properties: Record<string, unknown>; required: string[] } }[];
  call: (name: string, input: Record<string, unknown>) => Promise<{ text: string; isError: boolean } | null>;
  policy: (name: string) => { conn: McpConnection; tool: string; policy: McpPolicy } | null;
  secretValues: string[];
  close: () => void;
}

/** Tên công cụ hợp lệ cho API (tối đa 64 ký tự, chữ/số/_/-). */
function apiToolName(key: string, tool: string): string {
  return mcpToolName(key, tool).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
}

export async function prepareApiMcp(departmentId: string, taskId: string, secretSink: string[] = [], permission: PermissionLevel = 'write'): Promise<ApiMcpRun | null> {
  const conns = (await connectionsFor(departmentId)).filter((c) => c.tools.length);
  if (!conns.length) return null;
  const map = new Map<string, { conn: McpConnection; tool: McpTool }>();
  const tools: ApiMcpRun['tools'] = [];
  for (const conn of conns) {
    for (const t of conn.tools) {
      if (t.policy === 'off' || (permission === 'read' && !t.readOnly)) continue;
      const name = apiToolName(conn.key, t.name);
      map.set(name, { conn, tool: t });
      const schema = (t.inputSchema ?? {}) as { properties?: Record<string, unknown>; required?: string[] };
      tools.push({
        name,
        description: `[${conn.name}] ${t.description || t.name}${t.policy === 'ask' ? ' (cần chủ công ty cho phép)' : ''}`.slice(0, 1000),
        parameters: { type: 'object', properties: schema.properties ?? {}, required: Array.isArray(schema.required) ? schema.required : [] },
      });
    }
  }
  const clients = new Map<string, McpClient>();
  const secretValues = secretSink;
  return {
    tools: tools.slice(0, 120),
    secretValues,
    policy: (name) => {
      const hit = map.get(name);
      return hit ? { conn: hit.conn, tool: hit.tool.name, policy: hit.tool.policy } : null;
    },
    call: async (name, input) => {
      const hit = map.get(name);
      if (!hit) return null;
      let client = clients.get(hit.conn._id);
      if (!client) {
        const r = await resolveConnection(hit.conn, { taskId, label: `Kết nối ${hit.conn.name}` });
        secretValues.push(...r.secretValues);
        client = new McpClient(r);
        await client.connect();
        clients.set(hit.conn._id, client);
      }
      return client.callTool(hit.tool.name, input);
    },
    close: () => {
      for (const cl of clients.values()) cl.close();
      clients.clear();
    },
  };
}

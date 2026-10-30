// Thêm kết nối dịch vụ từ danh bạ dựng sẵn (lib/connector-directory.ts): dựng cấu hình, cất ô bí mật vào kho bí mật,
// tải danh sách thao tác (riêng OAuth thì chờ bạn đăng nhập).
import type { McpConnection } from '../types';
import { getDirectoryConnector } from '../connector-directory';
import { getCollections, now } from './db';
import { emit } from './bus';
import { refreshTools, saveConnection } from './connections';
import { upsertSecretValue } from './secrets';
import { LocalizedError } from './http';
import { m } from '../i18n';

export async function installDirectoryConnector(
  id: string,
  values: Record<string, string>,
  opts: { departments?: string[]; pluginId?: string | null } = {},
): Promise<{ connection: McpConnection; needsOAuth: boolean; error?: string }> {
  const dc = getDirectoryConnector(id);
  if (!dc) throw new LocalizedError(m('Không có kết nối này trong danh bạ.'), undefined, 404);
  const c = await getCollections();
  // Mã máy chủ không trùng (cài cùng dịch vụ hai lần → github-2)
  let key = dc.key;
  for (let i = 2; await c.mcpConnections.findOne({ key }); i++) key = `${dc.key}-${i}`.slice(0, 31);
  const env: Record<string, string> = {};
  const headers: Record<string, string> = {};
  const args = [...(dc.args ?? [])];
  let url = dc.url ?? '';
  for (const f of dc.fields ?? []) {
    const raw = (values[f.key] ?? '').trim();
    if (!raw) {
      if (f.optional) continue;
      throw new LocalizedError(m('Nhập "{field}".'), { field: f.label });
    }
    if (f.target.url && !/^https?:\/\//.test(raw)) throw new LocalizedError(m('Địa chỉ máy chủ phải bắt đầu bằng http(s)://'));
    let value = raw;
    if (f.secret) {
      const secretKey = `MCP_${key.replace(/-/g, '_').toUpperCase()}_${f.key.toUpperCase()}`;
      await upsertSecretValue(secretKey, raw, `${dc.name} – ${f.label}`);
      value = `secret:${secretKey}`;
    }
    if (f.target.env) env[f.target.env] = value;
    if (f.target.header) headers[f.target.header] = `${f.target.prefix ?? ''}${value}`;
    if (f.target.arg) args.push(value);
    if (f.target.url) url = value;
  }
  const saved = await saveConnection(null, {
    name: dc.name,
    key,
    kind: 'custom',
    transport: dc.transport,
    command: dc.command,
    args,
    env,
    url,
    headers,
    defaultPolicy: dc.defaultPolicy ?? 'ask',
    departments: opts.departments ?? [],
  });
  await c.mcpConnections.updateOne({ _id: saved._id }, { $set: { directoryId: dc.id, pluginId: opts.pluginId ?? null, updatedAt: now() } });
  await emit('connection.updated', null, { id: saved._id });
  if (dc.auth === 'oauth') {
    await c.mcpConnections.updateOne({ _id: saved._id }, { $set: { status: { ok: false, message: 'Chưa đăng nhập – bấm "Đăng nhập" để kết nối tài khoản.', checkedAt: now() } } });
    return { connection: (await c.mcpConnections.findOne({ _id: saved._id }))!, needsOAuth: true };
  }
  try {
    return { connection: await refreshTools(saved._id), needsOAuth: false };
  } catch (err) {
    return { connection: (await c.mcpConnections.findOne({ _id: saved._id }))!, needsOAuth: false, error: err instanceof Error ? err.message : String(err) };
  }
}

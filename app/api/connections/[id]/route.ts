import type { McpPolicy } from '@/lib/types';
import { deleteConnection, getConnection, refreshTools, saveConnection, setToolPolicies, type ConnectionInput } from '@/lib/server/connections';
import { type Ctx, fail, failFrom, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';
import { startOAuth } from '@/lib/server/mcp-oauth';

export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const conn = await getConnection(id);
  return conn ? ok(conn) : fail(m('Không tìm thấy kết nối'), 404);
});

/** Sửa cấu hình; action "policies" đổi quyền từng thao tác; action "refresh" kết nối thử + tải danh sách thao tác. */
export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson<ConnectionInput & { action?: string; policies?: Record<string, McpPolicy> }>(req);
  try {
    if (body.action === 'refresh') return ok(await refreshTools(id));
    // Đăng nhập OAuth: trả về địa chỉ mở trong trình duyệt; nhà cung cấp chuyển về /api/connections/oauth/callback
    // trên ĐÚNG địa chỉ bạn đang mở (Host do proxy đã kiểm tra) – để cookie phiên đăng nhập / công ty đi kèm.
    if (body.action === 'oauth-start') {
      const u = new URL(req.url);
      const proto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim() || u.protocol.replace(':', '');
      const host = req.headers.get('host') || u.host;
      return ok(await startOAuth(id, `${proto}://${host}/api/connections/oauth/callback`));
    }
    if (body.action === 'policies') {
      const conn = await setToolPolicies(id, body.policies ?? {}, body.defaultPolicy);
      return conn ? ok(conn) : fail(m('Không tìm thấy kết nối'), 404);
    }
    return ok(await saveConnection(id, body));
  } catch (err) {
    return failFrom(err);
  }
});

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  await deleteConnection(id);
  return ok({ ok: true });
});

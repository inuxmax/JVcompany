import { listConnections, saveConnection, type ConnectionInput } from '@/lib/server/connections';
import { installDirectoryConnector } from '@/lib/server/connectors-install';
import { failFrom, ok, readJson, route } from '@/lib/server/http';

/** Kết nối dịch vụ (MCP) của công ty. */
export const GET = route(async () => ok(await listConnections()));

/** Thêm kết nối: từ danh bạ dựng sẵn ({ directoryId, values }) hoặc tự cấu hình (MCP tuỳ chỉnh). */
export const POST = route(async (req: Request) => {
  const body = await readJson<ConnectionInput & { directoryId?: string; values?: Record<string, string> }>(req);
  try {
    if (body.directoryId) return ok(await installDirectoryConnector(body.directoryId, body.values ?? {}, { departments: body.departments }), 201);
    return ok(await saveConnection(null, body), 201);
  } catch (err) {
    return failFrom(err);
  }
});

import { decideHook } from '@/lib/server/connections';
import { ok, readJson, route } from '@/lib/server/http';

/**
 * Hook PreToolUse của Claude Code gọi về (chỉ khi agent dùng thao tác MCP): trả "allow" / "deny".
 * Xác thực bằng mã riêng của từng lượt chạy (x-vp-hook-token); "Hỏi trước" chờ bạn duyệt trong Hộp thư / Phê duyệt.
 */
export const POST = route(async (req: Request) => {
  const token = req.headers.get('x-vp-hook-token') ?? '';
  const body = await readJson<{ tool_name?: string; tool_input?: unknown }>(req);
  if (!token || !body.tool_name) return ok({ decision: 'deny', reason: 'Thiếu mã lượt chạy hoặc tên thao tác.' });
  return ok(await decideHook(token, body.tool_name, body.tool_input));
});

import { deliverCallback, type CallbackPayload } from '@/lib/server/agent/callbacks';
import { type Ctx, fail, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

/**
 * Agent bên ngoài (kết nối HTTP webhook) gửi kết quả về đây.
 * Mã xác thực: header "Authorization: Bearer <callbackToken>" hoặc "X-Callback-Token", hoặc trường callbackToken trong body.
 * Body: { status?: "done" | "failed" | "progress", result | text | summary, error?, usage? }
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id: runId } = await params;
  const body = await readJson<CallbackPayload & { callbackToken?: string }>(req);
  const auth = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const token = auth || req.headers.get('x-callback-token') || body.callbackToken || '';
  const r = deliverCallback(runId, token, body);
  if (r === 'not_found') return fail(m('Không có lượt chạy nào đang chờ mã này (đã xong, hết giờ hoặc máy chủ khởi động lại).'), 404);
  if (r === 'forbidden') return fail(m('Sai mã xác thực.'), 403);
  return ok({ ok: true });
});

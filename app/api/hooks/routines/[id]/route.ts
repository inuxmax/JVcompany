import { companyCollections, runWithCompany } from '@/lib/server/db';
import { activeCompanyIds } from '@/lib/server/company';
import { fireRoutine, verifyWebhook } from '@/lib/server/routines';
import { type Ctx, fail, ok, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

/**
 * Webhook kích hoạt lịch định kỳ: POST /api/hooks/routines/<publicId>
 * Xác thực: "Authorization: Bearer <mã bí mật>" hoặc "X-Signature: sha256=<HMAC hex của body>". Hỗ trợ Idempotency-Key.
 * Bên gọi không có cookie → tìm lịch theo mã công khai trong mọi công ty.
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id: publicId } = await params;
  for (const companyId of await activeCompanyIds()) {
    const c = await companyCollections(companyId);
    const routine = await c.routines.findOne({ 'triggers.publicId': publicId });
    if (!routine) continue;
    const trigger = routine.triggers.find((t) => t.publicId === publicId);
    if (!trigger || !trigger.enabled || routine.status !== 'active') return fail(m('Webhook không tồn tại hoặc đang tắt'), 404);
    const raw = await req.text();
    if (!verifyWebhook(routine, trigger, req.headers, raw)) return fail(m('Sai chữ ký / mã bí mật'), 401);
    let payload: Record<string, unknown> = {};
    try {
      payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      payload = { body: raw.slice(0, 10_000) };
    }
    return runWithCompany(companyId, async () => {
      const run = await fireRoutine(routine, 'webhook', payload, req.headers.get('idempotency-key') ?? undefined);
      await c.routines.updateOne({ _id: routine._id, 'triggers.id': trigger.id }, { $set: { 'triggers.$.lastFiredAt': run.createdAt } });
      return ok({ runId: run._id, status: run.status, taskId: run.taskId }, 202);
    });
  }
  return fail(m('Webhook không tồn tại hoặc đang tắt'), 404);
});

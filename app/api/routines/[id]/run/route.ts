import { fireRoutine, getRoutine } from '@/lib/server/routines';
import { type Ctx, fail, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

/** Chạy ngay (nút "Chạy ngay" hoặc gọi API): { variables?: {...} }. Hỗ trợ header Idempotency-Key. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const r = await getRoutine(id);
  if (!r || r.status === 'archived') return fail(m('Không tìm thấy lịch định kỳ'), 404);
  const body = await readJson<{ variables?: Record<string, unknown>; source?: 'manual' | 'api' }>(req).catch(() => ({}) as { variables?: Record<string, unknown>; source?: 'manual' | 'api' });
  const run = await fireRoutine(r, body.source === 'api' ? 'api' : 'manual', { variables: body.variables ?? {} }, req.headers.get('idempotency-key') ?? undefined);
  return ok(run, 201);
});

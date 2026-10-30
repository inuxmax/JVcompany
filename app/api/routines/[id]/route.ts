import { archiveRoutine, getRoutine, listRoutineRuns, rotateWebhookSecret, saveRoutine } from '@/lib/server/routines';
import { type Ctx, fail, failFrom, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';
import type { Routine } from '@/lib/types';

/** Chi tiết + lịch sử lượt chạy. `?secret=1` kèm mã bí mật webhook (app chạy trên máy bạn). */
export const GET = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const showSecret = new URL(req.url).searchParams.get('secret') === '1';
  const r = await getRoutine(id, showSecret);
  if (!r) return fail(m('Không tìm thấy lịch định kỳ'), 404);
  return ok({ routine: r, runs: await listRoutineRuns(id) });
});

export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson<Partial<Routine> & { rotateSecret?: boolean }>(req);
  const prev = await getRoutine(id);
  if (!prev) return fail(m('Không tìm thấy lịch định kỳ'), 404);
  if (body.rotateSecret) return ok({ secret: await rotateWebhookSecret(id) });
  try {
    return ok(await saveRoutine({ ...prev, ...body, _id: id, title: body.title ?? prev.title, departmentId: body.departmentId ?? prev.departmentId }));
  } catch (err) {
    return failFrom(err);
  }
});

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  await archiveRoutine(id);
  return ok({ ok: true });
});

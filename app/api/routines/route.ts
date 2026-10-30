import { listRoutines, saveRoutine } from '@/lib/server/routines';
import { fail, failFrom, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';
import type { Routine } from '@/lib/types';

export const GET = route(async () => ok(await listRoutines()));

export const POST = route(async (req: Request) => {
  const body = await readJson<Partial<Routine>>(req);
  if (!body.title?.trim()) return fail(m('Nhập tên lịch định kỳ'));
  if (!body.departmentId) return fail(m('Chọn phòng ban thực hiện'));
  try {
    return ok(await saveRoutine({ ...body, title: body.title, departmentId: body.departmentId }), 201);
  } catch (err) {
    return failFrom(err);
  }
});

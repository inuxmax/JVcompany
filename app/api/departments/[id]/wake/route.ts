import { wakeDepartment } from '@/lib/server/heartbeat';
import { type Ctx, fail, ok, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

/** Đánh thức phòng ban ngay (một lượt heartbeat rà soát việc). */
export const POST = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return (await wakeDepartment(id)) ? ok({ ok: true }) : fail(m('Không tìm thấy phòng ban'), 404);
});

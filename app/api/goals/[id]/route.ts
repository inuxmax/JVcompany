import { deleteGoal, getGoal, updateGoal } from '@/lib/server/company';
import { logActivity } from '@/lib/server/activity';
import { type Ctx, fail, failFrom, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';
import type { Goal } from '@/lib/types';

export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson<Partial<Goal>>(req);
  const allowed: (keyof Goal)[] = ['title', 'description', 'level', 'status', 'parentId', 'ownerDepartmentId'];
  const patch = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k as keyof Goal))) as Partial<Goal>;
  try {
    const g = await updateGoal(id, patch);
    if (!g) return fail(m('Không tìm thấy mục tiêu'), 404);
    await logActivity({ action: 'goal.updated', entityType: 'goal', entityId: id, summary: `Sửa mục tiêu "${g.title}"` });
    return ok(g);
  } catch (err) {
    return failFrom(err);
  }
});

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const g = await getGoal(id);
  await deleteGoal(id);
  if (g) await logActivity({ action: 'goal.deleted', entityType: 'goal', entityId: id, summary: `Xoá mục tiêu "${g.title}"` });
  return ok({ ok: true });
});

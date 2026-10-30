import { deleteDepartment, departmentDeleteBlocker, getDepartment, resetDepartment, updateDepartment } from '@/lib/server/repo';
import { type Ctx, fail, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';
import type { Department } from '@/lib/types';
import { upsertPolicy } from '@/lib/server/budgets';
import { logActivity } from '@/lib/server/activity';

const EDITABLE: (keyof Department)[] = [
  'name',
  'title',
  'description',
  'icon',
  'color',
  'responsibilities',
  'capabilities',
  'systemPrompt',
  'canDelegateTo',
  'canApprove',
  'providerId',
  'preferredProviderTypes',
  'tier',
  'model',
  'fallbackProviderIds',
  'effort',
  'maxPermission',
  'maxTurns',
  'enabled',
  'order',
  'position',
  'reportsTo',
  'status',
  'heartbeat',
  'budgetMonthlyUsd',
  'skills',
  'env',
  'permissions',
];

/** Cấp trên không được tạo vòng lặp (A báo cáo B, B báo cáo A). */
async function cyclic(id: string, reportsTo: string | null | undefined): Promise<boolean> {
  for (let cur = reportsTo ?? null, i = 0; cur && i < 50; i++) {
    if (cur === id) return true;
    cur = (await getDepartment(cur))?.reportsTo ?? null;
  }
  return false;
}

export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const d = await getDepartment(id);
  return d ? ok(d) : fail(m('Không tìm thấy phòng ban'), 404);
});

export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson<Partial<Department> & { reset?: boolean }>(req);
  if (body.reset) return ok(await resetDepartment(id));
  const patch = Object.fromEntries(Object.entries(body).filter(([k]) => EDITABLE.includes(k as keyof Department))) as Partial<Department>;
  if ('reportsTo' in patch && (await cyclic(id, patch.reportsTo))) return fail(m('Cấp trên tạo thành vòng lặp trong sơ đồ tổ chức.'));
  const before = await getDepartment(id);
  const d = await updateDepartment(id, patch);
  if (!d) return fail(m('Không tìm thấy phòng ban'), 404);
  // Ngân sách tháng của phòng = chính sách ngân sách theo tháng
  if (patch.budgetMonthlyUsd !== undefined && patch.budgetMonthlyUsd !== before?.budgetMonthlyUsd) {
    await upsertPolicy({ scopeType: 'department', scopeId: id, windowKind: 'month', amountUsd: Number(patch.budgetMonthlyUsd) || 0, active: Number(patch.budgetMonthlyUsd) > 0 });
  }
  const keys = Object.keys(patch).filter((k) => !['order', 'position'].includes(k));
  if (keys.length) await logActivity({ action: 'department.updated', entityType: 'department', entityId: id, summary: `Sửa ${d.name}: ${keys.join(', ')}` });
  return ok(d);
});

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const blocker = await departmentDeleteBlocker(id);
  if (blocker) return fail(blocker.key, 409, blocker.vars ?? {});
  const d = await getDepartment(id);
  await deleteDepartment(id);
  await logActivity({ action: 'department.deleted', entityType: 'department', entityId: id, summary: `Xoá ${d?.name ?? id}` });
  return ok({ ok: true });
});

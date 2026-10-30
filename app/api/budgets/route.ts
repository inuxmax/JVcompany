import { deletePolicy, upsertPolicy } from '@/lib/server/budgets';
import { logActivity } from '@/lib/server/activity';
import { fail, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';
import type { BudgetPolicy } from '@/lib/types';

export const POST = route(async (req: Request) => {
  const body = await readJson<Partial<BudgetPolicy>>(req);
  if (!body.scopeType || !body.scopeId) return fail(m('Chọn phạm vi ngân sách'));
  const p = await upsertPolicy({ ...body, scopeType: body.scopeType, scopeId: body.scopeId });
  await logActivity({ action: 'budget.policy_saved', entityType: 'budget', entityId: p._id, summary: `Ngân sách ${p.scopeType}:${p.scopeId} = $${p.amountUsd} / ${p.windowKind === 'month' ? 'tháng' : 'trọn đời'}` });
  return ok(p);
});

export const DELETE = route(async (req: Request) => {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return fail(m('Thiếu id'));
  await deletePolicy(id);
  await logActivity({ action: 'budget.policy_deleted', entityType: 'budget', entityId: id, summary: 'Xoá chính sách ngân sách' });
  return ok({ ok: true });
});

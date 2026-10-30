import { ensureCompany, updateCompany } from '@/lib/server/company';
import { upsertPolicy, resumeScope } from '@/lib/server/budgets';
import { logActivity } from '@/lib/server/activity';
import { fail, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';
import type { Company } from '@/lib/types';

export const GET = route(async () => ok(await ensureCompany()));

/** Sửa thông tin công ty: tên, sứ mệnh, tiền tố mã nhiệm vụ, ngân sách tháng, bắt buộc duyệt khi tuyển, tiếp tục hoạt động. */
export const PATCH = route(async (req: Request) => {
  const body = await readJson<Partial<Company> & { resume?: boolean }>(req);
  const before = await ensureCompany();
  const patch: Partial<Company> = {};
  if (body.name !== undefined) {
    if (!body.name.trim()) return fail(m('Tên công ty không được trống'));
    patch.name = body.name.trim();
  }
  if (body.mission !== undefined) patch.mission = body.mission.trim();
  if (body.issuePrefix !== undefined) {
    const p = body.issuePrefix.trim().toUpperCase();
    if (!/^[A-Z]{1,6}$/.test(p)) return fail(m('Tiền tố mã nhiệm vụ: 1–6 chữ cái IN HOA'));
    patch.issuePrefix = p;
  }
  if (body.requireApprovalForNewAgents !== undefined) patch.requireApprovalForNewAgents = Boolean(body.requireApprovalForNewAgents);
  if (body.budgetMonthlyUsd !== undefined) {
    patch.budgetMonthlyUsd = Math.max(0, Number(body.budgetMonthlyUsd) || 0);
    await upsertPolicy({ scopeType: 'company', scopeId: 'main', windowKind: 'month', amountUsd: patch.budgetMonthlyUsd, active: patch.budgetMonthlyUsd > 0 });
  }
  const company = await updateCompany(patch);
  if (body.resume && before.status === 'paused') await resumeScope('company', 'main');
  await logActivity({ action: 'company.updated', entityType: 'company', entityId: 'main', summary: `Sửa thông tin công ty: ${Object.keys(patch).join(', ') || (body.resume ? 'tiếp tục hoạt động' : '—')}` });
  return ok(company);
});

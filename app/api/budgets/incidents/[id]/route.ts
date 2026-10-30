import { resolveIncident } from '@/lib/server/budgets';
import { getCollections } from '@/lib/server/db';
import { resolveApproval } from '@/lib/server/repo';
import { type Ctx, fail, failFrom, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

/** Xử lý sự cố ngân sách: raise_and_resume (kèm amountUsd) / keep_paused / dismiss. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { action, amountUsd } = await readJson<{ action?: 'raise_and_resume' | 'keep_paused' | 'dismiss'; amountUsd?: number }>(req);
  if (!action) return fail(m('Thiếu hành động'));
  try {
    const inc = await resolveIncident(id, action, amountUsd);
    // Đóng luôn thẻ phê duyệt "vượt ngân sách" tương ứng
    if (inc?.approvalId) {
      const c = await getCollections();
      const a = await c.approvals.findOne({ _id: inc.approvalId });
      if (a?.status === 'pending') await resolveApproval(a._id, action === 'raise_and_resume' ? 'approved' : 'denied', { note: action });
    }
    return ok(inc);
  } catch (err) {
    return failFrom(err);
  }
});

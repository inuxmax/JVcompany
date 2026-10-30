import { getApproval, postMessage, resolveApproval } from '@/lib/server/repo';
import { onGovernanceResolved } from '@/lib/server/governance';
import { logActivity } from '@/lib/server/activity';
import { actorName } from '@/lib/server/auth';
import { type Ctx, fail, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';
import { noteContent, sysMsg } from '@/lib/i18n/format';

const GOVERNANCE = new Set(['hire_agent', 'budget_override', 'board_request']);

export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { decision, scope, note, amountUsd } = await readJson<{ decision?: 'approve' | 'deny'; scope?: 'once' | 'task'; note?: string; amountUsd?: number }>(req);
  if (decision !== 'approve' && decision !== 'deny') return fail(m('Quyết định không hợp lệ'));
  const pending = await getApproval(id);
  // Vượt ngân sách: kiểm tra hạn mức mới trước khi đóng phê duyệt
  if (pending?.type === 'budget_override' && decision === 'approve') {
    const observed = Number((pending.payload as Record<string, unknown>).observed ?? 0);
    if (amountUsd !== undefined && !(Number(amountUsd) > observed)) return fail(m('Hạn mức mới phải lớn hơn số đã chi (${amount}).'), 400, { amount: observed.toFixed(2) });
  }
  const a = await resolveApproval(id, decision === 'approve' ? 'approved' : 'denied', { scope: scope ?? 'once', note });
  if (!a) return fail(m('Yêu cầu đã được xử lý hoặc không tồn tại'), 409);
  if (GOVERNANCE.has(a.type)) {
    await onGovernanceResolved(a, decision, note ?? '', { amountUsd });
  } else {
    await logActivity({ action: decision === 'approve' ? 'approval.approved' : 'approval.denied', entityType: 'approval', entityId: a._id, projectId: a.projectId || null, summary: `${decision === 'approve' ? 'Cho phép' : 'Từ chối'}: ${a.title}` });
  }
  if (a.projectId) {
    await postMessage({
      projectId: a.projectId,
      taskId: a.taskId || null,
      author: { type: 'user', name: await actorName() },
      kind: 'approval',
      ...noteContent(
        sysMsg(
          decision !== 'approve' ? '⛔ Đã từ chối: {title}{note}' : scope === 'task' ? '✅ Đã cho phép: {title} (và mọi thao tác còn lại của nhiệm vụ){note}' : '✅ Đã cho phép: {title}{note}',
          { title: a.title, note: note ? ` – ${note}` : '' },
        ),
      ),
      meta: { approvalId: a._id, resolved: true },
    });
  }
  return ok(a);
});

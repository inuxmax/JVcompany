import { costSummary, listIncidents, listPolicies, spentFor } from '@/lib/server/budgets';
import { runActivity } from '@/lib/server/runs';
import { ok, route } from '@/lib/server/http';

/** Chi phí & ngân sách: tổng tháng, theo phòng / dự án / kết nối / model, 14 ngày, chính sách + đã chi, sự cố. */
export const GET = route(async () => {
  const [summary, policies, incidents, runs] = await Promise.all([costSummary(), listPolicies(), listIncidents(), runActivity(14)]);
  const withSpent = await Promise.all(policies.map(async (p) => ({ ...p, spentUsd: await spentFor(p) })));
  return ok({ ...summary, policies: withSpent, incidents, runs });
});

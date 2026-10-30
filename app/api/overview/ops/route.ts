import { getCollections } from '@/lib/server/db';
import { ensureCompany } from '@/lib/server/company';
import { costSummary, listIncidents, listPolicies, spentFor } from '@/lib/server/budgets';
import { runActivity, silence } from '@/lib/server/runs';
import { listActivity } from '@/lib/server/activity';
import { ok, route } from '@/lib/server/http';

/** Số liệu vận hành cho trang Tổng quan (theo dashboard của Paperclip). */
export const GET = route(async () => {
  const c = await getCollections();
  const [company, depts, cost, incidents, runs, activity, running, policies] = await Promise.all([
    ensureCompany(),
    c.departments.find({}, { projection: { status: 1, enabled: 1 } }).toArray(),
    costSummary(),
    listIncidents('open'),
    runActivity(14),
    listActivity({ limit: 8 }),
    c.runs.find({ status: 'running' }).toArray(),
    listPolicies(),
  ]);
  const runningTasks = new Set((await c.tasks.find({ status: 'running' }, { projection: { departmentId: 1 } }).toArray()).map((t) => t.departmentId));
  const companyPolicy = policies.find((p) => p.scopeType === 'company' && p.windowKind === 'month' && p.active);
  const t = Date.now();
  const stuck = running.filter((r) => silence(r, t) !== 'ok');
  const stuckTasks = await c.tasks.find({ _id: { $in: stuck.map((r) => r.taskId) } }, { projection: { identifier: 1, title: 1, departmentId: 1, projectId: 1 } }).toArray();
  return ok({
    company: { name: company.name, mission: company.mission, status: company.status },
    agents: {
      active: depts.filter((d) => d.enabled && (!d.status || d.status === 'active')).length,
      running: runningTasks.size,
      paused: depts.filter((d) => d.status === 'paused').length,
      error: depts.filter((d) => d.status === 'error').length,
    },
    costs: { monthUsd: cost.monthUsd, budgetUsd: companyPolicy?.amountUsd ?? 0, spentVsBudget: companyPolicy ? await spentFor(companyPolicy) : 0 },
    incidents: incidents.length,
    runs,
    stuck: stuck.map((r) => ({ runId: r._id, level: silence(r, t), task: stuckTasks.find((x) => x._id === r.taskId) ?? null })),
    activity,
  });
});

// Ngân sách: chính sách theo công ty / phòng ban / dự án; cảnh báo ở mức %; chạm 100% thì tạm dừng và xin bạn duyệt vượt ngân sách.
import type { BudgetIncident, BudgetPolicy, BudgetScope, CostEvent } from '../types';
import { currentCompanyId, getCollections, newId, now } from './db';
import { emit } from './bus';
import { logActivity } from './activity';
import { createApproval } from './repo';
import { LocalizedError } from './http';
import { m } from '../i18n';

/** Đầu kỳ ngân sách: đầu tháng (UTC) hoặc từ trước tới nay. */
export function windowStart(kind: BudgetPolicy['windowKind'], at = new Date()): string {
  if (kind === 'lifetime') return '1970-01-01T00:00:00.000Z';
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)).toISOString();
}

export async function listPolicies(): Promise<BudgetPolicy[]> {
  const c = await getCollections();
  return c.budgetPolicies.find().sort({ createdAt: 1 }).toArray();
}

export async function upsertPolicy(data: Partial<BudgetPolicy> & { scopeType: BudgetScope; scopeId: string }): Promise<BudgetPolicy> {
  const c = await getCollections();
  const ts = now();
  const existing = data._id
    ? await c.budgetPolicies.findOne({ _id: data._id })
    : await c.budgetPolicies.findOne({ scopeType: data.scopeType, scopeId: data.scopeId, windowKind: data.windowKind ?? 'month' });
  const policy: BudgetPolicy = {
    _id: existing?._id ?? newId(),
    scopeType: data.scopeType,
    scopeId: data.scopeId,
    windowKind: data.windowKind ?? existing?.windowKind ?? 'month',
    amountUsd: Math.max(0, Number(data.amountUsd ?? existing?.amountUsd ?? 0)),
    warnPercent: Math.min(100, Math.max(1, Number(data.warnPercent ?? existing?.warnPercent ?? 80))),
    hardStop: data.hardStop ?? existing?.hardStop ?? true,
    apiOnly: data.apiOnly ?? existing?.apiOnly ?? false,
    active: data.active ?? existing?.active ?? true,
    createdAt: existing?.createdAt ?? ts,
    updatedAt: ts,
  };
  await c.budgetPolicies.replaceOne({ _id: policy._id }, policy, { upsert: true });
  await emit('budget.updated', null, { id: policy._id });
  return policy;
}

export async function deletePolicy(id: string): Promise<void> {
  const c = await getCollections();
  await c.budgetPolicies.deleteOne({ _id: id });
  await emit('budget.updated', null, { id, deleted: true });
}

function scopeFilter(policy: Pick<BudgetPolicy, 'scopeType' | 'scopeId' | 'apiOnly'>): Record<string, unknown> {
  const q: Record<string, unknown> = {};
  if (policy.scopeType === 'department') q.departmentId = policy.scopeId;
  if (policy.scopeType === 'project') q.projectId = policy.scopeId;
  if (policy.apiOnly) q.billingType = 'api';
  return q;
}

/** Đã chi bao nhiêu trong kỳ của chính sách. */
export async function spentFor(policy: Pick<BudgetPolicy, 'scopeType' | 'scopeId' | 'apiOnly' | 'windowKind'>): Promise<number> {
  const c = await getCollections();
  const rows = await c.costEvents
    .aggregate<{ total: number }>([
      { $match: { ...scopeFilter(policy), occurredAt: { $gte: windowStart(policy.windowKind) } } },
      { $group: { _id: null, total: { $sum: '$costUsd' } } },
    ])
    .toArray();
  return rows[0]?.total ?? 0;
}

async function scopeName(scopeType: BudgetScope, scopeId: string): Promise<string> {
  const c = await getCollections();
  if (scopeType === 'company') return 'Công ty';
  if (scopeType === 'department') return (await c.departments.findOne({ _id: scopeId }))?.name ?? scopeId;
  return `Dự án "${(await c.projects.findOne({ _id: scopeId }))?.name ?? scopeId}"`;
}

/** Tạm dừng phạm vi vượt ngân sách: không nhận lượt chạy mới, lượt đang chạy được dừng và xếp lại hàng. */
export async function pauseScope(scopeType: BudgetScope, scopeId: string, reason: string): Promise<void> {
  const c = await getCollections();
  const ts = now();
  if (scopeType === 'company') await c.companies.updateOne({ _id: await currentCompanyId() }, { $set: { status: 'paused', pauseReason: reason, updatedAt: ts } });
  else if (scopeType === 'department') await c.departments.updateOne({ _id: scopeId }, { $set: { status: 'paused', pauseReason: reason, updatedAt: ts } });
  else await c.projects.updateOne({ _id: scopeId }, { $set: { status: 'paused', blockedReason: reason, updatedAt: ts } });
  const { requeueRunning } = await import('./agent/control');
  const running = await c.tasks
    .find({ status: 'running', ...(scopeType === 'department' ? { departmentId: scopeId } : scopeType === 'project' ? { projectId: scopeId } : {}) }, { projection: { _id: 1 } })
    .toArray();
  for (const t of running) requeueRunning(t._id, reason);
  await emit(scopeType === 'department' ? 'department.updated' : scopeType === 'project' ? 'project.updated' : 'company.updated', scopeType === 'project' ? scopeId : null, {});
}

/** Gỡ tạm dừng do ngân sách. */
export async function resumeScope(scopeType: BudgetScope, scopeId: string): Promise<void> {
  const c = await getCollections();
  const ts = now();
  if (scopeType === 'company') await c.companies.updateOne({ _id: await currentCompanyId(), pauseReason: { $regex: '^Ngân sách' } }, { $set: { status: 'active', pauseReason: null, updatedAt: ts } });
  else if (scopeType === 'department') await c.departments.updateOne({ _id: scopeId }, { $set: { status: 'active', pauseReason: null, updatedAt: ts } });
  else {
    const { resumeProject } = await import('./agent/orchestrator');
    await c.projects.updateOne({ _id: scopeId }, { $set: { blockedReason: null } });
    await resumeProject(scopeId);
  }
  await emit('budget.updated', null, {});
}

/** Sau mỗi bản ghi chi phí: kiểm tra mọi chính sách liên quan (công ty, phòng, dự án). */
export async function evaluateBudgets(ev: Pick<CostEvent, 'departmentId' | 'projectId'>): Promise<void> {
  const c = await getCollections();
  const policies = await c.budgetPolicies
    .find({
      active: true,
      amountUsd: { $gt: 0 },
      $or: [
        { scopeType: 'company' },
        ...(ev.departmentId ? [{ scopeType: 'department' as const, scopeId: ev.departmentId }] : []),
        ...(ev.projectId ? [{ scopeType: 'project' as const, scopeId: ev.projectId }] : []),
      ],
    })
    .toArray();
  for (const p of policies) {
    const spent = await spentFor(p);
    const pct = (spent / p.amountUsd) * 100;
    const start = windowStart(p.windowKind);
    if (pct >= p.warnPercent) await openIncident(p, start, 'soft', spent);
    if (p.hardStop && spent >= p.amountUsd) await openIncident(p, start, 'hard', spent);
  }
}

async function openIncident(p: BudgetPolicy, start: string, threshold: 'soft' | 'hard', spent: number): Promise<void> {
  const c = await getCollections();
  const incident: BudgetIncident = {
    _id: newId(),
    policyId: p._id,
    scopeType: p.scopeType,
    scopeId: p.scopeId,
    windowStart: start,
    threshold,
    amountLimit: p.amountUsd,
    amountObserved: spent,
    status: 'open',
    approvalId: null,
    createdAt: now(),
    resolvedAt: null,
  };
  try {
    await c.budgetIncidents.insertOne(incident);
  } catch {
    return; // đã có sự cố cùng ngưỡng trong kỳ này
  }
  const name = await scopeName(p.scopeType, p.scopeId);
  const money = `$${spent.toFixed(2)} / $${p.amountUsd.toFixed(2)}`;
  if (threshold === 'soft') {
    await logActivity({ actorType: 'system', action: 'budget.warning', entityType: 'budget', entityId: p._id, summary: `${name} đã dùng ${Math.round((spent / p.amountUsd) * 100)}% ngân sách (${money}).` });
  } else {
    const reason = `Ngân sách: ${name} đã chạm hạn mức ${money}`;
    await pauseScope(p.scopeType, p.scopeId, reason);
    const approval = await createApproval({
      projectId: p.scopeType === 'project' ? p.scopeId : '',
      taskId: '',
      departmentId: p.scopeType === 'department' ? p.scopeId : 'director',
      type: 'budget_override',
      title: `${name} vượt ngân sách (${money})`,
      titleI18n: { key: '{name} vượt ngân sách ({money})', vars: { name, money } },
      detail: `Đã tự tạm dừng ${name}. Duyệt để nâng hạn mức và chạy tiếp, hoặc từ chối để giữ tạm dừng.`,
      detailI18n: { key: 'Đã tự tạm dừng {name}. Duyệt để nâng hạn mức và chạy tiếp, hoặc từ chối để giữ tạm dừng.', vars: { name } },
      payload: { incidentId: incident._id, policyId: p._id, scopeType: p.scopeType, scopeId: p.scopeId, observed: spent, limit: p.amountUsd, suggestedAmount: Math.ceil(Math.max(spent * 1.5, p.amountUsd * 1.5)) },
    });
    await c.budgetIncidents.updateOne({ _id: incident._id }, { $set: { approvalId: approval._id } });
    await logActivity({ actorType: 'system', action: 'budget.hard_stop', entityType: 'budget', entityId: p._id, projectId: p.scopeType === 'project' ? p.scopeId : null, summary: `${reason} – đã tạm dừng.` });
  }
  await emit('budget.updated', null, { incident: incident._id });
}

/** Xử lý sự cố: nâng hạn mức & chạy tiếp, hoặc giữ tạm dừng. */
export async function resolveIncident(id: string, action: 'raise_and_resume' | 'keep_paused' | 'dismiss', amountUsd?: number): Promise<BudgetIncident | null> {
  const c = await getCollections();
  const inc = await c.budgetIncidents.findOne({ _id: id });
  if (!inc || inc.status !== 'open') return inc;
  if (action === 'raise_and_resume') {
    const spent = await spentFor({ scopeType: inc.scopeType, scopeId: inc.scopeId, apiOnly: (await c.budgetPolicies.findOne({ _id: inc.policyId }))?.apiOnly ?? false, windowKind: 'month' });
    const amount = Number(amountUsd ?? 0);
    if (!(amount > spent)) throw new LocalizedError(m('Hạn mức mới phải lớn hơn số đã chi (${amount}).'), { amount: spent.toFixed(2) });
    await c.budgetPolicies.updateOne({ _id: inc.policyId }, { $set: { amountUsd: amount, updatedAt: now() } });
    await resumeScope(inc.scopeType, inc.scopeId);
  }
  // Đóng mọi sự cố đang mở của chính sách trong kỳ (cảnh báo + chặn)
  await c.budgetIncidents.updateMany({ policyId: inc.policyId, windowStart: inc.windowStart, status: 'open' }, { $set: { status: action === 'dismiss' ? 'dismissed' : 'resolved', resolvedAt: now() } });
  if (action === 'raise_and_resume') await c.budgetIncidents.deleteMany({ policyId: inc.policyId, windowStart: inc.windowStart, status: { $ne: 'open' } });
  await logActivity({
    action: `budget.${action}`,
    entityType: 'budget',
    entityId: inc.policyId,
    summary: action === 'raise_and_resume' ? `Nâng hạn mức lên $${amountUsd} và chạy tiếp.` : action === 'keep_paused' ? 'Giữ tạm dừng do vượt ngân sách.' : 'Bỏ qua cảnh báo ngân sách.',
  });
  await emit('budget.updated', null, { incident: id });
  return c.budgetIncidents.findOne({ _id: id });
}

export async function listIncidents(status?: BudgetIncident['status']): Promise<BudgetIncident[]> {
  const c = await getCollections();
  return c.budgetIncidents
    .find(status ? { status } : {})
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();
}

/** Tổng quan chi phí: tháng này, theo phòng / dự án / kết nối / model, 14 ngày. */
export async function costSummary(): Promise<{
  monthUsd: number;
  monthApiUsd: number;
  monthTokens: { input: number; output: number };
  byDepartment: { id: string; usd: number; tokens: number }[];
  byProject: { id: string; usd: number; tokens: number }[];
  byProvider: { id: string; usd: number; tokens: number }[];
  byModel: { id: string; usd: number; tokens: number }[];
  daily: { date: string; usd: number }[];
}> {
  const c = await getCollections();
  const since = windowStart('month');
  const month = await c.costEvents.find({ occurredAt: { $gte: since } }).toArray();
  const group = (key: (e: CostEvent) => string | null) => {
    const m = new Map<string, { usd: number; tokens: number }>();
    for (const e of month) {
      const k = key(e) ?? '—';
      const v = m.get(k) ?? { usd: 0, tokens: 0 };
      v.usd += e.costUsd;
      v.tokens += e.inputTokens + e.outputTokens;
      m.set(k, v);
    }
    return [...m.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.usd - a.usd || b.tokens - a.tokens);
  };
  const d0 = new Date(Date.now() - 13 * 86400_000);
  d0.setUTCHours(0, 0, 0, 0);
  const recent = await c.costEvents.find({ occurredAt: { $gte: d0.toISOString() } }, { projection: { costUsd: 1, occurredAt: 1 } }).toArray();
  const daily = Array.from({ length: 14 }, (_, i) => ({ date: new Date(d0.getTime() + i * 86400_000).toISOString().slice(0, 10), usd: 0 }));
  for (const e of recent) {
    const d = daily.find((x) => x.date === e.occurredAt.slice(0, 10));
    if (d) d.usd += e.costUsd;
  }
  return {
    monthUsd: month.reduce((s, e) => s + e.costUsd, 0),
    monthApiUsd: month.filter((e) => e.billingType === 'api').reduce((s, e) => s + e.costUsd, 0),
    monthTokens: { input: month.reduce((s, e) => s + e.inputTokens, 0), output: month.reduce((s, e) => s + e.outputTokens, 0) },
    byDepartment: group((e) => e.departmentId),
    byProject: group((e) => e.projectId),
    byProvider: group((e) => e.providerName),
    byModel: group((e) => e.model),
    daily,
  };
}

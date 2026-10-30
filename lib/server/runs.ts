// Lượt chạy của agent (heartbeat run): ghi mỗi lần chạy, token & chi phí, phiên trước/sau; sinh bản ghi chi phí.
import type { CostEvent, Department, Provider, ProviderUsage, Run, RunStatus, Task, UsageBucket } from '../types';
import { estimateCost } from '../pricing';
import { getCollections, newId, now } from './db';
import { emit } from './bus';
import { evaluateBudgets } from './budgets';

type Usage = { inputTokens: number; outputTokens: number; costUsd: number; cachedInputTokens?: number };

export async function startRun(task: Task, dept: Department, provider: Provider | null, model: string, wakeReason: string): Promise<Run> {
  const c = await getCollections();
  const run: Run = {
    _id: newId(),
    taskId: task._id,
    projectId: task.projectId,
    departmentId: dept._id,
    providerId: provider?._id ?? null,
    providerName: provider?.name ?? null,
    providerType: provider?.type ?? null,
    model: model || null,
    attempt: task.attempts,
    wakeReason,
    status: 'running',
    billingType: provider ? (provider.kind === 'api' || provider.authMode === 'api_key' ? 'api' : provider.kind === 'cli' ? 'subscription' : 'unknown') : 'unknown',
    usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: 0 },
    sessionBefore: task.sessionId ?? null,
    sessionAfter: null,
    startedAt: now(),
    finishedAt: null,
    lastOutputAt: now(),
    watchdog: null,
  };
  await c.runs.insertOne(run);
  await emit('run.updated', task.projectId, { id: run._id, taskId: task._id, status: 'running' });
  return run;
}

/** Kết thúc lượt chạy: tính phần token/chi phí của riêng lượt này, ghi chi phí và kiểm tra ngân sách. */
export async function finishRun(
  run: Run,
  result: { status: RunStatus; before: Usage; after: Usage; billingType?: Run['billingType']; sessionAfter?: string | null; error?: string | null; excerpt?: string | null },
): Promise<void> {
  const c = await getCollections();
  const usage = {
    inputTokens: Math.max(0, result.after.inputTokens - result.before.inputTokens),
    outputTokens: Math.max(0, result.after.outputTokens - result.before.outputTokens),
    cachedInputTokens: Math.max(0, (result.after.cachedInputTokens ?? 0) - (result.before.cachedInputTokens ?? 0)),
    costUsd: Math.max(0, result.after.costUsd - result.before.costUsd),
  };
  const billingType = result.billingType ?? run.billingType;
  // API không trả về giá (DeepSeek, OpenAI, Anthropic API) → ước tính theo bảng giá để chi phí / ngân sách không bị $0
  if (!usage.costUsd && billingType === 'api' && (usage.inputTokens || usage.outputTokens)) usage.costUsd = estimateCost(run.model, usage) ?? 0;
  const finishedAt = now();
  await c.runs.updateOne(
    { _id: run._id },
    {
      $set: {
        status: result.status,
        usage,
        billingType,
        sessionAfter: result.sessionAfter ?? null,
        error: result.error ? result.error.slice(0, 2000) : null,
        excerpt: result.excerpt ? result.excerpt.slice(0, 1200) : null,
        finishedAt,
      },
    },
  );
  await emit('run.updated', run.projectId, { id: run._id, taskId: run.taskId, status: result.status });
  if (usage.inputTokens || usage.outputTokens || usage.costUsd) {
    const ev: CostEvent = {
      _id: newId(),
      runId: run._id,
      taskId: run.taskId,
      projectId: run.projectId,
      departmentId: run.departmentId,
      providerType: run.providerType,
      providerName: run.providerName,
      model: run.model,
      billingType,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
      costUsd: usage.costUsd,
      occurredAt: finishedAt,
    };
    await c.costEvents.insertOne(ev);
    await emit('cost.recorded', run.projectId, { id: ev._id, costUsd: ev.costUsd });
    await evaluateBudgets(ev).catch((err) => console.error('[vanphong] Kiểm tra ngân sách lỗi:', err));
  }
}

const lastTouch = new Map<string, number>();

/** Đánh dấu lượt chạy vừa có đầu ra (tối đa 1 lần / 15 giây mỗi nhiệm vụ) – để canh chừng lượt chạy im lặng. */
export function touchRunOutput(taskId: string): void {
  const t = Date.now();
  if ((lastTouch.get(taskId) ?? 0) > t - 15_000) return;
  lastTouch.set(taskId, t);
  void getCollections()
    .then((c) =>
      Promise.all([
        c.runs.updateOne({ taskId, status: 'running' }, { $set: { lastOutputAt: new Date(t).toISOString() } }),
        c.tasks.updateOne({ _id: taskId }, { $set: { lastOutputAt: new Date(t).toISOString() } }),
      ]),
    )
    .catch(() => undefined);
}

export async function listRuns(filter: { taskId?: string; departmentId?: string; projectId?: string; status?: RunStatus; limit?: number } = {}): Promise<Run[]> {
  const c = await getCollections();
  const q: Record<string, unknown> = {};
  if (filter.taskId) q.taskId = filter.taskId;
  if (filter.departmentId) q.departmentId = filter.departmentId;
  if (filter.projectId) q.projectId = filter.projectId;
  if (filter.status) q.status = filter.status;
  return c.runs
    .find(q)
    .sort({ startedAt: -1 })
    .limit(Math.min(500, filter.limit ?? 50))
    .toArray();
}

/** Mức độ im lặng của lượt chạy: 5 phút không ra chữ = nghi ngờ, 15 phút = nghiêm trọng (trừ khi bạn đã bảo tiếp tục / hoãn). */
export function silence(run: Pick<Run, 'status' | 'lastOutputAt' | 'startedAt' | 'watchdog'>, nowMs = Date.now()): 'ok' | 'suspicious' | 'critical' {
  if (run.status !== 'running') return 'ok';
  const w = run.watchdog;
  if (w?.decision === 'dismissed') return 'ok';
  if ((w?.decision === 'snooze' || w?.decision === 'continue') && w.until && new Date(w.until).getTime() > nowMs) return 'ok';
  const last = new Date(run.lastOutputAt ?? run.startedAt).getTime();
  const idle = nowMs - last;
  if (idle > 15 * 60_000) return 'critical';
  if (idle > 5 * 60_000) return 'suspicious';
  return 'ok';
}

/** Số lượt chạy 14 ngày gần nhất theo ngày (thành công / lỗi / khác). */
export async function runActivity(days = 14): Promise<{ date: string; succeeded: number; failed: number; other: number; total: number }[]> {
  const c = await getCollections();
  // Theo ngày UTC (khớp biểu đồ chi phí): từ (hôm nay - days + 1) tới hôm nay
  const since = new Date(Date.now() - (days - 1) * 86400_000);
  since.setUTCHours(0, 0, 0, 0);
  const rows = await c.runs.find({ startedAt: { $gte: since.toISOString() } }, { projection: { status: 1, startedAt: 1 } }).toArray();
  const out: { date: string; succeeded: number; failed: number; other: number; total: number }[] = [];
  for (let i = 0; i < days; i++) {
    out.push({ date: new Date(since.getTime() + i * 86400_000).toISOString().slice(0, 10), succeeded: 0, failed: 0, other: 0, total: 0 });
  }
  for (const r of rows) {
    const day = out.find((x) => x.date === r.startedAt.slice(0, 10));
    if (!day) continue;
    day.total++;
    if (r.status === 'succeeded') day.succeeded++;
    else if (r.status === 'failed') day.failed++;
    else day.other++;
  }
  return out;
}

const emptyBucket = (): UsageBucket => ({ runs: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costUsd: 0 });

function addTo(b: UsageBucket, u: Partial<Run['usage']> | undefined, runs = 1): void {
  b.runs += runs;
  b.inputTokens += u?.inputTokens ?? 0;
  b.cachedInputTokens += u?.cachedInputTokens ?? 0;
  b.outputTokens += u?.outputTokens ?? 0;
  b.costUsd += u?.costUsd ?? 0;
}

const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Lỗi của máy chủ trung gian thường ghi "remain quota: $0.23, need quota: $1.57". */
function parseQuotaError(message: string): { remainingUsd: number | null; neededUsd: number | null } {
  const rem = /remain(?:ing)?[_\s]*quota[^$\d]*\$?\s*([\d.]+)/i.exec(message);
  const need = /need(?:ed)?[_\s]*quota[^$\d]*\$?\s*([\d.]+)/i.exec(message);
  return { remainingUsd: rem ? Number(rem[1]) : null, neededUsd: need ? Number(need[1]) : null };
}

/**
 * Token & chi phí của từng kết nối AI: 5 giờ qua (khớp hạn mức 5 giờ của gói Claude/ChatGPT), hôm nay, 7 ngày, 30 ngày,
 * từ trước tới nay, biểu đồ 24 giờ / 14 ngày và model dùng nhiều nhất.
 */
export async function providerUsage(): Promise<Record<string, ProviderUsage>> {
  const c = await getCollections();
  const nowMs = Date.now();
  const start = new Date(nowMs);
  start.setHours(0, 0, 0, 0);
  const since30 = nowMs - 30 * 86400_000;
  const sums = {
    inputTokens: { $sum: { $ifNull: ['$usage.inputTokens', 0] } },
    cachedInputTokens: { $sum: { $ifNull: ['$usage.cachedInputTokens', 0] } },
    outputTokens: { $sum: { $ifNull: ['$usage.outputTokens', 0] } },
    costUsd: { $sum: { $ifNull: ['$usage.costUsd', 0] } },
  };
  type Sum = { runs: number; inputTokens: number; cachedInputTokens: number; outputTokens: number; costUsd: number };
  const [providers, recent, allRuns, perTask, tasks, limits] = await Promise.all([
    c.providers.find({}, { projection: { kind: 1, authMode: 1 } }).toArray(),
    c.runs
      .find({ providerId: { $ne: null }, startedAt: { $gte: new Date(since30).toISOString() } }, { projection: { providerId: 1, model: 1, usage: 1, startedAt: 1 } })
      .toArray(),
    c.runs
      .aggregate<Sum & { _id: { providerId: string; model: string | null }; lastRunAt: string }>([
        { $match: { providerId: { $ne: null } } },
        { $group: { _id: { providerId: '$providerId', model: '$model' }, runs: { $sum: 1 }, ...sums, lastRunAt: { $max: '$startedAt' } } },
      ])
      .toArray(),
    c.runs.aggregate<Sum & { _id: string }>([{ $group: { _id: '$taskId', runs: { $sum: 1 }, ...sums } }]).toArray(),
    c.tasks
      .find({ providerId: { $ne: null }, usage: { $exists: true } }, { projection: { providerId: 1, model: 1, usage: 1, attempts: 1, startedAt: 1, createdAt: 1, finishedAt: 1 } })
      .toArray(),
    c.runs
      .aggregate<{ _id: string; error: string | null; at: string }>([
        { $match: { status: 'limited', providerId: { $ne: null } } },
        { $sort: { startedAt: -1 } },
        { $group: { _id: '$providerId', error: { $first: '$error' }, at: { $first: { $ifNull: ['$finishedAt', '$startedAt'] } } } },
      ])
      .toArray(),
  ]);

  // Kết nối tính tiền theo API mà không báo giá → ước tính theo bảng giá
  const apiBilled = new Set(providers.filter((p) => p.kind === 'api' || (p.kind === 'cli' && p.authMode === 'api_key')).map((p) => p._id));
  const estimated = new Set<string>();
  const costOf = (providerId: string, model: string | null | undefined, u: Partial<UsageBucket> | undefined): number => {
    if (u?.costUsd || !apiBilled.has(providerId) || !(u?.inputTokens || u?.outputTokens)) return u?.costUsd ?? 0;
    const est = estimateCost(model, u);
    if (est == null) return 0;
    estimated.add(providerId);
    return est;
  };

  /**
   * Mỗi "phần dùng": một lượt chạy, hoặc phần token của nhiệm vụ chưa có lượt chạy ghi lại (nhiệm vụ chạy trước khi có
   * bảng lượt chạy) – tính vào lúc nhiệm vụ bắt đầu. Nhờ vậy 5 giờ / hôm nay / 7 ngày / 30 ngày khớp với tổng.
   */
  type Part = { providerId: string; model: string | null; at: number; runs: number; usage: Omit<UsageBucket, 'runs'> };
  const parts: Part[] = recent.map((r) => ({
    providerId: r.providerId!,
    model: r.model,
    at: new Date(r.startedAt).getTime(),
    runs: 1,
    usage: { inputTokens: r.usage?.inputTokens ?? 0, cachedInputTokens: r.usage?.cachedInputTokens ?? 0, outputTokens: r.usage?.outputTokens ?? 0, costUsd: costOf(r.providerId!, r.model, r.usage) },
  }));
  const legacy: Part[] = [];
  const recorded = new Map(perTask.map((t) => [t._id, t]));
  for (const t of tasks) {
    const r = recorded.get(t._id);
    const rest = {
      inputTokens: Math.max(0, (t.usage?.inputTokens ?? 0) - (r?.inputTokens ?? 0)),
      cachedInputTokens: Math.max(0, (t.usage?.cachedInputTokens ?? 0) - (r?.cachedInputTokens ?? 0)),
      outputTokens: Math.max(0, (t.usage?.outputTokens ?? 0) - (r?.outputTokens ?? 0)),
      costUsd: Math.max(0, (t.usage?.costUsd ?? 0) - (r?.costUsd ?? 0)),
    };
    if (!rest.inputTokens && !rest.outputTokens && !rest.costUsd) continue;
    const id = t.providerId!;
    legacy.push({
      providerId: id,
      model: t.model ?? null,
      at: new Date(t.startedAt ?? t.createdAt).getTime(),
      runs: Math.max(1, (t.attempts ?? 1) - (r?.runs ?? 0)),
      usage: { ...rest, costUsd: costOf(id, t.model, rest) },
    });
  }
  parts.push(...legacy.filter((p) => p.at >= since30));

  const days: string[] = [];
  for (let i = 13; i >= 0; i--) days.push(localDate(new Date(start.getTime() - i * 86400_000)));
  const hourStart = Math.floor(nowMs / 3600_000) * 3600_000;
  const hours = Array.from({ length: 24 }, (_, i) => hourStart - (23 - i) * 3600_000);
  const out: Record<string, ProviderUsage> = {};
  const get = (id: string) =>
    (out[id] ??= {
      h5: emptyBucket(),
      today: emptyBucket(),
      d7: emptyBucket(),
      d30: emptyBucket(),
      all: emptyBucket(),
      daily: days.map((date) => ({ date, tokens: 0, costUsd: 0 })),
      hourly: hours.map((h) => ({ hour: new Date(h).toISOString(), tokens: 0, costUsd: 0 })),
      models: [],
      lastRunAt: null,
      lastLimit: null,
      costEstimated: false,
    });

  const models = new Map<string, Map<string, { tokens: number; costUsd: number; runs: number }>>();
  for (const p of parts) {
    const u = get(p.providerId);
    addTo(u.d30, p.usage, p.runs);
    if (p.at >= nowMs - 7 * 86400_000) addTo(u.d7, p.usage, p.runs);
    if (p.at >= start.getTime()) addTo(u.today, p.usage, p.runs);
    if (p.at >= nowMs - 5 * 3600_000) addTo(u.h5, p.usage, p.runs);
    const tokens = p.usage.inputTokens + p.usage.outputTokens;
    const day = u.daily.find((d) => d.date === localDate(new Date(p.at)));
    if (day) {
      day.tokens += tokens;
      day.costUsd += p.usage.costUsd;
    }
    const hi = Math.floor((p.at - hours[0]) / 3600_000);
    if (hi >= 0 && hi < 24) {
      u.hourly[hi].tokens += tokens;
      u.hourly[hi].costUsd += p.usage.costUsd;
    }
    if (!u.lastRunAt || p.at > new Date(u.lastRunAt).getTime()) u.lastRunAt = new Date(p.at).toISOString();
    const byModel = models.get(p.providerId) ?? new Map();
    models.set(p.providerId, byModel);
    const key = p.model || 'mặc định';
    const m = byModel.get(key) ?? { tokens: 0, costUsd: 0, runs: 0 };
    m.tokens += tokens;
    m.costUsd += p.usage.costUsd;
    m.runs += p.runs;
    byModel.set(key, m);
  }
  for (const [id, byModel] of models) {
    get(id).models = Array.from(byModel, ([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 4);
  }

  // Từ trước tới nay = mọi lượt chạy + phần của nhiệm vụ cũ chưa có lượt chạy ghi lại
  for (const g of allRuns) {
    const u = get(g._id.providerId);
    addTo(u.all, { ...g, costUsd: costOf(g._id.providerId, g._id.model, g) }, g.runs);
    if (g.lastRunAt && (!u.lastRunAt || g.lastRunAt > u.lastRunAt)) u.lastRunAt = g.lastRunAt;
  }
  for (const p of legacy) addTo(get(p.providerId).all, p.usage, p.runs);
  for (const l of limits) {
    const message = l.error ?? 'Hết hạn mức';
    get(l._id).lastLimit = { message: message.slice(0, 400), at: l.at, ...parseQuotaError(message) };
  }
  for (const id of estimated) if (out[id]) out[id].costEstimated = true;
  return out;
}

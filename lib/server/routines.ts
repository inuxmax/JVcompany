// Lịch định kỳ (routines): tạo nhiệm vụ theo lịch cron, webhook hoặc gọi API; có chính sách chạy trùng / chạy bù.
import crypto from 'crypto';
import { CronExpressionParser } from 'cron-parser';
import type { Project, Routine, RoutineRun, RoutineTrigger, Task } from '../types';
import { ACTIVE_TASK_STATUSES, DIRECTOR_WORKFLOW_ID } from '../catalog';
import { currentCompanyId, getCollections, newId, now } from './db';
import { emit, wakeWorker } from './bus';
import { logActivity } from './activity';
import { createProject, createTask, getSettings, updateProject } from './repo';
import { LocalizedError } from './http';
import { m } from '../i18n';

export const DEFAULT_TZ = 'Asia/Ho_Chi_Minh';

/** Lần chạy kế tiếp sau thời điểm `from` (null nếu cron sai). */
export function nextRunAt(cron: string, timezone = DEFAULT_TZ, from = new Date()): string | null {
  try {
    return CronExpressionParser.parse(cron, { tz: timezone, currentDate: from }).next().toDate().toISOString();
  } catch {
    return null;
  }
}

export function validCron(cron: string, timezone = DEFAULT_TZ): string | null {
  try {
    CronExpressionParser.parse(cron, { tz: timezone });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Lịch cron không hợp lệ';
  }
}

/** Dự án nội bộ "Việc chung công ty" chứa việc heartbeat / lịch định kỳ không thuộc dự án nào (không chiếm tầng). */
export async function ensureOpsProject(): Promise<Project> {
  const c = await getCollections();
  const existing = await c.projects.findOne({ internal: true, internalKind: { $ne: 'evals' } });
  if (existing) return existing;
  const settings = await getSettings();
  const p = await createProject({
    name: 'Việc chung công ty',
    description: 'Việc định kỳ và heartbeat của các phòng ban (không thuộc dự án cụ thể nào).',
    goal: '',
    path: null,
    autopilot: true,
    permission: settings.defaultPermission,
    workflowId: DIRECTOR_WORKFLOW_ID,
  });
  await updateProject(p._id, { internal: true });
  return (await c.projects.findOne({ _id: p._id }))!;
}

export async function listRoutines(): Promise<Routine[]> {
  const c = await getCollections();
  return c.routines.find({ status: { $ne: 'archived' } }, { projection: { webhookSecret: 0 } }).sort({ createdAt: 1 }).toArray();
}

export async function getRoutine(id: string, withSecret = false): Promise<Routine | null> {
  const c = await getCollections();
  return c.routines.findOne({ _id: id }, withSecret ? {} : { projection: { webhookSecret: 0 } });
}

function normalizeTriggers(triggers: Partial<RoutineTrigger>[] | undefined, prev: RoutineTrigger[] = []): RoutineTrigger[] {
  return (triggers ?? []).slice(0, 10).map((t) => {
    const old = prev.find((p) => p.id === t.id);
    const kind = t.kind === 'webhook' || t.kind === 'api' ? t.kind : 'schedule';
    const base: RoutineTrigger = { id: t.id || newId(), kind, enabled: t.enabled ?? true };
    if (kind === 'schedule') {
      const cron = (t.cron ?? old?.cron ?? '0 9 * * *').trim();
      const timezone = t.timezone || old?.timezone || DEFAULT_TZ;
      const err = validCron(cron, timezone);
      if (err) throw new LocalizedError(m('Lịch "{cron}" không hợp lệ: {error}'), { cron, error: err });
      return { ...base, cron, timezone, nextRunAt: old?.cron === cron && old?.timezone === timezone && old.nextRunAt ? old.nextRunAt : nextRunAt(cron, timezone), lastFiredAt: old?.lastFiredAt ?? null };
    }
    if (kind === 'webhook') return { ...base, publicId: old?.publicId ?? crypto.randomBytes(12).toString('hex'), signingMode: t.signingMode ?? old?.signingMode ?? 'bearer', lastFiredAt: old?.lastFiredAt ?? null };
    return { ...base, lastFiredAt: old?.lastFiredAt ?? null };
  });
}

export async function saveRoutine(data: Partial<Routine> & { title: string; departmentId: string }): Promise<Routine> {
  const c = await getCollections();
  const ts = now();
  const prev = data._id ? await c.routines.findOne({ _id: data._id }) : null;
  const routine: Routine = {
    _id: prev?._id ?? newId(),
    title: data.title.trim().slice(0, 200),
    instructions: (data.instructions ?? prev?.instructions ?? '').trim(),
    departmentId: data.departmentId,
    projectId: data.projectId ?? prev?.projectId ?? null,
    priority: data.priority ?? prev?.priority ?? 'normal',
    status: data.status ?? prev?.status ?? 'active',
    concurrency: data.concurrency ?? prev?.concurrency ?? 'coalesce_if_active',
    catchUp: data.catchUp ?? prev?.catchUp ?? 'skip_missed',
    variables: (data.variables ?? prev?.variables ?? []).filter((v) => /^[a-zA-Z_][\w]*$/.test(v.name)).slice(0, 20),
    triggers: normalizeTriggers(data.triggers ?? prev?.triggers ?? [{ kind: 'schedule', cron: '0 9 * * *' }], prev?.triggers),
    webhookSecret: prev?.webhookSecret ?? crypto.randomBytes(24).toString('hex'),
    lastTriggeredAt: prev?.lastTriggeredAt ?? null,
    revision: (prev?.revision ?? 0) + 1,
    createdAt: prev?.createdAt ?? ts,
    updatedAt: ts,
  };
  await c.routines.replaceOne({ _id: routine._id }, routine, { upsert: true });
  await logActivity({ action: prev ? 'routine.updated' : 'routine.created', entityType: 'routine', entityId: routine._id, summary: `${prev ? 'Sửa' : 'Tạo'} lịch định kỳ "${routine.title}"` });
  await emit('routine.updated', null, { id: routine._id });
  const { webhookSecret: _s, ...pub } = routine;
  void _s;
  return pub as Routine;
}

export async function rotateWebhookSecret(id: string): Promise<string> {
  const c = await getCollections();
  const secret = crypto.randomBytes(24).toString('hex');
  await c.routines.updateOne({ _id: id }, { $set: { webhookSecret: secret, updatedAt: now() } });
  await logActivity({ action: 'routine.secret_rotated', entityType: 'routine', entityId: id, summary: 'Đổi mã bí mật webhook của lịch định kỳ' });
  return secret;
}

export async function archiveRoutine(id: string): Promise<void> {
  const c = await getCollections();
  await c.routines.updateOne({ _id: id }, { $set: { status: 'archived', updatedAt: now() } });
  await emit('routine.updated', null, { id });
}

/** Thay {{biến}}, {{date}}, {{timestamp}} trong tiêu đề / hướng dẫn. */
function interpolate(text: string, vars: Record<string, unknown>): string {
  const d = new Date();
  const builtins: Record<string, string> = { date: d.toLocaleDateString('vi-VN', { timeZone: DEFAULT_TZ }), timestamp: d.toISOString() };
  return text.replace(/\{\{\s*([a-zA-Z_][\w]*)\s*\}\}/g, (_m, k: string) => String(vars[k] ?? builtins[k] ?? ''));
}

/** Kích hoạt một lượt: kiểm tra chạy trùng rồi tạo nhiệm vụ cho phòng được giao. */
export async function fireRoutine(routine: Routine, source: RoutineRun['source'], payload: Record<string, unknown> = {}, idempotencyKey?: string): Promise<RoutineRun> {
  const c = await getCollections();
  if (idempotencyKey) {
    const dup = await c.routineRuns.findOne({ routineId: routine._id, 'payload.idempotencyKey': idempotencyKey });
    if (dup) return dup;
  }
  const run: RoutineRun = { _id: newId(), routineId: routine._id, source, status: 'received', taskId: null, payload: { ...payload, ...(idempotencyKey ? { idempotencyKey } : {}) }, reason: null, createdAt: now() };
  const open = await c.tasks.findOne({ routineId: routine._id, status: { $in: ACTIVE_TASK_STATUSES } });
  if (open && routine.concurrency !== 'always_enqueue') {
    run.status = routine.concurrency === 'coalesce_if_active' ? 'coalesced' : 'skipped';
    run.taskId = open._id;
    run.reason = `Lượt trước (${open.identifier ?? open._id}) vẫn đang chạy.`;
  } else {
    const dept = await c.departments.findOne({ _id: routine.departmentId });
    if (!dept || !dept.enabled) {
      run.status = 'failed';
      run.reason = `Phòng "${routine.departmentId}" không tồn tại hoặc đang tắt.`;
    } else {
      const vars: Record<string, unknown> = {};
      for (const v of routine.variables) vars[v.name] = (payload.variables as Record<string, unknown> | undefined)?.[v.name] ?? payload[v.name] ?? v.default ?? '';
      const project = routine.projectId ? await c.projects.findOne({ _id: routine.projectId }) : null;
      const target = project ?? (await ensureOpsProject());
      const task = await createTask({
        projectId: target._id,
        kind: 'routine',
        title: interpolate(routine.title, vars).slice(0, 120),
        instructions: `${interpolate(routine.instructions || routine.title, vars)}${source === 'webhook' && Object.keys(payload).length ? `\n\n# Dữ liệu webhook\n\`\`\`json\n${JSON.stringify(payload, null, 2).slice(0, 4000)}\n\`\`\`` : ''}`,
        departmentId: routine.departmentId,
        assignedBy: 'system',
        phase: '',
        priority: routine.priority,
        adhoc: true,
        waitForChildren: true,
        routineId: routine._id,
        wakeReason: 'routine',
      });
      run.status = 'task_created';
      run.taskId = task._id;
      wakeWorker();
    }
  }
  await c.routineRuns.insertOne(run);
  await c.routines.updateOne({ _id: routine._id }, { $set: { lastTriggeredAt: run.createdAt } });
  await logActivity({ actorType: source === 'manual' ? 'user' : 'system', action: 'routine.run_triggered', entityType: 'routine', entityId: routine._id, summary: `Lịch "${routine.title}" (${source}): ${run.status === 'task_created' ? 'đã tạo nhiệm vụ' : run.reason ?? run.status}` });
  await emit('routine.updated', null, { id: routine._id, run: run._id });
  return run;
}

/** Lịch sử lượt chạy (trạng thái lấy theo nhiệm vụ đã tạo). */
export async function listRoutineRuns(routineId: string, limit = 50): Promise<(RoutineRun & { task?: Pick<Task, '_id' | 'identifier' | 'status' | 'title'> | null })[]> {
  const c = await getCollections();
  const runs = await c.routineRuns.find({ routineId }).sort({ createdAt: -1 }).limit(limit).toArray();
  const ids = runs.map((r) => r.taskId).filter((x): x is string => Boolean(x));
  const tasks = await c.tasks.find({ _id: { $in: ids } }, { projection: { identifier: 1, status: 1, title: 1 } }).toArray();
  return runs.map((r) => {
    const t = tasks.find((x) => x._id === r.taskId) ?? null;
    const status = r.status === 'task_created' && t ? (t.status === 'done' ? 'completed' : t.status === 'failed' || t.status === 'cancelled' ? 'failed' : r.status) : r.status;
    return { ...r, status, task: t };
  });
}

/** Lần rà soát gần nhất theo công ty (mỗi công ty tối đa ~20 giây một lần). */
const lastTick = new Map<string, number>();

/** Worker gọi định kỳ: kích hoạt các lịch cron đến hạn (có xử lý lượt bị lỡ). */
export async function tickRoutines(): Promise<void> {
  const companyId = await currentCompanyId();
  if (Date.now() - (lastTick.get(companyId) ?? 0) < 20_000) return;
  lastTick.set(companyId, Date.now());
  const c = await getCollections();
  const nowDate = new Date();
  const due = await c.routines.find({ status: 'active', triggers: { $elemMatch: { kind: 'schedule', enabled: true, nextRunAt: { $lte: nowDate.toISOString() } } } }).toArray();
  for (const r of due) {
    const triggers = [...r.triggers];
    for (const [i, t] of triggers.entries()) {
      if (t.kind !== 'schedule' || !t.enabled || !t.cron || !t.nextRunAt || t.nextRunAt > nowDate.toISOString()) continue;
      // Các mốc đến hạn từ lần hẹn trước tới nay
      const slots: string[] = [t.nextRunAt];
      let cursor = new Date(t.nextRunAt);
      while (slots.length < 26) {
        const n = nextRunAt(t.cron, t.timezone, cursor);
        if (!n || n > nowDate.toISOString()) break;
        slots.push(n);
        cursor = new Date(n);
      }
      const latest = slots[slots.length - 1];
      const fresh = nowDate.getTime() - new Date(latest).getTime() < 5 * 60_000;
      const fires = r.catchUp === 'enqueue_missed' ? slots.slice(-25) : fresh ? [latest] : [];
      for (const slot of fires) await fireRoutine(r, 'schedule', { scheduledFor: slot });
      if (!fires.length) await logActivity({ actorType: 'system', action: 'routine.missed', entityType: 'routine', entityId: r._id, summary: `Lịch "${r.title}" bỏ qua ${slots.length} lượt bị lỡ (máy tắt).` });
      triggers[i] = { ...t, lastFiredAt: fires.length ? nowDate.toISOString() : t.lastFiredAt, nextRunAt: nextRunAt(t.cron, t.timezone, nowDate) };
    }
    await c.routines.updateOne({ _id: r._id }, { $set: { triggers } });
  }
}

/** Kiểm tra chữ ký webhook: Bearer <mã> hoặc HMAC-SHA256 của nội dung ("X-Signature: sha256=<hex>"). */
export function verifyWebhook(routine: Routine, trigger: RoutineTrigger, headers: Headers, rawBody: string): boolean {
  const mode = trigger.signingMode ?? 'bearer';
  if (mode === 'none') return true;
  const secret = routine.webhookSecret ?? '';
  if (!secret) return false;
  const safeEq = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  if (mode === 'bearer') return safeEq(headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '', secret);
  const sig = (headers.get('x-signature') ?? headers.get('x-hub-signature-256') ?? '').replace(/^sha256=/, '');
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEq(sig, expected);
}

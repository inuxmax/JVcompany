// Worker nền: lấy nhiệm vụ trong hàng đợi, chạy song song có giới hạn, tự chạy lại khi có lại hạn mức.
import type { Filter } from 'mongodb';
import type { Task, TaskPriority } from '../../types';
import { MAIN_COMPANY, currentCompanyId, getCollections, getRootCollections, now, runWithCompany } from '../db';
import { activeCompanyIds } from '../company';
import { bus, emit } from '../bus';
import { createProvider, getSettings, listProviders, postMessage, resolveApproval, updateSettings, updateTask } from '../repo';
import { getPreset } from '../../catalog';
import { control, registerRunning, runningForCompany, runningForProject, unregisterRunning } from './control';
import { runTask } from './runner';
import { detectLocalAgents } from './detect';
import { assignQueuedProjects } from './orchestrator';
import { tickRoutines } from '../routines';
import { tickHeartbeats } from '../heartbeat';
import { startChatConnectors } from '../telegram';
import { tickEvals } from '../evals';
import { noteContent, sysMsg } from '../../i18n/format';

const PRIORITY: Record<TaskPriority, number> = { critical: -1, high: 0, normal: 1, low: 2 };
let ticking = false;
let again = false;

const HEARTBEAT_MS = 15_000;
const STALE_MS = 60_000;

/** Chạy một việc lần lượt cho từng công ty đang hoạt động (mỗi công ty một CSDL, một toà nhà). */
export async function forEachCompany(fn: (companyId: string) => Promise<void>): Promise<void> {
  let ids: string[] = [MAIN_COMPANY];
  try {
    ids = await runWithCompany(MAIN_COMPANY, () => activeCompanyIds());
  } catch (err) {
    console.error('[jvcompany] Không đọc được danh sách công ty:', err);
  }
  for (const id of ids) {
    await runWithCompany(id, () => fn(id)).catch((err) => console.error(`[jvcompany] worker (${id}) lỗi:`, err));
  }
}

async function heartbeat() {
  const c = await getRootCollections();
  await c.meta.updateOne(
    { _id: `worker:${control.workerId}` },
    { $set: { value: { seenAt: Date.now(), pid: process.pid, running: control.running.size } } },
    { upsert: true },
  );
}

/** Worker còn sống nếu nhịp tim gần đây. */
async function aliveWorkers(): Promise<Set<string>> {
  const c = await getRootCollections();
  const rows = await c.meta.find({ _id: { $regex: '^worker:' } }).toArray();
  const alive = new Set<string>();
  for (const r of rows) {
    const seenAt = (r.value as { seenAt?: number } | undefined)?.seenAt ?? 0;
    if (Date.now() - seenAt < STALE_MS) alive.add(r._id.slice('worker:'.length));
    else await c.meta.deleteOne({ _id: r._id });
  }
  return alive;
}

/** Đưa nhiệm vụ bị bỏ dở (worker đã chết / máy chủ khởi động lại) về hàng đợi. */
async function recover() {
  const c = await getCollections();
  const alive = await aliveWorkers();
  const stale = await c.tasks.find({ status: { $in: ['running', 'waiting_approval'] } }).toArray();
  for (const t of stale) {
    if (control.running.has(t._id)) continue;
    if (t.workerId && t.workerId !== control.workerId && alive.has(t.workerId)) continue;
    await updateTask(t._id, { status: 'queued', liveText: null, workerId: null });
    await postMessage({
      projectId: t.projectId,
      taskId: t._id,
      author: { type: 'system' },
      kind: 'system',
      ...noteContent(sysMsg('Máy chủ đã khởi động lại – nhiệm vụ "{title}" được xếp hàng chạy lại.', { title: t.title })),
    });
    const pending = await c.approvals.find({ taskId: t._id, status: 'pending' }).toArray();
    for (const a of pending) await resolveApproval(a._id, 'expired', { note: 'Máy chủ khởi động lại' });
  }
}

/** Lần chạy đầu tiên: tự thêm các agent CLI tìm thấy + kết nối trình duyệt. */
async function bootstrap() {
  const settings = await getSettings();
  if (settings.setupDone) return;
  const existing = await listProviders();
  let defaultId: string | null = settings.defaultProviderId;
  try {
    const detected = await detectLocalAgents();
    for (const d of detected) {
      if (existing.some((p) => p.type === d.type)) continue;
      const preset = getPreset(d.type);
      const p = await createProvider({
        name: d.type === 'ollama' ? 'Ollama (máy này)' : `${preset.label} (gói đăng ký)`,
        type: d.type,
        kind: preset.kind,
        enabled: true,
        command: d.type === 'ollama' ? undefined : preset.command,
        baseUrl: d.type === 'ollama' ? preset.baseUrl : undefined,
        defaultModel: d.models?.[0] ?? preset.defaultModel ?? '',
        models: d.models ?? preset.models,
        status: { ok: true, message: `Tự phát hiện: ${d.path}`, version: d.version, checkedAt: now() },
      });
      if (!defaultId && d.type === 'claude-code') defaultId = p._id;
    }
  } catch (err) {
    console.error('[jvcompany] Quét agent thất bại:', err);
  }
  if (!existing.some((p) => p.kind === 'manual')) {
    const preset = getPreset('web-manual');
    const p = await createProvider({
      name: 'Trình duyệt (ChatGPT / Claude.ai / Gemini / Grok)',
      type: 'web-manual',
      kind: 'manual',
      enabled: true,
      webUrl: preset.webUrl,
      defaultModel: '',
      models: [],
      status: { ok: true, message: 'Sẵn sàng', checkedAt: now() },
    });
    if (!defaultId) {
      const all = await listProviders();
      defaultId = all.find((x) => x.kind !== 'manual')?._id ?? p._id;
    }
  }
  await updateSettings({ setupDone: true, defaultProviderId: defaultId });
}

async function syncAuthOnStart() {
  const root = await getRootCollections();
  const { readSnapshot } = await import('../../auth-token');
  if ((await root.users.estimatedDocumentCount()) > 0 || readSnapshot().enabled) {
    const { syncAuthSnapshot } = await import('../auth');
    await syncAuthSnapshot();
  }
}

export async function tick() {
  if (ticking) {
    again = true;
    return;
  }
  ticking = true;
  try {
    do {
      again = false;
      await forEachCompany(() => tickOnce());
    } while (again);
  } catch (err) {
    console.error('[jvcompany] worker tick lỗi:', err);
  } finally {
    ticking = false;
  }
}

async function tickOnce() {
  const settings = await getSettings();
  if (!settings.workerEnabled) return;
  await assignQueuedProjects();
  // Lịch định kỳ & heartbeat (tự giới hạn ~20 giây một lần)
  await tickRoutines().catch((err) => console.error('[jvcompany] Lịch định kỳ lỗi:', err));
  await tickHeartbeats().catch((err) => console.error('[jvcompany] Heartbeat lỗi:', err));
  await tickEvals().catch((err) => console.error('[jvcompany] Bộ đánh giá lỗi:', err));
  const companyId = await currentCompanyId();
  const capacity = settings.concurrency - runningForCompany(companyId);
  if (capacity <= 0) return;
  const c = await getCollections();
  const nowIso = now();
  const filter: Filter<Task> = {
    $or: [{ status: 'queued' }, { status: 'waiting_limit', retryAt: { $lte: nowIso } }],
  };
  const candidates = await c.tasks.find(filter, { projection: { output: 0, liveText: 0 } }).sort({ createdAt: 1 }).limit(100).toArray();
  if (!candidates.length) return;
  candidates.sort((a, b) => PRIORITY[a.priority] - PRIORITY[b.priority] || a.createdAt.localeCompare(b.createdAt));

  // Tạm dừng (vượt ngân sách / chờ duyệt tuyển / nghỉ việc) → không nhận lượt chạy mới
  const company = await c.companies.findOne({ _id: companyId }, { projection: { status: 1 } });
  if (company?.status === 'paused') return;
  const blockedDepts = new Set(
    (await c.departments.find({ status: { $in: ['paused', 'terminated', 'pending_approval'] } }, { projection: { _id: 1 } }).toArray()).map((d) => d._id),
  );

  const projectIds = Array.from(new Set(candidates.map((t) => t.projectId)));
  const projects = await c.projects.find({ _id: { $in: projectIds } }, { projection: { status: 1 } }).toArray();
  const status = new Map(projects.map((p) => [p._id, p.status]));

  let started = 0;
  for (const t of candidates) {
    if (started >= capacity) break;
    if (blockedDepts.has(t.departmentId)) continue;
    const ps = status.get(t.projectId);
    if (!ps || ps === 'cancelled') continue;
    if (ps !== 'active' && !t.adhoc) continue;
    if (runningForProject(t.projectId) >= settings.perProjectConcurrency) continue;
    if (control.running.has(t._id)) continue;
    const claimed = await c.tasks.findOneAndUpdate(
      { _id: t._id, status: t.status },
      { $set: { status: 'running', workerId: control.workerId, updatedAt: now() } },
      { returnDocument: 'after' },
    );
    if (!claimed) continue;
    started++;
    const controller = registerRunning(t._id, t.projectId, companyId);
    void emit('task.updated', t.projectId, { id: t._id, status: 'running' });
    runTask(t._id, controller.signal)
      .catch((err) => console.error(`[jvcompany] runTask ${t._id} lỗi:`, err))
      .finally(() => {
        unregisterRunning(t._id);
        void emit('worker.state');
        void tick();
      });
  }
}

export async function startWorker() {
  if (control.started) return;
  control.started = true;
  control.startedAt = now();
  try {
    await getRootCollections();
    await heartbeat();
    await forEachCompany(() => recover());
    await runWithCompany(MAIN_COMPANY, () => bootstrap());
    // Tài khoản đăng nhập: ghi lại ảnh chụp cho proxy.ts (khi đã có tài khoản)
    await syncAuthOnStart().catch((err) => console.error('[jvcompany] Đồng bộ tài khoản lỗi:', err));
  } catch (err) {
    console.error('[jvcompany] Không khởi động được worker (MongoDB?):', err);
    control.started = false;
    setTimeout(() => void startWorker(), 10_000);
    return;
  }
  bus.on('wake', () => void tick());
  // Kênh chat (Telegram): nhận tin + gửi câu trả lời của agent
  startChatConnectors(
    (fn) => forEachCompany(() => fn()),
    (companyId, fn) => runWithCompany(companyId, fn),
  );
  setInterval(() => void tick(), 5_000);
  setInterval(() => void heartbeat().catch(() => {}), HEARTBEAT_MS);
  // Định kỳ thu hồi nhiệm vụ của worker đã chết (vd: một instance khác bị tắt đột ngột).
  setInterval(() => void forEachCompany(() => recover()).catch(() => {}), STALE_MS);
  console.log('[jvcompany] Worker đã khởi động.');
  void tick();
}

// Heartbeat: phòng ban tự thức dậy theo chu kỳ để rà soát việc của mình (giống heartbeat của Paperclip).
import type { Department, HeartbeatConfig } from '../types';
import { ACTIVE_TASK_STATUSES } from '../catalog';
import { currentCompanyId, getCollections, now } from './db';
import { wakeWorker } from './bus';
import { logActivity } from './activity';
import { createTask } from './repo';
import { ensureOpsProject } from './routines';

export const DEFAULT_HEARTBEAT: HeartbeatConfig = { enabled: false, intervalSec: 3600, skipWhenNoWork: true, maxDailyRuns: 24, maxDailyCostUsd: 0, instructions: '' };

/** Lần rà soát gần nhất theo công ty (mỗi công ty tối đa ~20 giây một lần). */
const lastTick = new Map<string, number>();

function dayStart(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Worker gọi định kỳ: tạo lượt heartbeat cho các phòng đến hạn. */
export async function tickHeartbeats(): Promise<void> {
  const companyId = await currentCompanyId();
  if (Date.now() - (lastTick.get(companyId) ?? 0) < 20_000) return;
  lastTick.set(companyId, Date.now());
  const c = await getCollections();
  const company = await c.companies.findOne({ _id: companyId });
  if (company?.status === 'paused') return;
  const depts = await c.departments.find({ enabled: true, 'heartbeat.enabled': true }).toArray();
  for (const d of depts) {
    if (d.status && d.status !== 'active') continue;
    const hb = { ...DEFAULT_HEARTBEAT, ...d.heartbeat };
    const interval = Math.max(60, hb.intervalSec) * 1000;
    const last = d.lastHeartbeatAt ? new Date(d.lastHeartbeatAt).getTime() : new Date(d.createdAt).getTime();
    if (Date.now() - last < interval) continue;
    await c.departments.updateOne({ _id: d._id }, { $set: { lastHeartbeatAt: now() } });
    await maybeBeat(d, hb);
  }
}

async function maybeBeat(d: Department, hb: HeartbeatConfig): Promise<void> {
  const c = await getCollections();
  // Đang có lượt heartbeat chưa xong → không chồng thêm
  if (await c.tasks.findOne({ departmentId: d._id, kind: 'heartbeat', status: { $in: ACTIVE_TASK_STATUSES } })) return;
  const open = await c.tasks
    .find({ departmentId: d._id, kind: { $nin: ['heartbeat'] }, status: { $in: ACTIVE_TASK_STATUSES } }, { projection: { identifier: 1, title: 1, status: 1, projectId: 1 } })
    .limit(20)
    .toArray();
  if (hb.skipWhenNoWork && !open.length) return;
  const today = dayStart();
  if (hb.maxDailyRuns > 0) {
    const n = await c.tasks.countDocuments({ departmentId: d._id, kind: 'heartbeat', createdAt: { $gte: today } });
    if (n >= hb.maxDailyRuns) return;
  }
  if (hb.maxDailyCostUsd > 0) {
    const ids = (await c.tasks.find({ departmentId: d._id, kind: 'heartbeat', createdAt: { $gte: today } }, { projection: { _id: 1 } }).toArray()).map((t) => t._id);
    const spent = (await c.costEvents.find({ taskId: { $in: ids } }, { projection: { costUsd: 1 } }).toArray()).reduce((s, e) => s + e.costUsd, 0);
    if (spent >= hb.maxDailyCostUsd) return;
  }
  const ops = await ensureOpsProject();
  const list = open.map((t) => `- ${t.identifier ?? ''} ${t.title} [${t.status}]`).join('\n');
  await createTask({
    projectId: ops._id,
    kind: 'heartbeat',
    title: `Heartbeat: ${d.name} rà soát công việc`,
    instructions: `${hb.instructions?.trim() || 'Đây là lượt tự rà soát định kỳ. Xem các việc đang mở của bạn, phát hiện việc bị kẹt / chờ quá lâu, đề xuất bước tiếp theo, và báo cáo ngắn những gì cần chủ công ty chú ý. Không làm lại việc đã xong.'}

# Việc đang mở của ${d.name}
${list || '(không có việc đang mở)'}`,
    departmentId: d._id,
    assignedBy: 'system',
    phase: '',
    priority: 'low',
    adhoc: true,
    waitForChildren: true,
    wakeReason: 'heartbeat',
  });
  await logActivity({ actorType: 'system', action: 'heartbeat.invoked', entityType: 'department', entityId: d._id, summary: `Heartbeat: ${d.name} thức dậy rà soát ${open.length} việc đang mở` });
  wakeWorker();
}

/** Chạy heartbeat ngay (nút "Đánh thức"). */
export async function wakeDepartment(departmentId: string): Promise<boolean> {
  const c = await getCollections();
  const d = await c.departments.findOne({ _id: departmentId });
  if (!d) return false;
  await c.departments.updateOne({ _id: d._id }, { $set: { lastHeartbeatAt: now() } });
  await maybeBeat(d, { ...DEFAULT_HEARTBEAT, ...d.heartbeat, skipWhenNoWork: false, maxDailyRuns: 0, maxDailyCostUsd: 0 });
  return true;
}

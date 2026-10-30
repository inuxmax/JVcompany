import { getCollections, now } from '@/lib/server/db';
import { emit } from '@/lib/server/bus';
import { cancelTask } from '@/lib/server/agent/orchestrator';
import { logActivity } from '@/lib/server/activity';
import { type Ctx, fail, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

/** Quyết định với cảnh báo lượt chạy im lặng: continue (30 phút), snooze (tới giờ chọn), dismiss (bỏ qua hẳn), cancel (dừng nhiệm vụ). */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { action, minutes } = await readJson<{ action?: 'continue' | 'snooze' | 'dismiss' | 'cancel'; minutes?: number }>(req);
  const c = await getCollections();
  const run = await c.runs.findOne({ _id: id });
  if (!run) return fail(m('Không tìm thấy lượt chạy'), 404);
  if (action === 'cancel') {
    await cancelTask(run.taskId, 'Bạn dừng lượt chạy im lặng quá lâu');
  } else if (action === 'continue' || action === 'snooze' || action === 'dismiss') {
    const until = action === 'dismiss' ? null : new Date(Date.now() + (action === 'continue' ? 30 : Math.max(5, Number(minutes) || 60)) * 60_000).toISOString();
    await c.runs.updateOne({ _id: id }, { $set: { watchdog: { decision: action === 'dismiss' ? 'dismissed' : action, until, at: now() } } });
  } else return fail(m('Hành động không hợp lệ'));
  await logActivity({ action: `run.watchdog_${action}`, entityType: 'run', entityId: id, projectId: run.projectId, summary: `Canh chừng lượt chạy: ${action}` });
  await emit('run.updated', run.projectId, { id });
  return ok({ ok: true });
});

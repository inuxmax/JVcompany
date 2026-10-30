import { getProject } from '@/lib/server/repo';
import { logActivity } from '@/lib/server/activity';
import {
  advancePhase,
  cancelProject,
  pauseProject,
  restartPhase,
  resumeProject,
  startProject,
  stopProject,
  userApprovePhase,
  userRejectPhase,
} from '@/lib/server/agent/orchestrator';
import { type Ctx, fail, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

const ACTION_LABEL: Record<string, string> = {"start": "Khởi động", "pause": "Tạm dừng", "stop": "Dừng", "resume": "Tiếp tục", "approve_phase": "Duyệt giai đoạn", "reject_phase": "Yêu cầu làm lại giai đoạn", "advance": "Chuyển giai đoạn", "restart_phase": "Làm lại giai đoạn", "cancel": "Huỷ"};

export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { action, notes, floorId } = await readJson<{ action?: string; notes?: string; floorId?: string }>(req);
  if (!(await getProject(id))) return fail(m('Không tìm thấy dự án'), 404);
  switch (action) {
    case 'start':
      await startProject(id, floorId);
      break;
    case 'pause':
      await pauseProject(id);
      break;
    case 'stop':
      await stopProject(id);
      break;
    case 'resume':
      await resumeProject(id, floorId);
      break;
    case 'approve_phase':
      await userApprovePhase(id, notes ?? '');
      break;
    case 'reject_phase':
      await userRejectPhase(id, notes ?? '');
      break;
    case 'advance':
      await advancePhase(id);
      break;
    case 'restart_phase':
      await restartPhase(id);
      break;
    case 'cancel':
      await cancelProject(id);
      break;
    default:
      return fail(m('Hành động không hợp lệ: {action}'), 400, { action: String(action) });
  }
  const p = await getProject(id);
  await logActivity({ action: `project.${action}`, entityType: 'project', entityId: id, projectId: id, summary: `${ACTION_LABEL[action] ?? action} dự án "${p?.name ?? id}"${notes ? ` – ${notes.slice(0, 120)}` : ''}` });
  return ok(p);
});

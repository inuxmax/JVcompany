import { childrenOf, getDepartment, getProject, getTask, listMessages, updateTask } from '@/lib/server/repo';
import { cancelTask, retryTask } from '@/lib/server/agent/orchestrator';
import { permissionBreakdown, submitManualResponse } from '@/lib/server/agent/runner';
import { wakeWorker } from '@/lib/server/bus';
import { type Ctx, fail, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';
import { answerTaskQuestion, commentOnTask, decideReview, makeStages } from '@/lib/server/governance';
import type { TaskPriority } from '@/lib/types';
import { actorName } from '@/lib/server/auth';
import { TERMINAL_TASK_STATUSES } from '@/lib/catalog';

export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const task = await getTask(id);
  if (!task) return fail(m('Không tìm thấy nhiệm vụ'), 404);
  const [messages, children, project, dept] = await Promise.all([listMessages(task.projectId, { taskId: id, limit: 1000 }), childrenOf(id), getProject(task.projectId), getDepartment(task.departmentId)]);
  // Quyền thực tế + nguồn giới hạn (dự án / phòng / nhiệm vụ / giám đốc điều phối)
  const permission = project && dept ? permissionBreakdown(project, dept, task) : null;
  return ok({ task, messages, children, permission });
});

export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson<{
    action?: string;
    content?: string;
    departmentId?: string;
    priority?: TaskPriority;
    decision?: 'approve' | 'changes';
    labels?: string[];
    reviewers?: string[];
    goalId?: string | null;
  }>(req);
  const task = await getTask(id);
  if (!task) return fail(m('Không tìm thấy nhiệm vụ'), 404);
  switch (body.action) {
    case 'cancel':
      await cancelTask(id);
      break;
    case 'retry':
      await retryTask(id);
      break;
    case 'run_now':
      if (task.status === 'waiting_limit') await updateTask(id, { retryAt: new Date().toISOString() });
      wakeWorker();
      break;
    case 'manual_response': {
      if (!body.content?.trim()) return fail(m('Hãy dán câu trả lời'));
      const r = await submitManualResponse(id, body.content);
      if (!r.ok) return fail(r.message);
      break;
    }
    case 'reassign': {
      if (!body.departmentId || !(await getDepartment(body.departmentId))) return fail(m('Phòng ban không hợp lệ'));
      if (!TERMINAL_TASK_STATUSES.includes(task.status) && task.status !== 'queued' && task.status !== 'waiting_limit' && task.status !== 'waiting_human') {
        return fail(m('Chỉ đổi phòng khi nhiệm vụ chưa chạy hoặc đã kết thúc'));
      }
      await updateTask(id, { departmentId: body.departmentId, status: 'queued', error: null, retryAt: null, attempts: 0, sessionId: null, manualPrompt: null });
      wakeWorker();
      break;
    }
    case 'priority':
      if (body.priority) await updateTask(id, { priority: body.priority });
      break;
    // Trả lời câu hỏi agent đặt ra → nhiệm vụ chạy tiếp
    case 'answer': {
      if (!body.content?.trim()) return fail(m('Nhập câu trả lời'));
      await answerTaskQuestion(id, body.content.trim());
      wakeWorker();
      break;
    }
    // Bạn duyệt bước "chờ duyệt": approve / changes (kèm góp ý)
    case 'review': {
      if (task.status !== 'in_review') return fail(m('Nhiệm vụ không ở trạng thái chờ duyệt'));
      const stage = task.reviewStages?.find((s) => s.status === 'pending');
      if (stage?.reviewer !== 'user') return fail(m('Bước duyệt hiện tại không phải của bạn'));
      await decideReview(id, body.decision === 'changes' ? 'changes' : 'approve', body.content?.trim() ?? '', 'user');
      wakeWorker();
      break;
    }
    // Bình luận: ghi vào nhiệm vụ; việc đã xong thì mở lại để phòng làm tiếp theo bình luận
    case 'comment': {
      if (!body.content?.trim()) return fail(m('Nhập bình luận'));
      await commentOnTask(id, body.content, { authorName: await actorName() });
      break;
    }
    case 'labels':
      await updateTask(id, { labels: (body.labels ?? []).map((l) => l.trim()).filter(Boolean).slice(0, 10) });
      break;
    case 'goal':
      await updateTask(id, { goalId: body.goalId ?? null });
      break;
    // Đặt chuỗi người duyệt ("user" = bạn, hoặc id phòng)
    case 'reviewers':
      await updateTask(id, { reviewStages: makeStages(body.reviewers ?? []) });
      break;
    default:
      return fail(m('Hành động không hợp lệ'));
  }
  return ok(await getTask(id));
});

// Quản trị: tuyển nhân sự (có thể cần bạn duyệt), agent xin ý kiến bạn, duyệt nhiều bước, xử lý phê duyệt.
import type { Approval, Department, ReviewStage, Task } from '../types';
import { now } from './db';
import { emit } from './bus';
import { logActivity } from './activity';
import { createApproval, createDepartment, createTask, getDepartment, getTask, postMessage, updateDepartment, updateTask } from './repo';
import { getCompany } from './company';
import { resolveIncident } from './budgets';
import { noteContent, sysMsg } from '../i18n/format';

type HireSpec = { name: string; title: string; role: string; description: string; reportsTo?: string; responsibilities?: string[] };

/** Agent đề nghị tuyển nhân sự mới. Công ty bắt buộc duyệt → tạo phòng ở trạng thái chờ duyệt + thẻ phê duyệt. */
export async function hireAgent(spec: HireSpec, by: { task: Task; department: Department }): Promise<{ department: Department; approval: Approval | null }> {
  const company = await getCompany();
  const needApproval = company?.requireApprovalForNewAgents ?? false;
  const dept = await createDepartment({
    name: spec.name,
    title: spec.title || 'Chuyên viên',
    description: spec.description,
    role: spec.role || 'general',
    responsibilities: spec.responsibilities ?? [],
    reportsTo: spec.reportsTo && (await getDepartment(spec.reportsTo)) ? spec.reportsTo : by.department._id,
    systemPrompt: `# Vai trò\nBạn là ${spec.title || 'chuyên viên'} – ${spec.name} của công ty.\n\n# Nhiệm vụ\n${spec.description}\n${(spec.responsibilities ?? []).map((r) => `- ${r}`).join('\n')}`,
    enabled: !needApproval,
    status: needApproval ? 'pending_approval' : 'active',
    preferredProviderTypes: by.department.preferredProviderTypes,
    tier: 'balanced',
    maxPermission: 'write',
  });
  // Người tuyển được giao việc cho nhân sự mới
  await updateDepartment(by.department._id, { canDelegateTo: Array.from(new Set([...(by.department.canDelegateTo ?? []), dept._id])) }, { by: by.department.name });
  let approval: Approval | null = null;
  if (needApproval) {
    approval = await createApproval({
      projectId: by.task.projectId,
      taskId: by.task._id,
      departmentId: by.department._id,
      type: 'hire_agent',
      ...(spec.title
        ? { title: `Tuyển ${spec.name} (${spec.title})`, titleI18n: { key: 'Tuyển {name} ({title})', vars: { name: spec.name, title: spec.title } } }
        : { title: `Tuyển ${spec.name} (chuyên viên)`, titleI18n: { key: 'Tuyển {name} (chuyên viên)', vars: { name: spec.name } } }),
      detail: spec.description,
      payload: { departmentId: dept._id, requestedBy: by.department._id, spec },
    });
  }
  await logActivity({
    actorType: 'agent',
    actorId: by.department._id,
    actorName: by.department.name,
    action: needApproval ? 'agent.hire_requested' : 'agent.hired',
    entityType: 'department',
    entityId: dept._id,
    projectId: by.task.projectId,
    summary: `${by.department.name} ${needApproval ? 'đề nghị tuyển' : 'đã tuyển'} ${spec.name}`,
  });
  await postMessage({
    projectId: by.task.projectId,
    taskId: by.task._id,
    author: { type: 'system' },
    kind: 'system',
    ...noteContent(
      needApproval
        ? sysMsg('🧑‍💼 {dept} đề nghị tuyển **{name}** – chờ bạn duyệt ở mục Phê duyệt.', { dept: by.department.name, name: spec.name })
        : sysMsg('🧑‍💼 {dept} đã tuyển **{name}** ({title}).', { dept: by.department.name, name: spec.name, title: spec.title }),
    ),
  });
  return { department: dept, approval };
}

/** Agent xin ý kiến chủ công ty (không chặn việc đang làm). */
export async function boardRequest(req: { title: string; detail: string }, by: { task: Task; department: Department }): Promise<Approval> {
  const a = await createApproval({
    projectId: by.task.projectId,
    taskId: by.task._id,
    departmentId: by.department._id,
    type: 'board_request',
    title: req.title,
    detail: req.detail,
    payload: { requestedBy: by.department._id },
  });
  await logActivity({ actorType: 'agent', actorId: by.department._id, actorName: by.department.name, action: 'approval.created', entityType: 'approval', entityId: a._id, projectId: by.task.projectId, summary: `${by.department.name} xin ý kiến: ${req.title}` });
  return a;
}

/** Sau khi bạn duyệt / từ chối các loại phê duyệt quản trị. */
export async function onGovernanceResolved(a: Approval, decision: 'approve' | 'deny', note: string, extra: { amountUsd?: number } = {}): Promise<void> {
  const p = a.payload as Record<string, unknown>;
  if (a.type === 'hire_agent') {
    const id = String(p.departmentId ?? '');
    const dept = id ? await getDepartment(id) : null;
    if (dept) {
      if (decision === 'approve') await updateDepartment(id, { status: 'active', enabled: true }, { by: 'Bạn' });
      else await updateDepartment(id, { status: 'terminated', enabled: false }, { by: 'Bạn' });
    }
    await logActivity({ action: decision === 'approve' ? 'agent.hire_approved' : 'agent.hire_rejected', entityType: 'department', entityId: id, projectId: a.projectId || null, summary: `${decision === 'approve' ? 'Duyệt' : 'Từ chối'} tuyển ${dept?.name ?? id}` });
    await wakeRequester(a, decision === 'approve' ? `Chủ công ty đã DUYỆT tuyển ${dept?.name ?? id}. Bạn có thể giao việc cho phòng này (id: ${id}).` : `Chủ công ty đã TỪ CHỐI tuyển ${dept?.name ?? id}.`, note);
  } else if (a.type === 'budget_override') {
    const incidentId = String(p.incidentId ?? '');
    if (incidentId) {
      if (decision === 'approve') await resolveIncident(incidentId, 'raise_and_resume', extra.amountUsd ?? Number(p.suggestedAmount ?? 0));
      else await resolveIncident(incidentId, 'keep_paused');
    }
  } else if (a.type === 'board_request') {
    await logActivity({ action: decision === 'approve' ? 'approval.approved' : 'approval.rejected', entityType: 'approval', entityId: a._id, projectId: a.projectId || null, summary: `${decision === 'approve' ? 'Đồng ý' : 'Không đồng ý'}: ${a.title}` });
    // Đề nghị "xin quyền": đồng ý KHÔNG tự đổi quyền chạy → nói rõ để khỏi vòng lặp xin quyền mãi
    const aboutPermission = /quy[eề]n|permission|shell|ch[aạ]y l[eệ]nh|sandbox|approval/i.test(`${a.title} ${a.detail}`);
    const hint = aboutPermission
      ? '\n(Lưu ý: đồng ý đề nghị không thay đổi quyền chạy của bạn. Cứ chạy lệnh / ghi tệp như bình thường – nếu vượt quyền, hệ thống tự tạo thẻ phê duyệt; quyền của dự án được nâng ở chi tiết nhiệm vụ → "Quyền khi chạy".)'
      : '';
    await wakeRequester(a, `Chủ công ty ${decision === 'approve' ? 'ĐỒNG Ý' : 'KHÔNG đồng ý'} với đề nghị "${a.title}".${hint}`, note);
    if (aboutPermission && decision === 'approve' && a.projectId) {
      await postMessage({ projectId: a.projectId, taskId: a.taskId || null, author: { type: 'system' }, kind: 'system', ...noteContent(sysMsg('ℹ️ Đồng ý đề nghị không tự nâng quyền chạy của agent. Để cho chạy lệnh không cần hỏi: mở nhiệm vụ → "Quyền khi chạy" → nâng quyền dự án lên "Tự động trong dự án". Ở mức "Đọc & ghi", mỗi lệnh sẽ tạo thẻ phê duyệt trong Hộp thư.')) });
    }
  }
}

/** Đánh thức phòng đã gửi đề nghị: tạo một việc trực tiếp kèm quyết định của bạn. */
async function wakeRequester(a: Approval, text: string, note: string): Promise<void> {
  if (!a.projectId || !a.departmentId) return;
  const content = `${text}${note ? `\nGhi chú của chủ công ty: ${note}` : ''}`;
  await postMessage({ projectId: a.projectId, taskId: a.taskId || null, author: { type: 'user', name: 'Bạn' }, to: a.departmentId, kind: 'chat', content });
  await createTask({
    projectId: a.projectId,
    kind: 'chat',
    title: `Phản hồi: ${a.title}`.slice(0, 90),
    instructions: `${content}\n\nTiếp tục công việc theo quyết định này.`,
    departmentId: a.departmentId,
    assignedBy: 'user',
    phase: '',
    adhoc: true,
    waitForChildren: false,
    wakeReason: a.type === 'hire_agent' ? 'approval_resolved' : 'board_request_resolved',
  });
  await emit('task.updated', a.projectId, {});
}

// ---------------- Duyệt nhiều bước ----------------

/** Chuỗi người duyệt cho nhiệm vụ: "user" (bạn) hoặc id phòng ban. */
export function makeStages(reviewers: string[]): ReviewStage[] {
  return reviewers.filter(Boolean).map((r, i) => ({ id: `s${i + 1}`, type: r === 'user' ? 'approval' : 'review', reviewer: r, status: 'waiting' }));
}

/** Nhiệm vụ làm xong nhưng còn bước duyệt → chuyển sang "Chờ duyệt" và mở bước đầu tiên. Trả về true nếu đã chuyển. */
export async function enterReview(task: Task): Promise<boolean> {
  const stages = task.reviewStages ?? [];
  const next = stages.find((s) => s.status !== 'approved');
  if (!next) return false;
  const updated = stages.map((s) => (s.id === next.id ? { ...s, status: 'pending' as const } : s));
  await updateTask(task._id, { status: 'in_review', reviewStages: updated });
  if (next.reviewer === 'user') {
    await postMessage({ projectId: task.projectId, taskId: task._id, author: { type: 'system' }, kind: 'system', ...noteContent(sysMsg('🔎 Nhiệm vụ **{id} {title}** đã xong – chờ bạn duyệt (Duyệt / Yêu cầu sửa trong chi tiết nhiệm vụ).', { id: task.identifier ?? '', title: task.title })) });
  } else {
    // Phòng duyệt nhận một việc duyệt; kết luận approve/reject quyết định bước này
    await createTask({
      projectId: task.projectId,
      parentId: task._id,
      depth: task.depth + 1,
      kind: 'review',
      title: `Duyệt: ${task.title}`.slice(0, 90),
      instructions: `Duyệt kết quả của nhiệm vụ ${task.identifier ?? ''} "${task.title}".\n\nKết quả cần duyệt:\n${(task.result ?? '').slice(0, 6000)}\n\nKết luận bằng "decision": "approve" (đạt) hoặc "reject" (cần sửa, nêu rõ cần sửa gì trong summary).`,
      departmentId: next.reviewer,
      assignedBy: task.departmentId,
      phase: task.phase,
      adhoc: task.adhoc,
      waitForChildren: false,
      wakeReason: 'review_requested',
    });
  }
  return true;
}

/** Quyết định một bước duyệt: duyệt → bước sau (hoặc xong hẳn); yêu cầu sửa → giao lại người làm kèm góp ý. */
export async function decideReview(taskId: string, decision: 'approve' | 'changes', note: string, by: string): Promise<Task | null> {
  const task = await getTask(taskId);
  if (!task || task.status !== 'in_review') return task;
  const stages = task.reviewStages ?? [];
  const cur = stages.find((s) => s.status === 'pending');
  if (!cur) return task;
  const decidedAt = now();
  if (decision === 'approve') {
    const updated = stages.map((s) => (s.id === cur.id ? { ...s, status: 'approved' as const, note, decidedAt } : s));
    await updateTask(taskId, { reviewStages: updated });
    await postMessage({ projectId: task.projectId, taskId, author: by === 'user' ? { type: 'user', name: 'Bạn' } : { type: 'system' }, kind: 'approval', content: `✅ ${by === 'user' ? 'Bạn' : by} duyệt bước ${cur.id}${note ? ` – ${note}` : ''}` });
    const fresh = (await getTask(taskId))!;
    if (await enterReview(fresh)) return getTask(taskId);
    await updateTask(taskId, { status: 'done', finishedAt: decidedAt });
    const { onTaskSettled } = await import('./agent/orchestrator');
    await onTaskSettled(taskId);
  } else {
    // Yêu cầu sửa: quay lại bước này khi nộp lại
    const updated = stages.map((s) => (s.id === cur.id ? { ...s, status: 'changes_requested' as const, note, decidedAt } : s));
    await updateTask(taskId, {
      status: 'queued',
      reviewStages: updated.map((s) => (s.status === 'changes_requested' ? { ...s, status: 'waiting' as const } : s)),
      round: task.round + 1,
      instructions: `${task.instructions}\n\n# YÊU CẦU SỬA (${by === 'user' ? 'chủ công ty' : by})\n${note || 'Cần làm lại cho đạt.'}`,
      wakeReason: 'changes_requested',
      finishedAt: null,
    });
    await postMessage({ projectId: task.projectId, taskId, author: by === 'user' ? { type: 'user', name: 'Bạn' } : { type: 'system' }, kind: 'approval', content: `↩️ Yêu cầu sửa${note ? `: ${note}` : ''}` });
  }
  await logActivity({ actorType: by === 'user' ? 'user' : 'agent', action: decision === 'approve' ? 'task.review_approved' : 'task.changes_requested', entityType: 'task', entityId: taskId, projectId: task.projectId, summary: `${decision === 'approve' ? 'Duyệt' : 'Yêu cầu sửa'} ${task.identifier ?? ''} ${task.title}` });
  return getTask(taskId);
}

/** Việc duyệt của một phòng xong → áp kết luận vào bước duyệt của nhiệm vụ cha. */
export async function onReviewTaskDone(reviewTask: Task): Promise<void> {
  if (reviewTask.kind !== 'review' || !reviewTask.parentId) return;
  const parent = await getTask(reviewTask.parentId);
  if (!parent || parent.status !== 'in_review') return;
  const cur = parent.reviewStages?.find((s) => s.status === 'pending');
  if (!cur || cur.reviewer !== reviewTask.departmentId) return;
  const dept = await getDepartment(reviewTask.departmentId);
  await decideReview(parent._id, reviewTask.decision === 'reject' ? 'changes' : 'approve', reviewTask.result ?? '', dept?.name ?? reviewTask.departmentId);
}

/** Câu hỏi agent hỏi bạn đã được trả lời → nhiệm vụ chạy tiếp với câu trả lời. */
export async function answerTaskQuestion(taskId: string, answer: string): Promise<Task | null> {
  const task = await getTask(taskId);
  if (!task || task.status !== 'waiting_human' || !task.question) return task;
  await postMessage({ projectId: task.projectId, taskId, author: { type: 'user', name: 'Bạn' }, to: task.departmentId, kind: 'chat', content: answer });
  await updateTask(taskId, {
    status: 'queued',
    question: null,
    round: task.round + 1,
    instructions: `${task.instructions}\n\n# CÂU TRẢ LỜI CỦA CHỦ CÔNG TY\nCâu hỏi: ${task.question.prompt}\nTrả lời: ${answer}`,
    wakeReason: 'question_answered',
  });
  await logActivity({ action: 'task.question_answered', entityType: 'task', entityId: taskId, projectId: task.projectId, summary: `Trả lời câu hỏi của ${task.identifier ?? ''}: ${answer.slice(0, 80)}` });
  return getTask(taskId);
}


/**
 * Bình luận của chủ công ty vào một nhiệm vụ: ghi vào nhật ký nhiệm vụ; việc đã xong / lỗi / huỷ thì mở lại để phòng phụ trách làm tiếp.
 * Dùng chung cho bình luận trực tiếp và bình luận trên tài liệu của nhiệm vụ.
 */
export async function commentOnTask(taskId: string, content: string, opts: { authorName?: string; wakeReason?: string; heading?: string } = {}): Promise<Task | null> {
  const task = await getTask(taskId);
  const text = content.trim();
  if (!task || !text) return task;
  await postMessage({ projectId: task.projectId, taskId, author: { type: 'user', name: opts.authorName ?? 'Bạn' }, to: task.departmentId, kind: 'chat', content: text });
  if (['done', 'failed', 'cancelled'].includes(task.status)) {
    await updateTask(taskId, {
      status: 'queued',
      round: task.round + 1,
      error: null,
      finishedAt: null,
      instructions: `${task.instructions}\n\n# ${opts.heading ?? 'BÌNH LUẬN MỚI CỦA CHỦ CÔNG TY'}\n${text}`,
      wakeReason: opts.wakeReason ?? 'comment',
    });
    const { wakeWorker } = await import('./bus');
    wakeWorker();
  }
  await logActivity({ actorName: opts.authorName, action: 'task.comment_added', entityType: 'task', entityId: taskId, projectId: task.projectId, summary: `Bình luận ${task.identifier ?? ''}: ${text.slice(0, 80)}` });
  return getTask(taskId);
}

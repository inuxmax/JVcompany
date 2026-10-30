// Điều phối quy trình: giai đoạn → phòng chủ trì → giao việc → phê duyệt → chuyển giai đoạn.
import type { Attachment, Department, Project, Task, WorkflowPhase } from '../../types';
import { ACTIVE_TASK_STATUSES, DIRECTOR_WORKFLOW_ID, PERMISSION_LEVELS, TERMINAL_TASK_STATUSES } from '../../catalog';
import {
  childrenOf,
  createTask,
  getProject,
  getTask,
  getWorkflow,
  listDepartments,
  listMessages,
  listTasks,
  postMessage,
  updateProject,
  updateTask,
} from '../repo';
import { emit, wakeWorker } from '../bus';
import { currentCompanyId, getCollections, now } from '../db';
import { abortRunning } from './control';
import { sysMsg } from '../../i18n/format';

const isTerminal = (t: Task) => TERMINAL_TASK_STATUSES.includes(t.status);

/** Ghi chú do hệ thống viết: tạo bằng sysMsg() để giao diện dịch theo ngôn ngữ người xem (nội dung lưu bằng tiếng Việt gốc). */
type Note = string | ReturnType<typeof sysMsg>;

function noteFields(note: Note, meta?: Record<string, unknown>) {
  if (typeof note === 'string') return { content: note, meta };
  return { content: note.content, meta: { ...meta, i18n: note.i18n } };
}

async function systemNote(projectId: string, note: Note, meta?: Record<string, unknown>) {
  await postMessage({ projectId, taskId: null, author: { type: 'system' }, kind: 'system', ...noteFields(note, meta) });
}

/** CEO tổng lên tiếng (giao tầng, xếp hàng) – hiện như một tin nhắn trong hội thoại. */
async function ceoNote(projectId: string, note: Note, meta?: Record<string, unknown>) {
  await postMessage({ projectId, taskId: null, author: { type: 'agent', name: 'CEO tổng', role: 'ceo' }, kind: 'chat', ...noteFields(note, meta) });
}

async function phaseOf(project: Project, phaseId = project.currentPhase): Promise<{ phase: WorkflowPhase; index: number; phases: WorkflowPhase[] }> {
  const wf = await getWorkflow(project.workflowId);
  const index = Math.max(0, wf.phases.findIndex((p) => p.id === phaseId));
  return { phase: wf.phases[index], index, phases: wf.phases };
}

// ---------------- Vòng đời nhiệm vụ ----------------

/** Chuỗi bàn giao: việc đang chờ phòng này sẽ chạy khi mọi phòng trước đã xong (lỗi/huỷ thì dừng chuỗi để phòng chủ trì xử lý). */
async function releaseHandoffs(task: Task): Promise<void> {
  const waiting = await listTasks({ dependsOn: task._id, status: 'waiting_deps' });
  if (!waiting.length) return;
  const depts = await listDepartments();
  const name = (id: string) => depts.find((d) => d._id === id)?.name ?? id;
  for (const w of waiting) {
    const deps = await listTasks({ _id: { $in: w.dependsOn ?? [] } });
    if (!deps.every(isTerminal)) continue;
    const broken = deps.filter((d) => d.status !== 'done');
    if (broken.length) {
      await updateTask(w._id, {
        status: 'cancelled',
        error: `Chưa nhận được bàn giao: ${broken.map((b) => `${name(b.departmentId)} – ${b.title}`).join('; ')} chưa hoàn thành.`,
        finishedAt: new Date().toISOString(),
      });
      await onTaskSettled(w._id);
    } else {
      await updateTask(w._id, { status: 'queued' });
      await systemNote(
        w.projectId,
        sysMsg('🔁 {from} bàn giao cho **{to}**: {title}', { from: Array.from(new Set(deps.map((d) => name(d.departmentId)))).join(', '), to: name(w.departmentId), title: w.title }),
      );
      wakeWorker();
    }
  }
}

export async function onTaskSettled(taskId: string): Promise<void> {
  const task = await getTask(taskId);
  if (!task || !isTerminal(task)) return;

  // 0) Mở khoá các bước đang chờ bàn giao từ việc này.
  await releaseHandoffs(task);

  // 1) Báo cho nhiệm vụ cha khi mọi việc con đã xong → cha tổng hợp ở lượt tiếp theo.
  if (task.parentId) {
    const parent = await getTask(task.parentId);
    if (parent && parent.status === 'waiting_children') {
      const kids = await childrenOf(parent._id);
      if (kids.every(isTerminal)) {
        await updateTask(parent._id, { status: 'queued', round: parent.round + 1 });
        const depts = await listDepartments();
        const name = depts.find((d) => d._id === parent.departmentId)?.name ?? parent.departmentId;
        await systemNote(task.projectId, sysMsg('Các phòng đã hoàn thành việc được giao. {dept} đang tổng hợp kết quả "{title}".', { dept: name, title: parent.title }));
        wakeWorker();
      }
    }
  }

  const project = await getProject(task.projectId);
  if (!project || task.adhoc) return;

  // 2) Nhiệm vụ chủ trì giai đoạn hoàn tất → chuyển sang duyệt.
  if (task.kind === 'phase' && task.phase === project.currentPhase && project.phaseTaskId === task._id) {
    // Chế độ giao cho giám đốc: giám đốc trả lời mà chưa giao việc cho phòng nào → không tự hoàn tất, chờ bạn quyết định.
    if (task.status === 'done' && project.workflowId === DIRECTOR_WORKFLOW_ID && !(await childrenOf(task._id)).length) {
      await updateProject(project._id, { phaseSummaries: { ...project.phaseSummaries, [task.phase]: task.result ?? '' }, phaseState: 'awaiting_user' });
      await systemNote(
        project._id,
        sysMsg('⚠️ Giám đốc đã trả lời nhưng chưa giao việc cho phòng nào. Nếu câu trả lời đã đủ, bấm "Hoàn tất dự án"; nếu chưa, nhắn giám đốc hoặc bấm "Chạy lại giai đoạn".'),
      );
      return;
    }
    if (task.status === 'done') await onPhaseWorkDone(project, task);
    else if (task.status === 'failed') {
      await updateProject(project._id, { status: 'blocked', blockedReason: `Nhiệm vụ giai đoạn lỗi: ${task.error ?? ''}`.slice(0, 500) });
      await systemNote(project._id, sysMsg('⚠️ Giai đoạn bị chặn vì nhiệm vụ chủ trì lỗi. Sửa cấu hình rồi bấm "Chạy lại" trên nhiệm vụ.'));
    }
    return;
  }

  // 3) Nhiệm vụ duyệt hoàn tất → ghi nhận quyết định.
  if (task.kind === 'review' && task.phase === project.currentPhase) {
    if (task.status === 'done') {
      const decision = task.decision ?? inferDecision(task.result ?? '');
      await recordApproval(project._id, task.departmentId, decision, task.result ?? '', task.departmentId);
      await evaluateApprovals(project._id);
    } else if (task.status === 'failed') {
      await updateProject(project._id, { status: 'blocked', blockedReason: `Nhiệm vụ duyệt lỗi: ${task.error ?? ''}`.slice(0, 500) });
    }
  }
}

function inferDecision(text: string): 'approve' | 'reject' {
  return /\b(reject|từ chối|không đạt|chưa đạt|không duyệt)\b/i.test(text) ? 'reject' : 'approve';
}

async function recordApproval(projectId: string, deptId: string, decision: 'approve' | 'reject', notes: string, by: string) {
  const project = await getProject(projectId);
  if (!project) return;
  await updateProject(projectId, {
    approvals: { ...project.approvals, [deptId]: { decision, notes: notes.slice(0, 4000), at: new Date().toISOString(), by } },
  });
}

async function onPhaseWorkDone(project: Project, phaseTask: Task) {
  const { phase } = await phaseOf(project);
  const depts = await listDepartments();
  const enabled = new Set(depts.filter((d) => d.enabled).map((d) => d._id));
  await updateProject(project._id, {
    phaseSummaries: { ...project.phaseSummaries, [phase.id]: phaseTask.result ?? '' },
    phaseState: 'reviewing',
  });
  const approvers = phase.requiredApprovals.filter((id) => enabled.has(id));
  if (approvers.includes(phaseTask.departmentId) && phaseTask.decision) {
    await recordApproval(project._id, phaseTask.departmentId, phaseTask.decision, phaseTask.result ?? '', phaseTask.departmentId);
  }
  const fresh = (await getProject(project._id))!;
  const remaining = approvers.filter((id) => !fresh.approvals[id]);
  for (const deptId of remaining) {
    await createTask({
      projectId: project._id,
      kind: 'review',
      title: `Duyệt giai đoạn ${phase.name}`,
      instructions: `Xét duyệt kết quả giai đoạn "${phase.name}" của dự án.

## Đầu ra kỳ vọng
${phase.outputs.map((o) => `- ${o}`).join('\n')}

## Báo cáo của phòng chủ trì
${(phaseTask.result ?? '').slice(0, 6000)}

Kiểm tra tài liệu dự án, tệp trong thư mục (nếu có) và đối chiếu với mục tiêu. Đưa ra quyết định approve/reject kèm lý do; nếu reject, liệt kê cụ thể những gì phải sửa.`,
      departmentId: deptId,
      assignedBy: 'system',
      phase: phase.id,
      priority: 'high',
      waitForChildren: false,
    });
  }
  if (remaining.length) {
    const names = remaining.map((id) => depts.find((d) => d._id === id)?.name ?? id).join(', ');
    await systemNote(project._id, sysMsg('Giai đoạn **{phase}** đã xong phần thực hiện. Chờ phê duyệt từ: {names}.', { phase: phase.name, names }));
    wakeWorker();
  } else {
    await evaluateApprovals(project._id);
  }
}

async function evaluateApprovals(projectId: string) {
  const project = await getProject(projectId);
  if (!project) return;
  const { phase } = await phaseOf(project);
  const depts = await listDepartments();
  const enabled = new Set(depts.filter((d) => d.enabled).map((d) => d._id));
  const approvers = phase.requiredApprovals.filter((id) => enabled.has(id));
  if (approvers.some((id) => !project.approvals[id])) return;
  const rejects = approvers.filter((id) => project.approvals[id]?.decision === 'reject');
  if (rejects.length) {
    const feedback = rejects
      .map((id) => `### ${depts.find((d) => d._id === id)?.name ?? id}\n${project.approvals[id].notes}`)
      .join('\n\n');
    await phaseRejected(project, feedback, false);
  } else {
    await phasePassed(project);
  }
}

async function phasePassed(project: Project) {
  const { phase } = await phaseOf(project);
  const completed = Array.from(new Set([...project.completedPhases, phase.id]));
  if (project.autopilot) {
    await updateProject(project._id, { completedPhases: completed });
    await systemNote(project._id, sysMsg('✅ Giai đoạn **{phase}** đã được phê duyệt.', { phase: phase.name }));
    await advancePhase(project._id);
  } else {
    const { index, phases } = await phaseOf(project);
    const last = index === phases.length - 1;
    await updateProject(project._id, { completedPhases: completed, phaseState: 'awaiting_user' });
    await systemNote(
      project._id,
      last
        ? sysMsg('✅ Giai đoạn **{phase}** đã đạt. Bấm "Hoàn tất dự án" để kết thúc.', { phase: phase.name })
        : sysMsg('✅ Giai đoạn **{phase}** đã đạt. Bấm "Chuyển giai đoạn" để tiếp tục.', { phase: phase.name }),
    );
  }
}

async function phaseRejected(project: Project, feedback: string, byUser: boolean) {
  const { phase } = await phaseOf(project);
  const attempts = (project.phaseAttempts[phase.id] ?? 0) + 1;
  if (!byUser && attempts > 2) {
    await updateProject(project._id, {
      phaseAttempts: { ...project.phaseAttempts, [phase.id]: attempts },
      status: 'blocked',
      phaseState: 'awaiting_user',
      blockedReason: `Giai đoạn ${phase.name} bị từ chối ${attempts} lần. Cần bạn quyết định.`,
    });
    await systemNote(
      project._id,
      sysMsg('⛔ Giai đoạn **{phase}** bị từ chối nhiều lần. Hãy xem phản hồi và quyết định: duyệt, yêu cầu làm lại, hoặc chỉnh mục tiêu.', { phase: phase.name }),
    );
    return;
  }
  const target = phase.onReject ?? phase.id;
  await updateProject(project._id, {
    phaseAttempts: { ...project.phaseAttempts, [phase.id]: attempts },
    currentPhase: target,
    approvals: {},
  });
  const { phase: targetPhase } = await phaseOf((await getProject(project._id))!, target);
  await systemNote(
    project._id,
    byUser
      ? sysMsg('↩️ Giai đoạn **{phase}** được yêu cầu làm lại. Quay lại **{target}** để sửa.', { phase: phase.name, target: targetPhase.name })
      : sysMsg('↩️ Giai đoạn **{phase}** bị từ chối. Quay lại **{target}** để sửa.', { phase: phase.name, target: targetPhase.name }),
  );
  await kickoffPhase(project._id, feedback);
}

export async function advancePhase(projectId: string) {
  const project = await getProject(projectId);
  if (!project) return;
  const { index, phases, phase } = await phaseOf(project);
  const next = phases[index + 1];
  if (!next) {
    await updateProject(projectId, {
      status: 'completed',
      phaseState: 'done',
      completedAt: new Date().toISOString(),
      completedPhases: Array.from(new Set([...project.completedPhases, phase.id])),
    });
    await systemNote(projectId, sysMsg('🎉 Dự án **{name}** đã hoàn thành toàn bộ quy trình!', { name: project.name }));
    await releaseFloor(projectId);
    return;
  }
  await updateProject(projectId, {
    currentPhase: next.id,
    approvals: {},
    phaseState: 'idle',
    completedPhases: Array.from(new Set([...project.completedPhases, phase.id])),
  });
  await kickoffPhase(projectId);
}

/** Hướng dẫn cho giám đốc tầng ở chế độ "Giao cho giám đốc": họp giao việc theo chuỗi bàn giao, không tự làm việc chuyên môn. */
function directorBrief(lead: Department, depts: Department[]): string {
  const staff = depts.filter((d) => d.enabled && d._id !== lead._id);
  const label = (p: Department['maxPermission']) => PERMISSION_LEVELS.find((x) => x.id === p)?.label ?? p;
  const has = (id: string) => staff.some((d) => d._id === id);
  const example = [
    has('studio') && 'Studio – thiết kế lại trang chủ',
    has('dev') && 'Dev – lập trình theo thiết kế',
    has('tester') && 'Test – kiểm thử',
    has('bugfix') && 'Fix Bug – sửa các lỗi Test báo',
    has('tester') && has('bugfix') && 'Test – kiểm tra lại',
    has('qa') && 'Kiểm Tra & Duyệt – duyệt chất lượng',
  ]
    .filter(Boolean)
    .map((t, i) => `B${i + 1} ${t}${i ? ` (after B${i})` : ''}`)
    .join(' → ');
  return `Bạn là **giám đốc tầng**. CEO (chủ dự án) giao yêu cầu ở trên MỘT LẦN cho bạn – bạn là đầu mối duy nhất và chịu trách nhiệm điều phối đến khi xong.

## Nguyên tắc
- Bạn là người QUẢN LÝ, không phải người làm. Việc chuyên môn (phân tích mã, thiết kế, lập trình, kiểm thử, sửa lỗi, triển khai…) phải GIAO cho đúng phòng. Trong chế độ này bạn chỉ có quyền đọc.
- Mỗi phòng làm ĐÚNG việc của mình rồi BÀN GIAO cho phòng sau. Chỉ gọi những phòng thật sự liên quan.
- Làm đúng PHẠM VI yêu cầu. Ví dụ "phân tích dự án" → chỉ khảo sát và báo cáo (chỉ đọc), KHÔNG sửa mã.
- Cấp đúng QUYỀN cho từng việc (trường "permission"):
  - \`read\` – chỉ đọc: phân tích, khảo sát, review
  - \`write\` – được sửa tệp trong dự án: thiết kế, viết tài liệu, sửa mã
  - \`auto\` – được chạy lệnh trong dự án: cài đặt, build, chạy test
  - \`full\` – toàn quyền máy tính: chỉ khi thật sự cần
- Mỗi việc giao phải rõ: bối cảnh, việc cần làm, đầu ra, tiêu chí hoàn thành.

## Cách làm
0. **Đã có kế hoạch hoặc việc đã làm** (mục "Kế hoạch / kết quả đã có", "TIẾN ĐỘ LẦN TRƯỚC" hoặc hội thoại trước): KHÔNG khảo sát, KHÔNG lập lại kế hoạch. Giao việc NGAY cho các bước còn lại / bị lỗi / bị huỷ theo đúng kế hoạch đó, chỉ điều chỉnh theo yêu cầu mới của CEO. Bỏ qua bước đã xong hoặc đang làm.
1. **Họp giao việc (lượt đầu):** xem nhanh tổng quan (tối đa vài tệp như README, package.json, tài liệu), KHÔNG đọc sâu mã nguồn. Rồi nộp NGAY kế hoạch theo **chuỗi bàn giao**:
   - Mỗi bước giao cho MỘT phòng, có mã bước ("step": "B1", "B2"…).
   - Bước cần kết quả của bước trước thì ghi "after": ["B1"] – phòng sau tự bắt đầu khi phòng trước xong và nhận bàn giao. Các bước độc lập để "after": [] để làm song song.
   - Ví dụ yêu cầu "sửa trang chủ": ${example || 'chia bước theo chuyên môn của các phòng bên dưới'}.
2. **Khi các phòng báo cáo xong** (hệ thống tự gọi lại bạn): đối chiếu với yêu cầu, giao bổ sung nếu còn thiếu (vd còn lỗi thì giao Fix Bug rồi Test kiểm tra lại), rồi viết **báo cáo tổng hợp** cho CEO và lưu thành tài liệu dự án.

## Các phòng (bạn giao được cho mọi phòng)
${staff.map((d) => `- \`${d._id}\` **${d.name}** – ${d.title}: ${d.description} (quyền tối đa: ${label(d.maxPermission)})`).join('\n') || '- (chưa có phòng nào)'}`;
}

const PRIOR_STATUS: Partial<Record<Task['status'], string>> = { done: '✅ xong', failed: '❌ lỗi', cancelled: '⛔ đã huỷ' };

/** Tiến độ các lượt điều phối trước của giai đoạn (kế hoạch nháp bị dừng, việc đã giao và trạng thái) – để giám đốc làm tiếp thay vì làm lại. */
async function priorProgress(project: Project, phaseId: string, depts: Department[]): Promise<string> {
  const name = (id: string) => depts.find((d) => d._id === id)?.name ?? id;
  const parts: string[] = [];
  const prevLead = project.phaseTaskId ? await getTask(project.phaseTaskId) : null;
  if (prevLead && prevLead.phase === phaseId && prevLead.status !== 'done') {
    const notes = (await listMessages(project._id, { taskId: prevLead._id, limit: 40 }))
      .filter((m) => m.kind === 'thought' && m.content.trim() !== '…')
      .slice(-3)
      .map((m) => m.content.trim())
      .join('\n\n');
    if (notes) parts.push(`### Ghi chép của lượt điều phối trước (bị dừng giữa chừng)\n${notes.slice(-4000)}`);
  }
  const work = (await listTasks({ projectId: project._id, kind: 'delegated', phase: phaseId })).slice(-20);
  if (work.length) {
    const line = (t: Task) => {
      const state = PRIOR_STATUS[t.status] ?? '⏳ đang làm / đang chờ';
      const extra = t.status === 'failed' && t.error ? ` (${t.error.slice(0, 160)})` : t.status === 'done' && t.result ? ` – ${t.result.replace(/\s+/g, ' ').slice(0, 200)}` : '';
      return `- ${name(t.departmentId)} – ${t.title}: ${state}${extra}`;
    };
    parts.push(`### Việc đã giao trước đây và trạng thái\n${work.map(line).join('\n')}`);
  }
  return parts.length ? `## TIẾN ĐỘ LẦN TRƯỚC (làm tiếp từ đây)\n${parts.join('\n\n')}` : '';
}

/** Tạo nhiệm vụ chủ trì cho giai đoạn hiện tại. */
export async function kickoffPhase(projectId: string, feedback?: string) {
  const project = await getProject(projectId);
  if (!project) return;
  const { phase } = await phaseOf(project);
  const depts = await listDepartments();
  const lead = depts.find((d) => d._id === phase.lead && d.enabled) ?? depts.find((d) => d.enabled);
  if (!lead) {
    await updateProject(projectId, { status: 'blocked', blockedReason: 'Không có phòng ban nào đang hoạt động.' });
    return;
  }
  const participants = phase.departments
    .filter((id) => id !== lead._id)
    .map((id) => depts.find((d) => d._id === id))
    .filter((d): d is NonNullable<typeof d> => Boolean(d?.enabled));
  const directorMode = project.workflowId === DIRECTOR_WORKFLOW_ID;
  // Yêu cầu bạn nhắn tiếp sau khi dự án đã xong / đã dừng (xem continueWithDirector)
  const request = directorMode ? project.pendingRequest : null;
  const prior = directorMode ? await priorProgress(project, phase.id, depts) : '';
  const instructions = directorMode
    ? [
        directorBrief(lead, depts),
        request && `## 📩 YÊU CẦU TIẾP THEO CỦA CEO (xử lý ngay)\n${request.content.slice(0, 6000)}`,
        prior,
        feedback && `## ⚠️ PHẢN HỒI CẦN XỬ LÝ\n${feedback.slice(0, 6000)}`,
      ]
        .filter(Boolean)
        .join('\n\n')
    : `Bạn chủ trì giai đoạn **${phase.name}** của dự án.

## Mục tiêu giai đoạn
${phase.description}

## Đầu ra bắt buộc
${phase.outputs.map((o) => `- ${o}`).join('\n')}

## Phòng tham gia
${participants.length ? participants.map((d) => `- \`${d._id}\` ${d.name}: ${d.title}`).join('\n') : '- (chỉ mình bạn)'}

## Hướng dẫn
- Tự thực hiện phần thuộc chuyên môn của bạn; giao việc cho phòng tham gia những phần thuộc chuyên môn của họ (nếu cần).
- Lưu mỗi đầu ra quan trọng thành tài liệu dự án (artifact).
- Khi có báo cáo từ các phòng, tổng hợp thành kết quả giai đoạn hoàn chỉnh.${
    feedback
      ? `

## ⚠️ PHẢN HỒI CẦN XỬ LÝ (lần trước bị từ chối)
${feedback.slice(0, 6000)}`
      : ''
  }`;
  const firstLine = request?.content.split('\n').find((l) => l.trim())?.trim().slice(0, 80);
  const task = await createTask({
    projectId,
    kind: 'phase',
    title: firstLine ? `Tiếp tục: ${firstLine}` : `${phase.name}: ${project.name}`,
    instructions,
    departmentId: lead._id,
    assignedBy: 'system',
    phase: phase.id,
    priority: 'high',
    waitForChildren: true,
    attachments: request?.attachments.length ? request.attachments : project.attachments,
  });
  await updateProject(projectId, { phaseState: 'working', phaseTaskId: task._id, approvals: {}, blockedReason: null, pendingRequest: null });
  await systemNote(
    projectId,
    !directorMode
      ? sysMsg('▶️ Bắt đầu giai đoạn **{phase}** – {lead} chủ trì.', { phase: phase.name, lead: lead.name })
      : request || prior
        ? sysMsg('▶️ {lead} tiếp tục theo kế hoạch đã có – giao việc còn lại cho các phòng.', { lead: lead.name })
        : sysMsg('▶️ {lead} đã nhận yêu cầu – đang xem xét và chia việc cho các phòng.', { lead: lead.name }),
    { phase: phase.id },
  );
  wakeWorker();
}

// ---------------- Hành động của người dùng ----------------

async function descendants(taskId: string): Promise<Task[]> {
  const out: Task[] = [];
  let frontier = [taskId];
  while (frontier.length) {
    const kids = await listTasks({ parentId: { $in: frontier } });
    out.push(...kids);
    frontier = kids.map((k) => k._id);
  }
  return out;
}

/** Đổi chế độ làm việc của dự án (vd sang "Giao cho giám đốc"): huỷ việc đang làm, bắt đầu lại từ đầu với chế độ mới. */
export async function switchWorkflow(projectId: string, workflowId: string): Promise<void> {
  const project = await getProject(projectId);
  if (!project) return;
  const wf = await getWorkflow(workflowId);
  const active = await listTasks({ projectId, status: { $in: ACTIVE_TASK_STATUSES }, adhoc: { $ne: true }, parentId: null });
  for (const t of active) await cancelTask(t._id, 'Đổi chế độ làm việc');
  await updateProject(projectId, {
    workflowId: wf._id,
    currentPhase: wf.phases[0].id,
    completedPhases: [],
    phaseSummaries: {},
    approvals: {},
    phaseAttempts: {},
    phaseTaskId: null,
    phaseState: 'idle',
  });
  await systemNote(projectId, sysMsg('🔁 Chuyển sang chế độ **{mode}**.', { mode: wf.name }));
  if (project.status === 'active' || project.status === 'blocked') {
    await updateProject(projectId, { status: 'active', blockedReason: null });
    await kickoffPhase(projectId);
  }
}

export async function cancelTask(taskId: string, reason = 'Người dùng hủy'): Promise<void> {
  const task = await getTask(taskId);
  if (!task) return;
  const all = [task, ...(await descendants(taskId))];
  for (const t of all) {
    if (isTerminal(t)) continue;
    await updateTask(t._id, { status: 'cancelled', error: reason, finishedAt: new Date().toISOString(), liveText: null });
    abortRunning(t._id);
  }
  await onTaskSettled(taskId);
}

export async function retryTask(taskId: string): Promise<void> {
  const task = await getTask(taskId);
  if (!task) return;
  await updateTask(taskId, { status: 'queued', error: null, retryAt: null, attempts: 0, finishedAt: null });
  const project = await getProject(task.projectId);
  if (project?.status === 'blocked') await updateProject(project._id, { status: 'active', blockedReason: null });
  wakeWorker();
}

/** Huỷ việc đang mở của dự án; `includeAdhoc` = cả việc bạn nhắn trực tiếp (và việc con của chúng). */
async function cancelActiveTasks(projectId: string, reason: string, includeAdhoc = false) {
  const active = await listTasks({ projectId, status: { $in: ACTIVE_TASK_STATUSES }, ...(includeAdhoc ? {} : { adhoc: { $ne: true } }) });
  for (const t of active) {
    await updateTask(t._id, { status: 'cancelled', error: reason, finishedAt: new Date().toISOString(), liveText: null });
    abortRunning(t._id);
  }
}

// ---------------- Tầng & hàng chờ ----------------

const floorState = globalThis as unknown as { __vpFloorLock?: Promise<unknown>; __vpAssignPendingByCompany?: Set<string> };

/** Mọi thao tác nhận/trả tầng chạy tuần tự để không hai dự án tranh một tầng. */
function withFloorLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = floorState.__vpFloorLock ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  floorState.__vpFloorLock = run.catch(() => undefined);
  return run;
}

/** Nhận một tầng trống cho dự án (nguyên tử). Trả về tầng đang giữ nếu đã có. */
/** Nhận tầng trống cho dự án; `preferred` = tầng CEO chọn giao (nếu tầng đó đang trống). */
async function claimFloor(projectId: string, preferred?: string) {
  const c = await getCollections();
  const held = await c.floors.findOne({ projectId });
  if (held) return held;
  const set = { $set: { projectId, assignedAt: now(), updatedAt: now() } };
  const floor =
    (preferred ? await c.floors.findOneAndUpdate({ _id: preferred, enabled: true, projectId: null }, set, { returnDocument: 'after' }) : null) ??
    (await c.floors.findOneAndUpdate({ enabled: true, projectId: null }, set, { sort: { number: 1 }, returnDocument: 'after' }));
  if (floor) await emit('floor.updated', projectId, { id: floor._id });
  return floor;
}

/** Trả tầng khi dự án kết thúc/bị huỷ/bị xoá, rồi giao tầng cho dự án đang chờ. */
export function releaseFloor(projectId: string): Promise<void> {
  return withFloorLock(async () => {
    const c = await getCollections();
    const res = await c.floors.updateMany({ projectId }, { $set: { projectId: null, assignedAt: null, updatedAt: now() } });
    const project = await getProject(projectId);
    if (project?.floorId) await updateProject(projectId, { floorId: null });
    if (res.modifiedCount) {
      await emit('floor.updated', projectId);
      await assignQueuedUnlocked();
    }
  });
}

/** Đưa dự án lên tầng: chạy tiếp các nhiệm vụ dở dang hoặc khởi động giai đoạn hiện tại. */
async function activateOnFloor(projectId: string, floorName: string, fresh: boolean) {
  await updateProject(projectId, { status: 'active', blockedReason: null, queuedAt: null });
  const project = (await getProject(projectId))!;
  const active = await listTasks({ projectId, status: { $in: ACTIVE_TASK_STATUSES }, adhoc: { $ne: true } });
  if (fresh || (!active.length && project.phaseState !== 'awaiting_user' && project.phaseState !== 'done')) {
    await ceoNote(projectId, sysMsg('Đã nhận yêu cầu. **{floor}** đang trống – tôi giao cho giám đốc tầng này xử lý ngay.', { floor: floorName }), {
      floor: project.floorId,
    });
    await kickoffPhase(projectId);
  } else {
    await systemNote(projectId, sysMsg('▶️ Dự án tiếp tục tại **{floor}**.', { floor: floorName }), { floor: project.floorId });
    wakeWorker();
  }
}

/** Xếp dự án vào hàng chờ khi tất cả các tầng đang bận. */
async function enqueue(projectId: string) {
  const c = await getCollections();
  await updateProject(projectId, { status: 'waiting_floor', queuedAt: now(), floorId: null });
  const [position, floors] = await Promise.all([c.projects.countDocuments({ status: 'waiting_floor' }), c.floors.countDocuments({ enabled: true })]);
  await ceoNote(projectId, sysMsg('Cả {floors} tầng đang bận. Yêu cầu của bạn đang xếp hàng **#{position}** – tầng nào xong việc tôi giao ngay.', { floors, position }));
}

/** Giao tầng trống cho các dự án đang chờ (cũ nhất trước) và dọn tầng bị chiếm sai. */
export async function assignQueuedProjects(): Promise<void> {
  // Đã có một lượt (của cùng công ty) đang chờ khoá thì không xếp thêm.
  const key = await currentCompanyId();
  const pending = (floorState.__vpAssignPendingByCompany ??= new Set());
  if (pending.has(key)) return;
  pending.add(key);
  return withFloorLock(async () => {
    pending.delete(key);
    await assignQueuedUnlocked();
  });
}

async function assignQueuedUnlocked(): Promise<void> {
  {
    const c = await getCollections();
    // Dọn tầng: dự án không còn, đã xong hoặc đã huỷ thì trả tầng.
    for (const f of await c.floors.find({ projectId: { $ne: null } }).toArray()) {
      const p = await getProject(f.projectId!);
      if (!p || p.status === 'completed' || p.status === 'cancelled') {
        await c.floors.updateOne({ _id: f._id }, { $set: { projectId: null, assignedAt: null, updatedAt: now() } });
        await emit('floor.updated', f.projectId);
      } else if (p.floorId !== f._id) {
        await updateProject(p._id, { floorId: f._id });
      }
    }
    // Dự án đang chạy từ trước khi có tầng → nhận tầng hoặc vào hàng chờ.
    for (const p of await c.projects.find({ status: { $in: ['active', 'blocked', 'paused'] }, floorId: null }).sort({ updatedAt: 1 }).toArray()) {
      const floor = await claimFloor(p._id);
      if (floor) await updateProject(p._id, { floorId: floor._id });
      else if (p.status === 'active') await enqueue(p._id);
    }
    const queue = await c.projects.find({ status: 'waiting_floor' }).sort({ queuedAt: 1 }).toArray();
    for (const p of queue) {
      const floor = await claimFloor(p._id);
      if (!floor) break;
      await updateProject(p._id, { floorId: floor._id, startedAt: p.startedAt ?? now() });
      await activateOnFloor(p._id, floor.name, !p.phaseTaskId);
    }
  }
}

export async function startProject(projectId: string, preferredFloor?: string) {
  const project = await getProject(projectId);
  if (!project) return;
  if (project.status === 'draft' || project.status === 'completed' || project.status === 'cancelled') {
    if (project.status !== 'draft') {
      const wf = await getWorkflow(project.workflowId);
      await updateProject(projectId, {
        currentPhase: wf.phases[0].id,
        completedPhases: [],
        phaseAttempts: {},
        phaseSummaries: {},
        approvals: {},
        phaseTaskId: null,
        phaseState: 'idle',
        completedAt: null,
      });
    }
    await updateProject(projectId, { startedAt: new Date().toISOString() });
    await systemNote(projectId, sysMsg('🚀 Dự án được khởi động.'));
    await withFloorLock(async () => {
      const floor = await claimFloor(projectId, preferredFloor);
      if (!floor) {
        await enqueue(projectId);
        return;
      }
      await updateProject(projectId, { floorId: floor._id });
      await activateOnFloor(projectId, floor.name, true);
    });
    return;
  }
  await resumeProject(projectId, preferredFloor);
}

export async function pauseProject(projectId: string) {
  await updateProject(projectId, { status: 'paused' });
  await systemNote(projectId, sysMsg('⏸️ Dự án tạm dừng – các nhiệm vụ đang chạy sẽ hoàn tất lượt hiện tại, nhiệm vụ mới chờ đến khi tiếp tục.'));
}

export async function resumeProject(projectId: string, preferredFloor?: string) {
  const project = await getProject(projectId);
  if (!project) return;
  // Dự án phải có tầng mới chạy được.
  const floor = await withFloorLock(async () => {
    const f = await claimFloor(projectId, preferredFloor);
    if (!f) {
      if (project.status !== 'waiting_floor') await enqueue(projectId);
      return null;
    }
    if (project.floorId !== f._id) await updateProject(projectId, { floorId: f._id });
    await updateProject(projectId, { status: 'active', blockedReason: null, queuedAt: null });
    return f;
  });
  if (!floor) return;
  const active = await listTasks({ projectId, status: { $in: ACTIVE_TASK_STATUSES }, adhoc: { $ne: true } });
  if (!active.length && project.phaseState !== 'awaiting_user' && project.phaseState !== 'done') {
    await kickoffPhase(projectId);
  } else {
    await systemNote(projectId, sysMsg('▶️ Dự án tiếp tục.'));
    wakeWorker();
  }
}

export async function userApprovePhase(projectId: string, notes = '') {
  const project = await getProject(projectId);
  if (!project) return;
  const { phase } = await phaseOf(project);
  await cancelActiveTasks(projectId, 'Chủ dự án đã phê duyệt giai đoạn');
  await updateProject(projectId, {
    status: project.floorId ? 'active' : project.status,
    blockedReason: null,
    approvals: { ...project.approvals, owner: { decision: 'approve', notes, at: new Date().toISOString(), by: 'user' } },
  });
  await systemNote(
    projectId,
    notes
      ? sysMsg('👤 Chủ dự án phê duyệt giai đoạn **{phase}**: {notes}.', { phase: phase.name, notes })
      : sysMsg('👤 Chủ dự án phê duyệt giai đoạn **{phase}**.', { phase: phase.name }),
  );
  await advancePhase(projectId);
}

export async function userRejectPhase(projectId: string, notes: string) {
  const project = await getProject(projectId);
  if (!project) return;
  await cancelActiveTasks(projectId, 'Chủ dự án yêu cầu làm lại');
  await updateProject(projectId, { status: 'active', blockedReason: null });
  await phaseRejected((await getProject(projectId))!, `### Chủ dự án\n${notes || 'Yêu cầu làm lại.'}`, true);
}

export async function restartPhase(projectId: string) {
  await cancelActiveTasks(projectId, 'Khởi động lại giai đoạn');
  await updateProject(projectId, { status: 'active', blockedReason: null });
  await kickoffPhase(projectId);
}

/** Dừng ngay: mọi phòng ngừng việc và trả tầng; bấm "Tiếp tục" để giao lại từ giai đoạn hiện tại. */
export async function stopProject(projectId: string) {
  await cancelActiveTasks(projectId, 'Bạn đã dừng dự án', true);
  await updateProject(projectId, { status: 'paused', queuedAt: null, blockedReason: null });
  await systemNote(projectId, sysMsg('⏹️ Bạn đã dừng dự án – mọi phòng ngừng việc ngay. Bấm "Tiếp tục" để giao lại từ giai đoạn hiện tại.'));
  await releaseFloor(projectId);
}

export async function cancelProject(projectId: string) {
  await cancelActiveTasks(projectId, 'Dự án đã hủy', true);
  await updateProject(projectId, { status: 'cancelled', queuedAt: null });
  await systemNote(projectId, sysMsg('🛑 Dự án đã bị hủy.'));
  await releaseFloor(projectId);
}

/** Dự án giao cho giám đốc đã xong / đã dừng / đang chờ bạn (không còn việc quy trình nào chạy) → tin nhắn tiếp theo mở lại lượt điều phối. */
export async function canContinueWithDirector(project: Project): Promise<boolean> {
  if (project.workflowId !== DIRECTOR_WORKFLOW_ID || project.status === 'draft') return false;
  if (project.status === 'waiting_floor') return true;
  const idle = ['completed', 'cancelled', 'paused', 'blocked'].includes(project.status) || project.phaseState === 'awaiting_user' || project.phaseState === 'done';
  if (!idle) return false;
  const active = await listTasks({ projectId: project._id, status: { $in: ACTIVE_TASK_STATUSES }, adhoc: { $ne: true } }, 1);
  return !active.length;
}

/**
 * Bạn nhắn tiếp cho giám đốc khi dự án đã xong / đã dừng → mở lại dự án trên một tầng và giao lượt điều phối mới
 * kèm kế hoạch + tiến độ cũ, để giám đốc giao việc còn lại ngay thay vì khảo sát lại từ đầu.
 * Trả về số tầng nhận việc (null nếu đang xếp hàng chờ tầng).
 */
export async function continueWithDirector(projectId: string, content: string, attachments: Attachment[] = [], authorName = 'Bạn'): Promise<number | null> {
  const project = await getProject(projectId);
  if (!project) throw new Error('Không tìm thấy dự án');
  await postMessage({
    projectId,
    taskId: null,
    author: { type: 'user', name: authorName },
    to: 'director',
    kind: 'chat',
    content,
    meta: attachments.length ? { attachments } : undefined,
  });
  // Nhắn nhiều lần khi đang chờ tầng → gộp lại thành một yêu cầu.
  const prev = project.pendingRequest;
  await updateProject(projectId, {
    pendingRequest: {
      content: [prev?.content, content || 'Xem ảnh đính kèm và xử lý theo nội dung ảnh.'].filter(Boolean).join('\n\n'),
      attachments: [...(prev?.attachments ?? []), ...attachments].slice(-6),
    },
    phaseState: 'idle',
    approvals: {},
    completedAt: null,
    completedPhases: project.completedPhases.filter((id) => id !== project.currentPhase),
    blockedReason: null,
  });
  if (project.status === 'waiting_floor') {
    await ceoNote(projectId, sysMsg('Đã ghi nhận – tôi sẽ chuyển cho giám đốc ngay khi có tầng trống.'));
    return null;
  }
  const floor = await withFloorLock(async () => {
    const f = await claimFloor(projectId, project.floorId ?? undefined);
    if (!f) {
      await enqueue(projectId);
      return null;
    }
    await updateProject(projectId, { floorId: f._id, status: 'active', queuedAt: null, startedAt: project.startedAt ?? now() });
    return f;
  });
  if (!floor) return null;
  await ceoNote(projectId, sysMsg('Đã nhận yêu cầu tiếp theo – giám đốc **{floor}** làm tiếp theo kế hoạch đã có.', { floor: floor.name }), { floor: floor._id });
  await kickoffPhase(projectId);
  return floor.number;
}

/** Người dùng nhắn trực tiếp cho một phòng ban → tạo nhiệm vụ chat. */
export async function chatWithDepartment(projectId: string, departmentId: string, content: string, attachments: Attachment[] = [], authorName = 'Bạn') {
  const project = await getProject(projectId);
  if (!project) throw new Error('Không tìm thấy dự án');
  await postMessage({
    projectId,
    taskId: null,
    author: { type: 'user', name: authorName },
    to: departmentId,
    kind: 'chat',
    content,
    meta: attachments.length ? { attachments } : undefined,
  });
  const task = await createTask({
    projectId,
    kind: 'chat',
    title: content.split('\n')[0].slice(0, 90) || (attachments.length ? 'Xem ảnh đính kèm' : 'Yêu cầu từ chủ dự án'),
    instructions: content || 'Xem ảnh đính kèm và xử lý theo nội dung ảnh.',
    attachments,
    departmentId,
    assignedBy: 'user',
    phase: project.currentPhase,
    priority: 'high',
    waitForChildren: true,
    adhoc: true,
  });
  wakeWorker();
  return task;
}

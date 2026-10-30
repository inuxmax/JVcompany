// Thực thi một nhiệm vụ: chọn kết nối AI, chạy agent, xử lý kết quả/giao việc/hết hạn mức.
import fs from 'fs/promises';
import path from 'path';
import type {
  Department,
  MessageKind,
  PermissionLevel,
  Project,
  Provider,
  Settings,
  Task,
  Workflow,
} from '../../types';
import { minPermission, resolveModel } from '../../catalog';
import {
  createArtifact,
  createTask,
  getDepartment,
  getProject,
  getSettings,
  getTask,
  getWorkflow,
  listDepartments,
  listProviders,
  postMessage,
  updateProvider,
  updateTask,
} from '../repo';
import { getCollections } from '../db';
import { emitActivity, emitLive } from '../bus';
import { appDataDir, truncate } from '../platform';
import { isInside } from '../fsbrowse';
import type { AgentContext, AgentOutcome } from './context';
import { CancelledError, LimitError, ProviderError, backoffMinutes } from './errors';
import { parseProtocol, stripProtocol } from './prompts';
import { delegationTargets, isPlanner } from './tools';
import { runAnthropic } from './providers/anthropic';
import { runOpenAI } from './providers/openai';
import { runCli } from './providers/cli';
import { runGateway } from './providers/gateway';
import { emptyExtras, type CompanyContext } from './context';
import { takeRequeue } from './control';
import { noteContent, sysMsg } from '../../i18n/format';
import { finishRun, startRun, touchRunOutput } from '../runs';
import { materializeSkills } from '../skills';
import { maskSecrets, resolveSecretEnv } from '../secrets';
import { defaultCompanyGoal, getCompany, goalAncestry } from '../company';
import { boardRequest, enterReview, hireAgent, onReviewTaskDone } from '../governance';
import { logActivity } from '../activity';
import { applyAgentDocuments } from '../documents';
import { prepareApiMcp, prepareClaudeHooks } from '../connections';
import { attachmentDir } from '../attachments';
import { requestPermission } from './permissions';
import type { RunStatus } from '../../types';
import { runManual } from './providers/manual';
import { onTaskSettled } from './orchestrator';

// ---------------- Chọn kết nối & model ----------------

export async function resolveProviders(dept: Department, settings: Settings): Promise<Provider[]> {
  const all = (await listProviders()).filter((p) => p.enabled);
  const byId = new Map(all.map((p) => [p._id, p]));
  const order: Provider[] = [];
  const push = (p: Provider | undefined) => {
    if (p && !order.includes(p)) order.push(p);
  };
  if (dept.providerId) push(byId.get(dept.providerId));
  else {
    for (const type of dept.preferredProviderTypes) push(all.find((p) => p.type === type && p.kind !== 'manual'));
    if (settings.defaultProviderId) push(byId.get(settings.defaultProviderId));
  }
  for (const id of dept.fallbackProviderIds) push(byId.get(id));
  if (!dept.providerId && !order.length) {
    // Không có gì phù hợp: dùng bất kỳ kết nối tự động nào, cuối cùng mới tới chế độ thủ công.
    for (const p of all) if (p.kind !== 'manual') push(p);
    for (const p of all) push(p);
  }
  return order;
}

// ---------------- Hỗ trợ ----------------

export async function workspaceFor(project: Project): Promise<{ root: string; real: boolean }> {
  if (project.path) {
    try {
      if ((await fs.stat(project.path)).isDirectory()) return { root: project.path, real: true };
    } catch {
      /* thư mục không còn tồn tại */
    }
  }
  const root = path.join(appDataDir(), 'workspaces', project._id);
  await fs.mkdir(root, { recursive: true });
  return { root, real: false };
}

async function projectTaskCount(projectId: string): Promise<number> {
  const c = await getCollections();
  return c.tasks.countDocuments({ projectId });
}

/** Lượt đầu của giám đốc ở chế độ "Giao cho giám đốc" (chỉ để phân việc). */
function isDirectorDispatch(project: Project, task: Task, dept: Department): boolean {
  return task.round === 0 && isPlanner({ project, task, department: dept });
}

/** Quyền thực tế = thấp nhất của dự án, phòng và quyền được cấp cho việc; giám đốc ở chế độ điều phối chỉ đọc. */
function effectivePermission(project: Project, dept: Department, task: Task): PermissionLevel {
  let p = minPermission(project.permission, dept.maxPermission);
  if (task.permission) p = minPermission(p, task.permission);
  if (isPlanner({ project, task, department: dept })) p = minPermission(p, 'read');
  return p;
}

/** Quyền thực tế kèm từng nguồn giới hạn (hiện trong chi tiết nhiệm vụ để biết cần nâng quyền ở đâu). */
export function permissionBreakdown(project: Project, dept: Department, task: Task) {
  return {
    effective: effectivePermission(project, dept, task),
    project: project.permission,
    department: dept.maxPermission,
    task: task.permission ?? null,
    planner: isPlanner({ project, task, department: dept }),
  };
}

async function canDelegate(task: Task, dept: Department, settings: Settings, project: Project): Promise<boolean> {
  if (task.kind === 'review' || task.evalRunId) return false;
  if (!dept.canDelegateTo.length && !isPlanner({ project, task, department: dept })) return false;
  if (task.depth >= settings.maxDepth) return false;
  if (task.round >= settings.maxRounds) return false;
  return (await projectTaskCount(task.projectId)) < settings.maxTasksPerProject;
}

function agentLogger(task: Task, dept: Department, secretValues: string[] = []) {
  return async (kind: MessageKind, raw: string, meta?: Record<string, unknown>) => {
    const content = secretValues.length ? maskSecrets(raw, secretValues) : raw;
    touchRunOutput(task._id);
    await postMessage({
      projectId: task.projectId,
      taskId: task._id,
      author: kind === 'system' ? { type: 'system' } : { type: 'agent', departmentId: dept._id, name: dept.name },
      kind,
      content,
      meta,
    });
    if (kind === 'tool') emitActivity(task.projectId, { taskId: task._id, departmentId: dept._id, text: content.slice(0, 240) });
  };
}

/** Giới hạn chữ đang viết (rất dài thì giữ phần đầu + phần cuối) – đủ cho cả một câu trả lời dài. */
function capLive(text: string, max = 40_000): string {
  return text.length > max ? `${text.slice(0, 4000)}

…

${text.slice(-(max - 4000))}` : text;
}

/** Chữ cho người đọc: dừng ở khối kết quả máy đọc (jv-result) thay vì hiện JSON thô. */
function visibleLive(text: string): string {
  const i = text.indexOf('```jv-result');
  if (i < 0) return text;
  const before = text.slice(0, i).trimEnd();
  return `${before}${before ? '\n\n' : ''}_✍️ Đang soạn kết quả và kế hoạch giao việc…_`;
}

function liveUpdater(task: Pick<Task, '_id' | 'projectId' | 'departmentId'>) {
  let last = 0;
  let lastPush = 0;
  let timer: NodeJS.Timeout | null = null;
  let pushTimer: NodeJS.Timeout | null = null;
  let pending: string | null = null;
  // Lưu DB thưa (để mở lại trang vẫn thấy), đẩy tới trình duyệt dày (chữ hiện tới đâu thấy tới đó).
  const flush = () => {
    timer = null;
    last = Date.now();
    void updateTask(task._id, { liveText: pending }, true);
  };
  let lastSent: string | null = null;
  const push = () => {
    pushTimer = null;
    lastPush = Date.now();
    if (pending === lastSent) return;
    lastSent = pending;
    // Gửi đủ nội dung đang viết (không cắt đầu) để khung chat hiện trọn câu trả lời
    emitLive(task.projectId, { taskId: task._id, departmentId: task.departmentId, text: pending });
  };
  return (text: string | null) => {
    if (text) touchRunOutput(task._id);
    pending = text ? capLive(visibleLive(text)) : null;
    if (text === null) {
      if (timer) clearTimeout(timer);
      if (pushTimer) clearTimeout(pushTimer);
      flush();
      push();
      return;
    }
    if (!pushTimer) pushTimer = setTimeout(push, Math.max(0, 250 - (Date.now() - lastPush)));
    if (timer) return;
    timer = setTimeout(flush, Math.max(0, 900 - (Date.now() - last)));
  };
}

// ---------------- Chạy nhiệm vụ ----------------

export async function runTask(taskId: string, signal: AbortSignal): Promise<void> {
  let task = await getTask(taskId);
  if (!task) return;
  const project = await getProject(task.projectId);
  if (!project) {
    await updateTask(taskId, { status: 'cancelled', error: 'Dự án không còn tồn tại' });
    return;
  }
  const dept = await getDepartment(task.departmentId);
  if (!dept || !dept.enabled) {
    await updateTask(taskId, { status: 'failed', error: `Phòng "${task.departmentId}" không tồn tại hoặc đã tắt.`, finishedAt: new Date().toISOString() });
    await onTaskSettled(taskId);
    return;
  }
  const [departments, workflow, settings] = await Promise.all([listDepartments(), getWorkflow(project.workflowId), getSettings()]);
  const log = agentLogger(task, dept);

  // Bộ đánh giá: chạy bằng kết nối / model chỉ định để so sánh
  const wanted = task.providerOverride?.providerId;
  const override = wanted ? (await listProviders()).find((p) => p._id === wanted && p.enabled) : undefined;
  const providers = override ? [override] : await resolveProviders(dept, settings);
  if (!providers.length) {
    await updateTask(taskId, {
      status: 'failed',
      error: `Chưa có kết nối AI nào cho ${dept.name}. Vào "Kết nối AI" để thêm, rồi bấm "Chạy lại".`,
      finishedAt: new Date().toISOString(),
    });
    await log('error', `Không có kết nối AI khả dụng cho ${dept.name}.`);
    await onTaskSettled(taskId);
    return;
  }
  const nowMs = Date.now();
  const available = providers.filter((p) => !p.cooldownUntil || new Date(p.cooldownUntil).getTime() <= nowMs);
  if (!available.length) {
    const earliest = providers.map((p) => new Date(p.cooldownUntil!).getTime()).sort((a, b) => a - b)[0];
    const retryAt = new Date(earliest + 5000).toISOString();
    await updateTask(taskId, { status: 'waiting_limit', retryAt, error: 'Tất cả kết nối của phòng đang hết hạn mức.' });
    return;
  }
  const provider = available[0];
  const model = override && task.providerOverride?.model ? task.providerOverride.model : resolveModel(dept, provider);
  const ws = await workspaceFor(project);
  const permission = effectivePermission(project, dept, task);

  task = (await updateTask(taskId, {
    status: 'running',
    providerId: provider._id,
    providerName: provider.name,
    model: model || null,
    attempts: task.attempts + 1,
    startedAt: task.startedAt ?? new Date().toISOString(),
    error: null,
    retryAt: null,
  }))!;

  // Bối cảnh công ty: sứ mệnh, chuỗi mục tiêu, chuỗi cấp trên, kỹ năng (theo Paperclip)
  const company = await getCompany();
  const goalId = task.goalId ?? project.goalIds?.[0] ?? (await defaultCompanyGoal())?._id ?? null;
  const chain: CompanyContext['chain'] = [];
  for (let cur = dept.reportsTo ?? null, i = 0; cur && i < 10; i++) {
    const boss = departments.find((d) => d._id === cur);
    if (!boss || chain.some((x) => x.id === boss._id)) break;
    chain.push({ id: boss._id, name: boss.name, title: boss.title });
    cur = boss.reportsTo ?? null;
  }
  const bundle = await materializeSkills(dept._id, dept.skills).catch(() => ({ dir: null, skills: [] }));
  // Biến môi trường riêng của phòng (giải "secret:KHOA" từ kho bí mật)
  let deptEnv: Record<string, string> = {};
  let secretValues: string[] = [];
  try {
    const r = await resolveSecretEnv(dept.env, { taskId, label: dept.name });
    deptEnv = r.env;
    secretValues = r.values;
  } catch (err) {
    await updateTask(taskId, { status: 'failed', error: err instanceof Error ? err.message : String(err), finishedAt: new Date().toISOString() });
    await log('error', err instanceof Error ? err.message : String(err));
    await onTaskSettled(taskId);
    return;
  }

  const ctx: AgentContext = {
    project,
    task,
    department: dept,
    departments,
    workflow,
    settings,
    root: ws.root,
    hasRealPath: ws.real,
    permission,
    signal,
    allowDelegation: await canDelegate(task, dept, settings, project),
    maxTurns: isDirectorDispatch(project, task, dept) ? 12 : undefined,
    delegations: [],
    artifacts: [],
    submitted: null,
    usage: { inputTokens: task.usage?.inputTokens ?? 0, outputTokens: task.usage?.outputTokens ?? 0, costUsd: task.usage?.costUsd ?? 0, cachedInputTokens: task.usage?.cachedInputTokens ?? 0 },
    extraDirs: bundle.dir ? [bundle.dir] : [],
    extras: emptyExtras(),
    env: deptEnv,
    secretValues,
    company: { name: company?.name ?? 'JVCompany', mission: company?.mission ?? '', goals: await goalAncestry(goalId), chain, skills: bundle.skills },
    log: agentLogger(task, dept, secretValues),
    setLive: liveUpdater(task),
  };

  // Claude Code: hook PreToolUse áp đúng quy tắc quyền của ứng dụng (lệnh shell / ghi tệp ngoài dự án → thẻ phê duyệt)
  // và kết nối dịch vụ (MCP, --mcp-config). Kết nối API: thao tác MCP thành công cụ của agent.
  let mcpCleanup: (() => Promise<void> | void) | null = null;
  try {
    if (provider.kind === 'cli' && provider.type === 'claude-code') {
      const m = await prepareClaudeHooks({
        taskId,
        departmentId: dept._id,
        permission: ctx.permission,
        roots: [ctx.root, ...(provider.cwd?.trim() ? [provider.cwd.trim()] : []), ...(ctx.extraDirs ?? []), ...(task.attachments?.length ? [attachmentDir()] : [])],
        approvalTimeoutMinutes: settings.approvalTimeoutMinutes,
        request: (req) => requestPermission(ctx, req),
        log: (text) => ctx.log('system', text),
      });
      if (m) {
        ctx.approvalHooks = true;
        ctx.mcpArgs = m.args;
        ctx.env = { ...(ctx.env ?? {}), ...m.env };
        ctx.secretValues = [...(ctx.secretValues ?? []), ...m.secretValues];
        ctx.log = agentLogger(task, dept, ctx.secretValues);
        mcpCleanup = m.cleanup;
      }
    } else if (provider.kind === 'api') {
      ctx.secretValues = ctx.secretValues ?? [];
      ctx.mcp = await prepareApiMcp(dept._id, taskId, ctx.secretValues, ctx.permission);
      if (ctx.mcp) {
        ctx.log = agentLogger(task, dept, ctx.secretValues);
        mcpCleanup = () => ctx.mcp?.close();
      }
    }
  } catch (err) {
    await ctx.log('system', `⚠️ Không chuẩn bị được kết nối dịch vụ (MCP): ${err instanceof Error ? err.message : err}. Lượt này chạy không kèm kết nối dịch vụ.`);
  }

  const run = await startRun(task, dept, provider, model, task.wakeReason ?? (task.attempts > 1 ? 'retry' : task.round > 0 ? 'continue' : 'assigned'));
  const before = { ...ctx.usage };
  let runStatus: RunStatus = 'succeeded';
  let runError: string | null = null;
  let excerpt: string | null = null;
  if (task.wakeReason) await updateTask(taskId, { wakeReason: null }, true);

  try {
    let outcome: AgentOutcome;
    if (provider.kind === 'api') {
      outcome = provider.type === 'anthropic' ? await runAnthropic(ctx, provider, model) : await runOpenAI(ctx, provider, model);
    } else if (provider.kind === 'cli') {
      outcome = await runCli(ctx, provider, model);
    } else if (provider.kind === 'gateway') {
      outcome = await runGateway(ctx, provider, model);
    } else {
      outcome = await runManual(ctx);
    }
    if (signal.aborted) throw new CancelledError();

    excerpt = outcome.summary || outcome.text.slice(-1200);
    // Bộ đánh giá: chỉ lấy câu trả lời – không giao việc, không hỏi, không tuyển, không ghi tài liệu
    if (task.evalRunId) {
      outcome.delegations = [];
      outcome.artifacts = [];
      outcome.extras = emptyExtras();
      ctx.extras = emptyExtras();
    }
    // Kết quả ghi qua công cụ (API) gộp vào phần mở rộng
    const ex = ctx.extras;
    if (ex.products.length || ex.question || ex.hires.length || ex.requests.length || ex.documents.length || ex.docReplies.length) {
      const o = outcome.extras ?? emptyExtras();
      outcome.extras = {
        products: [...o.products, ...ex.products],
        question: o.question ?? ex.question,
        hires: [...o.hires, ...ex.hires],
        requests: [...o.requests, ...ex.requests],
        documents: [...(o.documents ?? []), ...ex.documents],
        docReplies: [...(o.docReplies ?? []), ...ex.docReplies],
      };
    }
    if (outcome.status === 'waiting_human') {
      runStatus = 'waiting';
      await updateTask(taskId, { status: 'waiting_human', manualPrompt: outcome.text });
      await postMessage({
        projectId: project._id,
        taskId,
        author: { type: 'system' },
        kind: 'system',
        ...noteContent(
          sysMsg('{dept} cần bạn chuyển tiếp nhiệm vụ "{title}" qua trình duyệt ({provider}). Mở nhiệm vụ để sao chép prompt và dán câu trả lời.', { dept: dept.name, title: task.title, provider: provider.name }),
          { manual: true, webUrl: provider.webUrl },
        ),
      });
      return;
    }
    await finalizeTask(taskId, outcome, ctx);
  } catch (err) {
    runStatus = err instanceof CancelledError || signal.aborted ? 'cancelled' : err instanceof LimitError ? 'limited' : 'failed';
    runError = err instanceof Error ? err.message : String(err);
    await handleFailure(taskId, err, ctx, provider, providers.length > 1);
  } finally {
    if (mcpCleanup) await Promise.resolve(mcpCleanup()).catch(() => undefined);
    const after = await getTask(taskId);
    await finishRun(run, { status: runStatus, before, after: ctx.usage, billingType: ctx.billing?.billingType, sessionAfter: after?.sessionId ?? null, error: runError, excerpt }).catch((e) =>
      console.error('[jvcompany] Ghi lượt chạy lỗi:', e),
    );
  }
}

async function handleFailure(taskId: string, err: unknown, ctx: AgentContext, provider: Provider, hasAlternatives: boolean) {
  const task = (await getTask(taskId))!;
  const usage = ctx.usage;
  const requeue = takeRequeue(taskId);
  if (requeue) {
    await updateTask(taskId, { status: 'queued', usage, error: requeue, liveText: null });
    await ctx.log('system', `⏸ ${requeue} – nhiệm vụ được xếp lại hàng, chạy tiếp khi gỡ tạm dừng.`);
    return;
  }
  if (err instanceof CancelledError || task.status === 'cancelled') {
    await updateTask(taskId, { status: 'cancelled', finishedAt: new Date().toISOString(), usage, liveText: null });
    await onTaskSettled(taskId);
    return;
  }
  const settings = ctx.settings;
  if (err instanceof LimitError) {
    const resetAt = err.resetAt && err.resetAt.getTime() > Date.now() ? err.resetAt : null;
    const until = resetAt ?? new Date(Date.now() + backoffMinutes(task.attempts, settings.retry.baseMinutes, settings.retry.maxMinutes) * 60_000);
    await updateProvider(provider._id, { cooldownUntil: until.toISOString() });
    if (hasAlternatives) {
      await updateTask(taskId, { status: 'queued', usage, error: err.message, retryAt: null });
      await ctx.log('system', `⏳ ${provider.name} hết hạn mức – chuyển sang kết nối dự phòng.`, { limit: true });
    } else {
      await updateTask(taskId, { status: 'waiting_limit', retryAt: until.toISOString(), usage, error: err.message });
      await ctx.log(
        'system',
        `⏳ ${provider.name} hết hạn mức. Hệ thống sẽ tự chạy lại lúc ${until.toLocaleString('vi-VN')}.`,
        { limit: true, retryAt: until.toISOString() },
      );
    }
    return;
  }
  const retryable = err instanceof ProviderError ? err.retryable : false;
  const message = err instanceof Error ? err.message : String(err);
  if (retryable && task.attempts < settings.retry.maxAttempts) {
    const until = new Date(Date.now() + backoffMinutes(task.attempts, 0.5, settings.retry.maxMinutes) * 60_000);
    await updateTask(taskId, { status: 'waiting_limit', retryAt: until.toISOString(), usage, error: message });
    await ctx.log('system', `Lỗi tạm thời: ${message}. Thử lại lúc ${until.toLocaleTimeString('vi-VN')}.`);
    return;
  }
  await updateTask(taskId, { status: 'failed', error: message, usage, finishedAt: new Date().toISOString(), liveText: null });
  await ctx.log('error', `Nhiệm vụ lỗi: ${message}`);
  await onTaskSettled(taskId);
}

interface FinalizeDeps {
  project: Project;
  department: Department;
  departments: Department[];
  settings: Settings;
  workflow: Workflow;
  allowDelegation: boolean;
  usage?: AgentContext['usage'];
}

export async function finalizeTask(taskId: string, outcome: AgentOutcome, deps: FinalizeDeps): Promise<void> {
  const task = await getTask(taskId);
  if (!task || task.status === 'cancelled') return;
  const { project, department, departments } = deps;
  const name = (id: string) => departments.find((d) => d._id === id)?.name ?? id;

  for (const a of outcome.artifacts) {
    await createArtifact({
      projectId: project._id,
      taskId,
      departmentId: department._id,
      title: a.title,
      type: a.type,
      content: a.content,
      phase: task.phase,
    });
  }

  const created: Task[] = [];
  if (deps.allowDelegation) {
    const allowed = new Set(delegationTargets({ project, task, department, departments }).map((d) => d._id));
    const valid = outcome.delegations.filter((d) => allowed.has(d.to));
    // Biên bản họp giao việc: ai tham dự, các bước và thứ tự bàn giao
    if (valid.length >= 2) {
      const stepNo = new Map(valid.map((d, i) => [d.step ?? `#${i + 1}`, i + 1]));
      const lines = valid.map((d, i) => {
        const after = (d.after ?? []).map((s) => stepNo.get(s)).filter((n): n is number => Boolean(n));
        return `${i + 1}. **${name(d.to)}** – ${d.title}${after.length ? ` _(nhận bàn giao sau bước ${after.join(', ')})_` : ''}`;
      });
      await postMessage({
        projectId: project._id,
        taskId,
        author: { type: 'agent', departmentId: department._id, name: department.name },
        kind: 'delegation',
        content: `📋 **Họp giao việc** – ${department.name} chủ trì\nTham dự: ${Array.from(new Set(valid.map((d) => name(d.to)))).join(', ')}\n\n${lines.join('\n')}`,
        meta: { plan: true },
      });
    }
    const stepTask = new Map<string, string>();
    for (const d of outcome.delegations) {
      const target = departments.find((x) => x._id === d.to && x.enabled);
      if (!target || !allowed.has(d.to)) {
        await postMessage({
          projectId: project._id,
          taskId,
          author: { type: 'system' },
          kind: 'system',
          ...noteContent(sysMsg('Bỏ qua giao việc tới "{to}" (không hợp lệ hoặc không được phép).', { to: d.to })),
        });
        continue;
      }
      // Làm sau các bước đã giao trước đó trong lượt này (chuỗi bàn giao)
      const dependsOn = (d.after ?? []).map((s) => stepTask.get(s)).filter((x): x is string => Boolean(x));
      const child = await createTask({
        projectId: project._id,
        parentId: taskId,
        depth: task.depth + 1,
        kind: 'delegated',
        title: d.title,
        instructions: d.instructions,
        departmentId: d.to,
        assignedBy: department._id,
        phase: task.phase,
        priority: d.priority ?? 'normal',
        waitForChildren: true,
        adhoc: task.adhoc,
        // Quyền chảy xuống: việc con không vượt quyền người giao đã được cấp.
        permission: d.permission ? (task.permission ? minPermission(task.permission, d.permission) : d.permission) : (task.permission ?? null),
        attachments: task.attachments,
        ...(dependsOn.length ? { dependsOn, status: 'waiting_deps' as const } : {}),
      });
      if (d.step) stepTask.set(d.step, child._id);
      created.push(child);
      await postMessage({
        projectId: project._id,
        taskId,
        author: { type: 'agent', departmentId: department._id, name: department.name },
        to: d.to,
        kind: 'delegation',
        content: `**Giao việc cho ${name(d.to)}:** ${d.title}${d.permission ? ` · quyền: ${d.permission}` : ''}${dependsOn.length ? ` · nhận bàn giao sau bước ${(d.after ?? []).join(', ')}` : ''}\n\n${d.instructions}`,
        meta: { childTaskId: child._id, priority: d.priority ?? 'normal' },
      });
    }
  }

  const extras = outcome.extras;
  if (extras?.products.length) {
    const at = new Date().toISOString();
    await updateTask(taskId, { workProducts: [...(task.workProducts ?? []), ...extras.products.map((p) => ({ ...p, createdAt: at }))].slice(-50) }, true);
  }
  const canHire = department.permissions?.canHire || department._id === 'director' || isPlanner({ project, task, department });
  for (const h of canHire ? (extras?.hires ?? []) : []) {
    await hireAgent(h, { task, department }).catch((e) => postMessage({ projectId: project._id, taskId, author: { type: 'system' }, kind: 'error', ...noteContent(sysMsg('Không tuyển được {name}: {error}', { name: h.name, error: e instanceof Error ? e.message : String(e) })) }));
  }
  for (const r of extras?.requests ?? []) await boardRequest(r, { task, department });
  if (extras?.documents?.length || extras?.docReplies?.length) {
    const notes = await applyAgentDocuments(task, { type: 'agent', id: department._id, name: department.name }, extras.documents ?? [], extras.docReplies ?? []);
    if (notes.length) await postMessage({ projectId: project._id, taskId, author: { type: 'agent', departmentId: department._id, name: department.name }, kind: 'tool', content: `📄 ${notes.join(' · ')}`, meta: { documents: true } });
  }

  const waiting = created.length > 0 && task.waitForChildren;
  const summary = outcome.summary?.trim() || stripProtocol(outcome.text).slice(-1500) || 'Hoàn thành.';
  // Agent hỏi bạn trước khi làm tiếp → nhiệm vụ chờ câu trả lời
  if (!waiting && extras?.question) {
    await postMessage({
      projectId: project._id,
      taskId,
      author: { type: 'agent', departmentId: department._id, name: department.name },
      kind: 'chat',
      content: `${summary}\n\n**${extras.question.prompt}**`,
      meta: { question: extras.question, taskId },
    });
    await updateTask(taskId, {
      status: 'waiting_human',
      question: extras.question,
      result: summary,
      output: truncate(outcome.text || summary, 100_000),
      sessionId: outcome.sessionId ?? task.sessionId ?? null,
      usage: deps.usage ?? task.usage,
      manualPrompt: null,
      liveText: null,
    });
    return;
  }
  await postMessage({
    projectId: project._id,
    taskId,
    author: { type: 'agent', departmentId: department._id, name: department.name },
    kind: 'report',
    content: summary,
    meta: {
      title: task.title,
      decision: outcome.decision ?? null,
      delegated: created.length,
      round: task.round,
    },
  });

  await updateTask(taskId, {
    status: waiting ? 'waiting_children' : 'done',
    result: summary,
    output: truncate(outcome.text || summary, 100_000),
    decision: outcome.decision ?? null,
    sessionId: outcome.sessionId ?? task.sessionId ?? null,
    usage: deps.usage ?? task.usage,
    manualPrompt: null,
    liveText: null,
    finishedAt: waiting ? null : new Date().toISOString(),
  });
  // Còn bước duyệt (chính sách duyệt nhiều bước) → chờ duyệt thay vì xong hẳn
  if (!waiting && task.reviewStages?.length) {
    const fresh = await getTask(taskId);
    if (fresh && (await enterReview(fresh))) return;
  }
  await onTaskSettled(taskId);
  if (task.kind === 'review') {
    const fresh = await getTask(taskId);
    if (fresh) await onReviewTaskDone(fresh);
  }
  await logActivity({ actorType: 'agent', actorId: department._id, actorName: department.name, action: waiting ? 'task.delegated' : 'task.completed', entityType: 'task', entityId: taskId, projectId: project._id, summary: waiting
      ? sysMsg('{dept} giao {n} việc từ {id} {title}', { dept: department.name, n: created.length, id: task.identifier ?? '', title: task.title })
      : sysMsg('{dept} hoàn thành {id} {title}', { dept: department.name, id: task.identifier ?? '', title: task.title }) });
}

/** Người dùng dán kết quả từ ChatGPT/Claude.ai/… cho nhiệm vụ chế độ trình duyệt. */
export async function submitManualResponse(taskId: string, text: string): Promise<{ ok: boolean; message: string }> {
  const task = await getTask(taskId);
  if (!task || task.status !== 'waiting_human') return { ok: false, message: 'Nhiệm vụ không ở trạng thái chờ kết quả.' };
  const project = await getProject(task.projectId);
  const department = await getDepartment(task.departmentId);
  if (!project || !department) return { ok: false, message: 'Thiếu dự án hoặc phòng ban.' };
  const [departments, settings, workflow] = await Promise.all([listDepartments(), getSettings(), getWorkflow(project.workflowId)]);
  const parsed = parseProtocol(text);
  const ws = await workspaceFor(project);
  const permission = effectivePermission(project, department, task);
  const written: string[] = [];
  const skipped: string[] = [];
  for (const f of parsed.files) {
    const abs = path.resolve(ws.root, f.path);
    if (permission === 'read' || !isInside(ws.root, abs)) {
      skipped.push(f.path);
      continue;
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, f.content, 'utf8');
    written.push(path.relative(ws.root, abs));
  }
  const log = agentLogger(task, department);
  await log('thought', stripProtocol(text).slice(0, 8000) || '(chỉ có khối kết quả)', { manual: true });
  if (written.length) await log('tool', `Đã ghi ${written.length} tệp: ${written.map((w) => `\`${w}\``).join(', ')}`);
  if (skipped.length) await log('system', `Bỏ qua ${skipped.length} tệp (ngoài dự án hoặc chế độ chỉ đọc): ${skipped.join(', ')}`);
  await finalizeTask(
    taskId,
    {
      status: 'done',
      text: stripProtocol(text) || parsed.summary,
      summary: parsed.summary || stripProtocol(text).slice(0, 1500),
      decision: parsed.decision,
      delegations: parsed.delegate,
      artifacts: parsed.artifacts,
      extras: parsed.extras,
    },
    {
      project,
      department,
      departments,
      settings,
      workflow,
      allowDelegation: await canDelegate(task, department, settings, project),
    },
  );
  return { ok: true, message: parsed.found ? 'Đã nhận kết quả.' : 'Đã nhận (không thấy khối jv-result, dùng toàn văn làm tóm tắt).' };
}

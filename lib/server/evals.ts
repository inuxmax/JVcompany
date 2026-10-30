// Bộ đánh giá agent (theo Paperclip "evals"): đầu vào mẫu cho từng phòng + tiêu chí đạt; chạy bằng đường chạy thật của
// agent (prompt, kỹ năng, kết nối dịch vụ…) trong dự án nội bộ "Đánh giá agent", chấm tự động, so sánh giữa các lượt.
import crypto from 'crypto';
import type { EvalCase, EvalCaseResult, EvalCheck, EvalCheckResult, EvalRun, EvalSuite, Project, Task } from '../types';
import { getCollections, newId, now } from './db';
import { emit, wakeWorker } from './bus';
import { logActivity } from './activity';
import { createProject, createTask, getDepartment, getSettings, listProviders, updateProject } from './repo';
import { resolveModel } from '../catalog';
import { LocalizedError } from './http';
import { m } from '../i18n';

const CHECK_KINDS: EvalCheck['kind'][] = ['contains', 'not_contains', 'regex', 'max_chars', 'judge'];

// ---------------- Bộ đánh giá ----------------

export async function listSuites(departmentId?: string): Promise<EvalSuite[]> {
  const c = await getCollections();
  return c.evalSuites.find(departmentId ? { departmentId } : {}).sort({ createdAt: 1 }).toArray();
}

function cleanCases(cases: unknown): EvalCase[] {
  return (Array.isArray(cases) ? cases : [])
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x, i) => ({
      id: typeof x.id === 'string' && x.id ? x.id : newId(),
      name: String(x.name ?? `Mẫu ${i + 1}`).trim().slice(0, 120) || `Mẫu ${i + 1}`,
      input: String(x.input ?? '').slice(0, 20_000),
      checks: (Array.isArray(x.checks) ? x.checks : [])
        .filter((k): k is Record<string, unknown> => !!k && typeof k === 'object' && CHECK_KINDS.includes(k.kind as EvalCheck['kind']))
        .map((k) => ({ kind: k.kind as EvalCheck['kind'], value: String(k.value ?? '').slice(0, 4000) }))
        .filter((k) => k.value.trim())
        .slice(0, 10),
    }))
    .filter((x) => x.input.trim())
    .slice(0, 50);
}

export async function saveSuite(id: string | null, input: Partial<EvalSuite>): Promise<EvalSuite> {
  const c = await getCollections();
  const existing = id ? await c.evalSuites.findOne({ _id: id }) : null;
  if (id && !existing) throw new LocalizedError(m('Không tìm thấy bộ đánh giá'), undefined, 404);
  const departmentId = input.departmentId ?? existing?.departmentId ?? '';
  if (!(await getDepartment(departmentId))) throw new LocalizedError(m('Chọn phòng ban cần đánh giá'));
  for (const k of cleanCases(input.cases ?? existing?.cases).flatMap((x) => x.checks)) {
    if (k.kind === 'regex') {
      try {
        new RegExp(k.value, 'i');
      } catch {
        throw new LocalizedError(m('Biểu thức chính quy không hợp lệ: {value}'), { value: k.value });
      }
    }
  }
  const ts = now();
  const suite: EvalSuite = {
    _id: existing?._id ?? newId(),
    departmentId,
    name: (input.name ?? existing?.name ?? '').trim().slice(0, 120) || 'Bộ đánh giá',
    description: (input.description ?? existing?.description ?? '').trim().slice(0, 2000),
    cases: input.cases !== undefined ? cleanCases(input.cases) : (existing?.cases ?? []),
    judgeDepartmentId: input.judgeDepartmentId !== undefined ? input.judgeDepartmentId || null : (existing?.judgeDepartmentId ?? null),
    createdAt: existing?.createdAt ?? ts,
    updatedAt: ts,
  };
  await c.evalSuites.replaceOne({ _id: suite._id }, suite, { upsert: true });
  await emit('eval.updated', null, { suiteId: suite._id });
  await logActivity({ action: existing ? 'eval.suite_updated' : 'eval.suite_created', entityType: 'eval', entityId: suite._id, summary: `${existing ? 'Sửa' : 'Tạo'} bộ đánh giá "${suite.name}" (${suite.cases.length} mẫu)` });
  return suite;
}

export async function deleteSuite(id: string): Promise<void> {
  const c = await getCollections();
  const runs = await c.evalRuns.find({ suiteId: id, status: 'running' }).toArray();
  for (const r of runs) await cancelEvalRun(r._id);
  await Promise.all([c.evalSuites.deleteOne({ _id: id }), c.evalRuns.deleteMany({ suiteId: id })]);
  await emit('eval.updated', null, { suiteId: id, deleted: true });
}

// ---------------- Chạy ----------------

/** Dự án nội bộ chứa các việc đánh giá (không chiếm tầng, không hiện như dự án thường). */
async function ensureEvalProject(): Promise<Project> {
  const c = await getCollections();
  const existing = await c.projects.findOne({ internal: true, internalKind: 'evals' });
  if (existing) return existing;
  const settings = await getSettings();
  const p = await createProject({
    name: 'Đánh giá agent',
    description: 'Dự án nội bộ để chạy bộ đánh giá: mỗi việc là một đầu vào mẫu. Hãy trả lời yêu cầu đầy đủ như với một yêu cầu thật của khách hàng.',
    goal: '',
    path: null,
    autopilot: true,
    permission: settings.defaultPermission === 'full' ? 'auto' : settings.defaultPermission,
    workflowId: 'default',
  });
  await updateProject(p._id, { internal: true, internalKind: 'evals' });
  return (await c.projects.findOne({ _id: p._id }))!;
}

const hashPrompt = (s: string) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);

/** Chạy bộ đánh giá: mỗi mẫu một việc (chỉ đọc) cho phòng; `providerId`/`model` để so sánh với cấu hình khác. */
export async function startEvalRun(suiteId: string, opts: { providerId?: string | null; model?: string | null; caseIds?: string[] } = {}): Promise<EvalRun> {
  const c = await getCollections();
  const suite = await c.evalSuites.findOne({ _id: suiteId });
  if (!suite) throw new LocalizedError(m('Không tìm thấy bộ đánh giá'), undefined, 404);
  const dept = await getDepartment(suite.departmentId);
  if (!dept) throw new LocalizedError(m('Phòng ban không còn tồn tại'), undefined, 404);
  if (!dept.enabled) throw new LocalizedError(m('{name} đang tắt – bật phòng trước khi đánh giá.'), { name: dept.name });
  const cases = suite.cases.filter((x) => !opts.caseIds?.length || opts.caseIds.includes(x.id));
  if (!cases.length) throw new LocalizedError(m('Bộ đánh giá chưa có mẫu nào'));
  const providers = await listProviders();
  const provider = opts.providerId ? providers.find((p) => p._id === opts.providerId && p.enabled) : providers.find((p) => p._id === dept.providerId);
  if (opts.providerId && !provider) throw new LocalizedError(m('Kết nối AI không tồn tại hoặc đang tắt'));
  if (provider?.kind === 'manual') throw new LocalizedError(m('Kết nối "trình duyệt" (chuyển tiếp thủ công) không chạy được bộ đánh giá tự động.'));
  const model = opts.model?.trim() || (provider ? resolveModel(dept, provider) : dept.model) || '';
  const project = await ensureEvalProject();
  const ts = now();
  const run: EvalRun = {
    _id: newId(),
    suiteId,
    departmentId: dept._id,
    label: opts.providerId ? `${provider?.name ?? 'Kết nối'}${model ? ` · ${model}` : ''}` : `Cấu hình hiện tại${provider ? ` (${provider.name}${model ? ` · ${model}` : ''})` : ''}`,
    providerId: provider?._id ?? null,
    providerName: provider?.name ?? null,
    model: model || null,
    promptHash: hashPrompt(`${dept.systemPrompt}\n${(dept.skills ?? []).join(',')}`),
    status: 'running',
    results: [],
    passed: 0,
    total: cases.length,
    costUsd: 0,
    startedAt: ts,
    finishedAt: null,
  };
  for (const ec of cases) {
    const task = await createTask({
      projectId: project._id,
      kind: 'chat',
      title: `[Đánh giá] ${suite.name} – ${ec.name}`.slice(0, 120),
      instructions: ec.input,
      departmentId: dept._id,
      assignedBy: 'user',
      phase: '',
      adhoc: true,
      waitForChildren: false,
      permission: 'read',
      evalRunId: run._id,
      providerOverride: opts.providerId ? { providerId: opts.providerId, model: opts.model?.trim() || undefined } : null,
    });
    run.results.push({ caseId: ec.id, taskId: task._id, status: 'running', checks: ec.checks.map((k) => ({ kind: k.kind, value: k.value, passed: null })) });
  }
  await c.evalRuns.insertOne(run);
  await emit('eval.updated', null, { runId: run._id });
  await logActivity({ action: 'eval.run_started', entityType: 'eval', entityId: suiteId, summary: `Chạy bộ đánh giá "${suite.name}" cho ${dept.name} (${cases.length} mẫu, ${run.label})` });
  wakeWorker();
  return run;
}

export async function cancelEvalRun(runId: string): Promise<void> {
  const c = await getCollections();
  const run = await c.evalRuns.findOne({ _id: runId });
  if (!run || run.status !== 'running') return;
  const { cancelTask } = await import('./agent/orchestrator');
  const ids = run.results.flatMap((r) => [r.taskId, ...(r.judgeTaskIds ?? [])]).filter((x): x is string => Boolean(x));
  for (const t of await c.tasks.find({ _id: { $in: ids }, status: { $nin: ['done', 'failed', 'cancelled'] } }).toArray()) await cancelTask(t._id, 'Huỷ lượt đánh giá');
  await c.evalRuns.updateOne({ _id: runId }, { $set: { status: 'cancelled', finishedAt: now() } });
  await emit('eval.updated', null, { runId });
}

export async function deleteEvalRun(runId: string): Promise<void> {
  await cancelEvalRun(runId);
  const c = await getCollections();
  await c.evalRuns.deleteOne({ _id: runId });
  await emit('eval.updated', null, { runId, deleted: true });
}

// ---------------- Chấm ----------------

function outputOf(t: Task): string {
  const result = (t.result ?? '').trim();
  const full = (t.output ?? '').trim();
  return full && full !== result ? `${result}\n\n${full}` : result;
}

/** Chấm các tiêu chí tự động (trừ "judge"). */
export function autoCheck(check: EvalCheck, output: string): EvalCheckResult {
  const text = output.toLowerCase();
  switch (check.kind) {
    case 'contains':
      return { ...check, passed: text.includes(check.value.toLowerCase()) };
    case 'not_contains':
      return { ...check, passed: !text.includes(check.value.toLowerCase()) };
    case 'regex':
      try {
        return { ...check, passed: new RegExp(check.value, 'i').test(output) };
      } catch {
        return { ...check, passed: false, note: 'Biểu thức chính quy không hợp lệ' };
      }
    case 'max_chars': {
      const max = Number(check.value);
      return { ...check, passed: Number.isFinite(max) && output.length <= max, note: `${output.length} ký tự` };
    }
    default:
      return { ...check, passed: null };
  }
}

const TERMINAL = new Set(['done', 'failed', 'cancelled']);

/** Worker gọi định kỳ: cập nhật kết quả các lượt đánh giá đang chạy (chấm tự động, nhờ phòng chấm "judge"). */
export async function tickEvals(): Promise<void> {
  const c = await getCollections();
  const runs = await c.evalRuns.find({ status: 'running' }).toArray();
  for (const run of runs) {
    const suite = await c.evalSuites.findOne({ _id: run.suiteId });
    let changed = false;
    const results: EvalCaseResult[] = [];
    for (const r of run.results) {
      if (r.status === 'done' || r.status === 'failed') {
        results.push(r);
        continue;
      }
      const task = r.taskId ? await c.tasks.findOne({ _id: r.taskId }) : null;
      if (!task) {
        results.push({ ...r, status: 'failed', passed: false, error: 'Việc đánh giá không còn tồn tại' });
        changed = true;
        continue;
      }
      if (r.status === 'running') {
        // Kết nối thủ công / agent hỏi lại → không chấm được tự động
        if (task.status === 'waiting_human' && !task.question) {
          results.push({ ...r, status: 'failed', passed: false, error: 'Kết nối cần chuyển tiếp thủ công – không chạy được bộ đánh giá.' });
          changed = true;
          continue;
        }
        if (!TERMINAL.has(task.status) && task.status !== 'waiting_human') {
          results.push(r);
          continue;
        }
        const output = task.status === 'waiting_human' ? `${task.result ?? ''}\n\n${task.question?.prompt ?? ''}` : outputOf(task);
        const durationMs = task.startedAt && task.finishedAt ? new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime() : undefined;
        const base = { ...r, output: output.slice(0, 20_000), durationMs, costUsd: task.usage?.costUsd ?? 0, tokens: (task.usage?.inputTokens ?? 0) + (task.usage?.outputTokens ?? 0) };
        if (task.status === 'failed' || task.status === 'cancelled') {
          results.push({ ...base, status: 'failed', passed: false, error: task.error ?? (task.status === 'cancelled' ? 'Đã huỷ' : 'Lỗi') });
          changed = true;
          continue;
        }
        if (task.status === 'waiting_human') await c.tasks.updateOne({ _id: task._id }, { $set: { status: 'done', question: null, finishedAt: now() } });
        const checks = r.checks.map((k) => (k.kind === 'judge' ? k : autoCheck(k, output)));
        const judges = r.checks.filter((k) => k.kind === 'judge');
        if (judges.length) {
          const ec = suite?.cases.find((x) => x.id === r.caseId);
          const judgeDept = (suite?.judgeDepartmentId && (await getDepartment(suite.judgeDepartmentId))?._id) || 'director';
          const ids: string[] = [];
          for (const j of judges) {
            const jt = await createTask({
              projectId: task.projectId,
              kind: 'review',
              title: `[Chấm] ${ec?.name ?? 'Mẫu'}: ${j.value.slice(0, 60)}`.slice(0, 120),
              instructions: `Bạn là người chấm bộ đánh giá. Chỉ dựa trên tiêu chí, kết luận câu trả lời ĐẠT ("decision": "approve") hay KHÔNG ĐẠT ("decision": "reject"), nêu lý do ngắn trong summary.\n\n# Tiêu chí\n${j.value}\n\n# Đầu vào đã gửi\n${(ec?.input ?? '').slice(0, 6000)}\n\n# Câu trả lời cần chấm\n${output.slice(0, 12_000)}`,
              departmentId: judgeDept,
              assignedBy: 'system',
              phase: '',
              adhoc: true,
              waitForChildren: false,
              permission: 'read',
              evalRunId: run._id,
            });
            ids.push(jt._id);
          }
          results.push({ ...base, status: 'judging', checks, judgeTaskIds: ids });
        } else {
          results.push({ ...base, status: 'done', checks, passed: checks.every((k) => k.passed !== false) });
        }
        changed = true;
        continue;
      }
      // Đang chờ phòng chấm
      const judgeTasks = await c.tasks.find({ _id: { $in: r.judgeTaskIds ?? [] } }).toArray();
      if (judgeTasks.some((t) => !TERMINAL.has(t.status) && t.status !== 'waiting_human')) {
        results.push(r);
        continue;
      }
      let ji = 0;
      const checks = r.checks.map((k) => {
        if (k.kind !== 'judge') return k;
        const jt = judgeTasks.find((t) => t._id === r.judgeTaskIds?.[ji]);
        ji++;
        if (!jt || jt.status !== 'done') return { ...k, passed: false, note: jt?.error ?? 'Phòng chấm không kết luận được' };
        return { ...k, passed: jt.decision === 'approve', note: (jt.result ?? '').slice(0, 600) };
      });
      const judgeCost = judgeTasks.reduce((s, t) => s + (t.usage?.costUsd ?? 0), 0);
      results.push({ ...r, status: 'done', checks, passed: checks.every((k) => k.passed !== false), costUsd: (r.costUsd ?? 0) + judgeCost });
      changed = true;
    }
    if (!changed) continue;
    const finished = results.every((r) => r.status === 'done' || r.status === 'failed');
    const passed = results.filter((r) => r.passed).length;
    await c.evalRuns.updateOne(
      { _id: run._id },
      { $set: { results, passed, costUsd: results.reduce((s, r) => s + (r.costUsd ?? 0), 0), ...(finished ? { status: 'done' as const, finishedAt: now() } : {}) } },
    );
    await emit('eval.updated', null, { runId: run._id });
    if (finished) await logActivity({ actorType: 'system', action: 'eval.run_finished', entityType: 'eval', entityId: run.suiteId, summary: `Đánh giá "${suite?.name ?? ''}" xong: đạt ${passed}/${results.length} (${run.label})` });
  }
}

export async function listEvalRuns(suiteId: string, limit = 30): Promise<EvalRun[]> {
  const c = await getCollections();
  return c.evalRuns.find({ suiteId }).sort({ startedAt: -1 }).limit(limit).toArray();
}

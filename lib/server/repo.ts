// Truy cập dữ liệu MongoDB cho toàn bộ ứng dụng.
import type { Filter } from 'mongodb';
import type {
  Approval,
  Artifact,
  DashboardStats,
  Department,
  DepartmentRevision,
  Floor,
  FloorView,
  Message,
  Project,
  Provider,
  Settings,
  Task,
  Workflow,
} from '../types';
import { ACTIVE_TASK_STATUSES } from '../catalog';
import { currentCompanyId, getCollections, newId, now } from './db';
import { emit } from './bus';
import { DEFAULT_DEPARTMENTS, DEFAULT_SETTINGS, DEFAULT_WORKFLOW, DIRECTOR_WORKFLOW } from './seed';
import { LocalizedError } from './http';
import { m } from '../i18n';
import type { LocalizedText } from '../i18n/format';

// ---------------- Settings ----------------

export async function getSettings(): Promise<Settings> {
  const c = await getCollections();
  const s = await c.settings.findOne({ _id: 'global' });
  return { ...DEFAULT_SETTINGS, updatedAt: now(), ...(s ?? {}) } as Settings;
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const c = await getCollections();
  const { _id: _ignored, ...rest } = patch;
  void _ignored;
  await c.settings.updateOne({ _id: 'global' }, { $set: { ...rest, updatedAt: now() } }, { upsert: true });
  await emit('settings.updated');
  return getSettings();
}

// ---------------- Departments ----------------

export async function listDepartments(): Promise<Department[]> {
  await ensureBuiltins();
  const c = await getCollections();
  return c.departments.find().sort({ order: 1 }).toArray();
}

export async function getDepartment(id: string): Promise<Department | null> {
  const c = await getCollections();
  return c.departments.findOne({ _id: id });
}

export async function createDepartment(data: Partial<Department> & { name: string }): Promise<Department> {
  const c = await getCollections();
  const count = await c.departments.countDocuments();
  const base = slugify(data.name) || `phong-${count + 1}`;
  let id = base;
  for (let i = 2; await c.departments.findOne({ _id: id }); i++) id = `${base}-${i}`;
  const ts = now();
  const dept: Department = {
    _id: id,
    name: data.name,
    title: data.title ?? 'Chuyên viên',
    description: data.description ?? '',
    icon: data.icon ?? 'Briefcase',
    color: data.color ?? '#38BDF8',
    role: data.role ?? id,
    responsibilities: data.responsibilities ?? [],
    capabilities: data.capabilities ?? [],
    systemPrompt:
      data.systemPrompt ??
      `# Vai trò\nBạn là ${data.title ?? 'chuyên viên'} của ${data.name} trong JVCompany.\n\n# Trách nhiệm\n- ...\n`,
    canDelegateTo: data.canDelegateTo ?? [],
    canApprove: data.canApprove ?? false,
    providerId: data.providerId ?? null,
    preferredProviderTypes: data.preferredProviderTypes ?? [],
    tier: data.tier ?? 'balanced',
    model: data.model ?? '',
    fallbackProviderIds: data.fallbackProviderIds ?? [],
    effort: data.effort ?? '',
    maxPermission: data.maxPermission ?? 'write',
    maxTurns: data.maxTurns ?? 30,
    enabled: data.enabled ?? true,
    order: data.order ?? count,
    position: data.position ?? { x: count % 3, y: Math.floor(count / 3) },
    reportsTo: data.reportsTo !== undefined ? data.reportsTo : id === 'director' ? null : 'director',
    status: data.status ?? 'active',
    ...(data.skills ? { skills: data.skills } : {}),
    createdAt: ts,
    updatedAt: ts,
  };
  await c.departments.insertOne(dept);
  await emit('department.updated', null, { id });
  return dept;
}

/** Trường không ghi lịch sử cấu hình (thay đổi do hệ thống / vị trí trên sơ đồ). */
const NO_REVISION = new Set(['updatedAt', 'lastHeartbeatAt', 'position', 'order']);

export async function updateDepartment(
  id: string,
  patch: Partial<Department>,
  opts: { by?: string; source?: DepartmentRevision['source']; rolledBackFrom?: string | null; skipRevision?: boolean } = {},
): Promise<Department | null> {
  const c = await getCollections();
  const { _id: _ignored, createdAt: _c, ...rest } = patch;
  void _ignored;
  void _c;
  const before = await c.departments.findOne({ _id: id });
  await c.departments.updateOne({ _id: id }, { $set: { ...rest, updatedAt: now() } });
  // Lịch sử cấu hình: mỗi lần sửa ghi một bản (để khôi phục)
  if (before && !opts.skipRevision) {
    const changed = Object.keys(rest).filter((k) => !NO_REVISION.has(k) && JSON.stringify((before as unknown as Record<string, unknown>)[k]) !== JSON.stringify((rest as Record<string, unknown>)[k]));
    if (changed.length) {
      const pick = (o: Record<string, unknown>) => Object.fromEntries(changed.map((k) => [k, o[k] ?? null]));
      await c.departmentRevisions.insertOne({
        _id: newId(),
        departmentId: id,
        source: opts.source ?? 'patch',
        changedKeys: changed,
        before: pick(before as unknown as Record<string, unknown>) as Partial<Department>,
        after: pick(rest as Record<string, unknown>) as Partial<Department>,
        rolledBackFrom: opts.rolledBackFrom ?? null,
        by: opts.by ?? 'Bạn',
        createdAt: now(),
      });
    }
  }
  await emit('department.updated', null, { id });
  return getDepartment(id);
}

export async function listDepartmentRevisions(departmentId: string, limit = 50): Promise<DepartmentRevision[]> {
  const c = await getCollections();
  return c.departmentRevisions.find({ departmentId }).sort({ createdAt: -1 }).limit(limit).toArray();
}

/** Khôi phục cấu hình về trạng thái TRƯỚC một lần sửa (ghi thành bản mới "rollback"). */
export async function rollbackDepartment(revisionId: string): Promise<Department | null> {
  const c = await getCollections();
  const rev = await c.departmentRevisions.findOne({ _id: revisionId });
  if (!rev || !rev.before) throw new LocalizedError(m('Không tìm thấy bản ghi cấu hình để khôi phục.'), undefined, 404);
  return updateDepartment(rev.departmentId, rev.before, { source: 'rollback', rolledBackFrom: revisionId });
}

export async function resetDepartment(id: string): Promise<Department | null> {
  const seed = DEFAULT_DEPARTMENTS.find((d) => d._id === id);
  if (!seed) return getDepartment(id);
  const { providerId: _p, fallbackProviderIds: _f, ...defaults } = seed;
  void _p;
  void _f;
  return updateDepartment(id, defaults);
}

/** Lý do không xoá được phòng ban (đang có trong quy trình / còn việc đang làm; khoá dịch + biến), hoặc null nếu xoá được. */
export async function departmentDeleteBlocker(id: string): Promise<LocalizedText | null> {
  const c = await getCollections();
  const phases = (await c.workflows.find().toArray()).flatMap((w) => w.phases);
  const used = phases.filter((p) => p.lead === id || p.departments.includes(id) || p.requiredApprovals.includes(id));
  if (used.length) {
    return { key: m('Phòng đang nằm trong quy trình (giai đoạn {phases}). Bỏ phòng khỏi quy trình ở Cài đặt → Quy trình làm việc rồi xoá lại.'), vars: { phases: used.map((p) => p.name).join(', ') } };
  }
  const active = await c.tasks.countDocuments({ departmentId: id, status: { $in: ACTIVE_TASK_STATUSES } });
  if (active) return { key: m('Phòng còn {n} nhiệm vụ đang mở. Huỷ hoặc chờ xong rồi xoá lại.'), vars: { n: active } };
  return null;
}

export async function deleteDepartment(id: string): Promise<void> {
  const c = await getCollections();
  await c.departments.deleteOne({ _id: id });
  await c.departments.updateMany({}, { $pull: { canDelegateTo: id } });
  await emit('department.updated', null, { id, deleted: true });
}

// ---------------- Providers ----------------

export function sanitizeProvider(p: Provider): Provider {
  const { apiKey, secretOptions, ...rest } = p;
  return {
    ...rest,
    hasApiKey: Boolean(apiKey),
    apiKeyPreview: apiKey ? `••••${apiKey.slice(-4)}` : undefined,
    secretOptionKeys: Object.entries(secretOptions ?? {})
      .filter(([, v]) => Boolean(v))
      .map(([k]) => k),
  };
}

export async function listProviders(): Promise<Provider[]> {
  const c = await getCollections();
  return c.providers.find().sort({ createdAt: 1 }).toArray();
}

export async function getProvider(id: string): Promise<Provider | null> {
  const c = await getCollections();
  return c.providers.findOne({ _id: id });
}

export async function createProvider(data: Omit<Provider, '_id' | 'createdAt' | 'updatedAt'>): Promise<Provider> {
  const c = await getCollections();
  const ts = now();
  const p: Provider = { ...data, _id: newId(), createdAt: ts, updatedAt: ts };
  await c.providers.insertOne(p);
  await emit('provider.updated', null, { id: p._id });
  return p;
}

export async function updateProvider(id: string, patch: Partial<Provider>): Promise<Provider | null> {
  const c = await getCollections();
  const { _id: _i, createdAt: _c, hasApiKey: _h, apiKeyPreview: _a, secretOptionKeys: _k, ...rest } = patch;
  void _i;
  void _c;
  void _h;
  void _a;
  void _k;
  await c.providers.updateOne({ _id: id }, { $set: { ...rest, updatedAt: now() } });
  await emit('provider.updated', null, { id });
  return getProvider(id);
}

export async function deleteProvider(id: string): Promise<void> {
  const c = await getCollections();
  await c.providers.deleteOne({ _id: id });
  await c.departments.updateMany({ providerId: id }, { $set: { providerId: null } });
  await c.departments.updateMany({}, { $pull: { fallbackProviderIds: id } });
  const s = await getSettings();
  if (s.defaultProviderId === id) await updateSettings({ defaultProviderId: null });
  await emit('provider.updated', null, { id, deleted: true });
}

// ---------------- Workflow ----------------

/** Bổ sung cho cơ sở dữ liệu tạo từ bản cũ: chế độ "Giao cho giám đốc", Phòng Test & Phòng Fix Bug. */
async function ensureBuiltins() {
  // Mỗi công ty (CSDL) kiểm tra một lần mỗi tiến trình
  const g = globalThis as { __vpBuiltinsV3?: Set<string> };
  const done = (g.__vpBuiltinsV3 ??= new Set());
  const companyId = await currentCompanyId();
  if (done.has(companyId)) return;
  const c = await getCollections();
  // Phòng Test & Phòng Fix Bug: thêm một lần (nếu bạn xoá về sau thì không tự thêm lại).
  if (!(await c.meta.findOne({ _id: 'dept-tester-bugfix' }))) {
    const ts = now();
    for (const id of ['tester', 'bugfix']) {
      const d = DEFAULT_DEPARTMENTS.find((x) => x._id === id);
      if (d) await c.departments.updateOne({ _id: id }, { $setOnInsert: { ...d, createdAt: ts, updatedAt: ts } }, { upsert: true });
    }
    await c.departments.updateOne({ _id: 'qa' }, { $addToSet: { canDelegateTo: { $each: ['tester', 'bugfix'] } } });
    await c.departments.updateOne({ _id: 'dev' }, { $addToSet: { canDelegateTo: 'tester' } });
    await c.departments.updateOne({ _id: 'director' }, { $addToSet: { canDelegateTo: { $each: ['dev', 'tester', 'bugfix'] } } });
    await c.workflows.updateOne({ _id: DIRECTOR_WORKFLOW._id }, { $addToSet: { 'phases.0.departments': { $each: ['tester', 'bugfix'] } } });
    await c.meta.updateOne({ _id: 'dept-tester-bugfix' }, { $set: { value: { at: ts } } }, { upsert: true });
  }
  await c.workflows.updateOne({ _id: DIRECTOR_WORKFLOW._id }, { $setOnInsert: { ...DIRECTOR_WORKFLOW, updatedAt: now() } }, { upsert: true });
  // Quy trình 7 giai đoạn tạo từ bản cũ chưa có mô tả.
  await c.workflows.updateOne({ _id: DEFAULT_WORKFLOW._id, description: { $exists: false } }, { $set: { description: DEFAULT_WORKFLOW.description } });
  done.add(companyId);
}

/** Các chế độ làm việc (giao cho giám đốc trước). */
export async function listWorkflows(): Promise<Workflow[]> {
  await ensureBuiltins();
  const c = await getCollections();
  const all = await c.workflows.find().toArray();
  return all.sort((a, b) => (a._id === DIRECTOR_WORKFLOW._id ? -1 : b._id === DIRECTOR_WORKFLOW._id ? 1 : a.name.localeCompare(b.name)));
}

export async function getWorkflow(id = 'default'): Promise<Workflow> {
  await ensureBuiltins();
  const c = await getCollections();
  const wf = (await c.workflows.findOne({ _id: id })) ?? (await c.workflows.findOne({ _id: 'default' }));
  if (!wf) throw new LocalizedError(m('Không tìm thấy quy trình'), undefined, 404);
  return wf;
}

export async function updateWorkflow(id: string, patch: Partial<Workflow>): Promise<Workflow> {
  const c = await getCollections();
  const { _id: _i, ...rest } = patch;
  void _i;
  await c.workflows.updateOne({ _id: id }, { $set: { ...rest, updatedAt: now() } });
  return getWorkflow(id);
}

// ---------------- Projects ----------------

export async function listProjects(): Promise<Project[]> {
  const c = await getCollections();
  return c.projects.find().sort({ updatedAt: -1 }).toArray();
}

export async function getProject(id: string): Promise<Project | null> {
  const c = await getCollections();
  return c.projects.findOne({ _id: id });
}

export async function createProject(
  data: Pick<Project, 'name' | 'description' | 'goal' | 'path' | 'autopilot' | 'permission'> & { workflowId?: string; attachments?: Project['attachments']; language?: Project['language'] },
): Promise<Project> {
  const c = await getCollections();
  const wf = await getWorkflow(data.workflowId ?? DIRECTOR_WORKFLOW._id);
  const ts = now();
  const project: Project = {
    _id: newId(),
    name: data.name,
    description: data.description,
    goal: data.goal,
    path: data.path,
    status: 'draft',
    workflowId: wf._id,
    ...(data.attachments?.length ? { attachments: data.attachments } : {}),
    ...(data.language ? { language: data.language } : {}),
    currentPhase: wf.phases[0].id,
    phaseState: 'idle',
    phaseTaskId: null,
    approvals: {},
    phaseAttempts: {},
    phaseSummaries: {},
    completedPhases: [],
    autopilot: data.autopilot,
    permission: data.permission,
    blockedReason: null,
    createdAt: ts,
    updatedAt: ts,
    startedAt: null,
    completedAt: null,
  };
  await c.projects.insertOne(project);
  await emit('project.updated', project._id);
  return project;
}

export async function updateProject(id: string, patch: Partial<Project>): Promise<Project | null> {
  const c = await getCollections();
  const { _id: _i, createdAt: _c, ...rest } = patch;
  void _i;
  void _c;
  await c.projects.updateOne({ _id: id }, { $set: { ...rest, updatedAt: now() } });
  await emit('project.updated', id);
  return getProject(id);
}

export async function deleteProject(id: string): Promise<void> {
  const c = await getCollections();
  await Promise.all([
    c.projects.deleteOne({ _id: id }),
    c.tasks.deleteMany({ projectId: id }),
    c.messages.deleteMany({ projectId: id }),
    c.approvals.deleteMany({ projectId: id }),
    c.artifacts.deleteMany({ projectId: id }),
    c.documents.deleteMany({ projectId: id }),
    c.documentRevisions.deleteMany({ projectId: id }),
    c.documentThreads.deleteMany({ projectId: id }),
  ]);
  await emit('project.deleted', id);
}

// ---------------- Tasks ----------------

export type NewTask = Pick<Task, 'projectId' | 'kind' | 'title' | 'instructions' | 'departmentId' | 'assignedBy' | 'phase'> &
  Partial<
    Pick<
      Task,
      'parentId' | 'depth' | 'priority' | 'waitForChildren' | 'status' | 'adhoc' | 'permission' | 'attachments' | 'dependsOn' | 'goalId' | 'routineId' | 'reviewStages' | 'labels' | 'wakeReason' | 'evalRunId' | 'providerOverride'
    >
  >;

/** Cấp mã nhiệm vụ dễ đọc (vd JV-12) từ bộ đếm của công ty. */
async function nextIdentifier(): Promise<string> {
  const c = await getCollections();
  const r = await c.companies.findOneAndUpdate(
    { _id: await currentCompanyId() },
    { $inc: { issueCounter: 1 }, $setOnInsert: { name: 'JVCompany', mission: '', issuePrefix: 'JV', status: 'active', budgetMonthlyUsd: 0, requireApprovalForNewAgents: false, onboardedAt: null, createdAt: now(), updatedAt: now() } },
    { upsert: true, returnDocument: 'after' },
  );
  return `${r?.issuePrefix || 'JV'}-${r?.issueCounter ?? 1}`;
}

export async function createTask(data: NewTask): Promise<Task> {
  const c = await getCollections();
  const ts = now();
  const task: Task = {
    _id: newId(),
    parentId: data.parentId ?? null,
    depth: data.depth ?? 0,
    priority: data.priority ?? 'normal',
    waitForChildren: data.waitForChildren ?? true,
    status: data.status ?? 'queued',
    round: 0,
    attempts: 0,
    retryAt: null,
    error: null,
    decision: null,
    identifier: await nextIdentifier(),
    ...data,
    createdAt: ts,
    updatedAt: ts,
  };
  await c.tasks.insertOne(task);
  await emit('task.updated', task.projectId, { id: task._id, status: task.status });
  return task;
}

export async function getTask(id: string): Promise<Task | null> {
  const c = await getCollections();
  return c.tasks.findOne({ _id: id });
}

export async function updateTask(id: string, patch: Partial<Task>, silent = false): Promise<Task | null> {
  const c = await getCollections();
  const { _id: _i, createdAt: _c, ...rest } = patch;
  void _i;
  void _c;
  const res = await c.tasks.findOneAndUpdate(
    { _id: id },
    { $set: { ...rest, updatedAt: now() } },
    { returnDocument: 'after' },
  );
  if (res && !silent) await emit('task.updated', res.projectId, { id, status: res.status });
  return res;
}

export async function listTasks(filter: Filter<Task> = {}, limit = 500): Promise<Task[]> {
  const c = await getCollections();
  return c.tasks
    .find(filter, { projection: { liveText: 0 } })
    .sort({ createdAt: 1 })
    .limit(limit)
    .toArray();
}

export async function childrenOf(taskId: string): Promise<Task[]> {
  const c = await getCollections();
  return c.tasks.find({ parentId: taskId }).sort({ createdAt: 1 }).toArray();
}

// ---------------- Messages ----------------

export async function postMessage(data: Omit<Message, '_id' | 'createdAt'>): Promise<Message> {
  const c = await getCollections();
  const msg: Message = { ...data, _id: newId(), createdAt: now() };
  await c.messages.insertOne(msg);
  await emit('message.created', msg.projectId, { id: msg._id, taskId: msg.taskId ?? null });
  return msg;
}

/** Nhiệm vụ đang chạy kèm câu trả lời viết dở (để hiện trực tiếp trong chat). */
export async function liveTasks(projectId: string): Promise<Pick<Task, '_id' | 'departmentId' | 'title' | 'liveText' | 'updatedAt' | 'kind'>[]> {
  const c = await getCollections();
  return c.tasks
    .find({ projectId, status: 'running' }, { projection: { departmentId: 1, title: 1, liveText: 1, updatedAt: 1, kind: 1 } })
    .sort({ updatedAt: 1 })
    .toArray();
}

export async function listMessages(projectId: string, opts: { taskId?: string; limit?: number } = {}): Promise<Message[]> {
  const c = await getCollections();
  const filter: Filter<Message> = { projectId };
  if (opts.taskId) filter.taskId = opts.taskId;
  const rows = await c.messages
    .find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(opts.limit ?? 400)
    .toArray();
  return rows.reverse();
}

// ---------------- Approvals ----------------

export async function createApproval(data: Omit<Approval, '_id' | 'createdAt' | 'status'>): Promise<Approval> {
  const c = await getCollections();
  const a: Approval = { ...data, _id: newId(), status: 'pending', createdAt: now(), resolvedAt: null };
  await c.approvals.insertOne(a);
  await emit('approval.updated', a.projectId, { id: a._id, status: a.status });
  return a;
}

export async function getApproval(id: string): Promise<Approval | null> {
  const c = await getCollections();
  return c.approvals.findOne({ _id: id });
}

export async function resolveApproval(
  id: string,
  status: 'approved' | 'denied' | 'expired',
  opts: { scope?: 'once' | 'task'; note?: string } = {},
): Promise<Approval | null> {
  const c = await getCollections();
  const res = await c.approvals.findOneAndUpdate(
    { _id: id, status: 'pending' },
    { $set: { status, scope: opts.scope ?? 'once', note: opts.note ?? '', resolvedAt: now() } },
    { returnDocument: 'after' },
  );
  if (res) await emit('approval.updated', res.projectId, { id, status });
  return res;
}

export async function listApprovals(filter: Filter<Approval> = {}, limit = 200): Promise<Approval[]> {
  const c = await getCollections();
  return c.approvals.find(filter).sort({ createdAt: -1 }).limit(limit).toArray();
}

// ---------------- Artifacts ----------------

export async function createArtifact(data: Omit<Artifact, '_id' | 'createdAt'>): Promise<Artifact> {
  const c = await getCollections();
  const a: Artifact = { ...data, _id: newId(), createdAt: now() };
  await c.artifacts.insertOne(a);
  await emit('artifact.created', a.projectId, { id: a._id });
  return a;
}

export async function listArtifacts(projectId: string): Promise<Artifact[]> {
  const c = await getCollections();
  return c.artifacts.find({ projectId }).sort({ createdAt: -1 }).toArray();
}

// ---------------- Floors ----------------

export async function listFloors(): Promise<Floor[]> {
  const c = await getCollections();
  return c.floors.find().sort({ number: 1 }).toArray();
}

export async function updateFloor(id: string, patch: Partial<Pick<Floor, 'name' | 'enabled'>>): Promise<Floor | null> {
  const c = await getCollections();
  const res = await c.floors.findOneAndUpdate({ _id: id }, { $set: { ...patch, updatedAt: now() } }, { returnDocument: 'after' });
  await emit('floor.updated', res?.projectId ?? null, { id });
  return res;
}

/** Các tầng kèm dự án đang chiếm + hàng chờ dự án. */
export async function floorOverview(): Promise<{ floors: FloorView[]; queue: { _id: string; name: string; queuedAt: string | null; position: number }[] }> {
  const c = await getCollections();
  const [floors, waiting] = await Promise.all([
    c.floors.find().sort({ number: 1 }).toArray(),
    c.projects.find({ status: 'waiting_floor' }, { projection: { name: 1, queuedAt: 1 } }).sort({ queuedAt: 1 }).toArray(),
  ]);
  const ids = floors.map((f) => f.projectId).filter((x): x is string => Boolean(x));
  const projects = ids.length
    ? await c.projects
        .find({ _id: { $in: ids } }, { projection: { name: 1, status: 1, currentPhase: 1, phaseState: 1, phaseTaskId: 1, updatedAt: 1, workflowId: 1 } })
        .toArray()
    : [];
  const byId = new Map(projects.map((p) => [p._id, p]));
  return {
    floors: floors.map((f) => ({ ...f, project: (f.projectId && (byId.get(f.projectId) as FloorView['project'])) || null })),
    queue: waiting.map((p, i) => ({ _id: p._id, name: p.name, queuedAt: p.queuedAt ?? null, position: i + 1 })),
  };
}

// ---------------- Stats ----------------

export async function dashboardStats(): Promise<DashboardStats> {
  const c = await getCollections();
  const [projects, taskGroups, approvalsPending, providers, departments, busy] = await Promise.all([
    c.projects.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray(),
    c.tasks.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray(),
    c.approvals.countDocuments({ status: 'pending' }),
    c.providers.find({}, { projection: { enabled: 1, status: 1 } }).toArray(),
    c.departments.countDocuments({ enabled: true }),
    c.tasks.distinct('departmentId', { status: 'running' }),
  ]);
  const p = Object.fromEntries(projects.map((r) => [r._id, r.n]));
  const t = Object.fromEntries(taskGroups.map((r) => [r._id, r.n]));
  return {
    projects: {
      total: projects.reduce((s, r) => s + r.n, 0),
      active: p.active ?? 0,
      completed: p.completed ?? 0,
      paused: p.paused ?? 0,
      blocked: p.blocked ?? 0,
    },
    tasks: {
      running: t.running ?? 0,
      queued: t.queued ?? 0,
      waiting:
        (t.waiting_children ?? 0) + (t.waiting_approval ?? 0) + (t.waiting_limit ?? 0) + (t.waiting_human ?? 0),
      done: t.done ?? 0,
      failed: t.failed ?? 0,
    },
    approvalsPending,
    providers: {
      total: providers.length,
      ready: providers.filter((x) => x.enabled && x.status?.ok !== false).length,
    },
    departments: { total: departments, busy: busy.length },
  };
}

export async function activeTasksByDepartment(): Promise<Record<string, Task[]>> {
  const c = await getCollections();
  const rows = await c.tasks
    // Chỉ các trường giao diện cần (sơ đồ, toà nhà, danh sách nhân sự) – bỏ hướng dẫn / kết quả dài cho nhẹ
    .find(
      { status: { $in: ACTIVE_TASK_STATUSES } },
      { projection: { projectId: 1, departmentId: 1, status: 1, kind: 1, round: 1, title: 1, identifier: 1, createdAt: 1, updatedAt: 1, assignedBy: 1, adhoc: 1, parentId: 1, priority: 1, retryAt: 1 } },
    )
    .sort({ createdAt: 1 })
    .toArray();
  const out: Record<string, Task[]> = {};
  for (const t of rows) (out[t.departmentId] ??= []).push(t);
  return out;
}

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// Kết nối MongoDB (singleton qua globalThis), tạo index, khởi tạo dữ liệu và nhập dữ liệu JSON cũ.
// Nhiều công ty: mỗi công ty một cơ sở dữ liệu riêng (công ty chính "main" dùng CSDL gốc MONGODB_DB, công ty khác
// dùng MONGODB_DB__<mã>) → mọi collection tách theo công ty. Danh sách công ty, kết nối AI và tài khoản dùng chung (CSDL gốc).
// Công ty đang làm việc: ngữ cảnh worker (runWithCompany) → cookie "vp_company" của trình duyệt → "main".
import { AsyncLocalStorage } from 'async_hooks';
import { MongoClient, ObjectId, type Db, type Collection } from 'mongodb';
import fs from 'fs/promises';
import path from 'path';
import type {
  ActivityEntry,
  Approval,
  AppEvent,
  Artifact,
  BudgetIncident,
  BudgetPolicy,
  Company,
  CostEvent,
  Department,
  DepartmentRevision,
  DocumentRevision,
  DocumentThread,
  Goal,
  ChatBinding,
  ChatConnector,
  InboxState,
  IssueDocument,
  McpConnection,
  Routine,
  RoutineRun,
  Run,
  Secret,
  Skill,
  Floor,
  Message,
  Project,
  Provider,
  Settings,
  Task,
  Workflow,
  EvalRun,
  EvalSuite,
  InstalledPlugin,
  User,
} from '../types';
import { DEFAULT_COMPANY, DEFAULT_DEPARTMENTS, DEFAULT_FLOORS, DEFAULT_SETTINGS, DEFAULT_WORKFLOW, DIRECTOR_WORKFLOW, LEGACY_DEPARTMENT_COLORS } from './seed';

export const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
export const MONGODB_DB = process.env.MONGODB_DB || 'vanphong_ai';

interface Meta {
  _id: string;
  value?: unknown;
  seq?: number;
}

export interface Collections {
  departments: Collection<Department>;
  providers: Collection<Provider>;
  workflows: Collection<Workflow>;
  projects: Collection<Project>;
  tasks: Collection<Task>;
  messages: Collection<Message>;
  approvals: Collection<Approval>;
  artifacts: Collection<Artifact>;
  events: Collection<AppEvent>;
  settings: Collection<Settings>;
  floors: Collection<Floor>;
  companies: Collection<Company>;
  goals: Collection<Goal>;
  departmentRevisions: Collection<DepartmentRevision>;
  runs: Collection<Run>;
  costEvents: Collection<CostEvent>;
  budgetPolicies: Collection<BudgetPolicy>;
  budgetIncidents: Collection<BudgetIncident>;
  routines: Collection<Routine>;
  routineRuns: Collection<RoutineRun>;
  activity: Collection<ActivityEntry>;
  secrets: Collection<Secret>;
  skills: Collection<Skill>;
  documents: Collection<IssueDocument>;
  documentRevisions: Collection<DocumentRevision>;
  documentThreads: Collection<DocumentThread>;
  inboxState: Collection<InboxState>;
  chatConnectors: Collection<ChatConnector>;
  mcpConnections: Collection<McpConnection>;
  chatBindings: Collection<ChatBinding>;
  evalSuites: Collection<EvalSuite>;
  evalRuns: Collection<EvalRun>;
  plugins: Collection<InstalledPlugin>;
  /** Dùng chung mọi công ty (CSDL gốc). */
  users: Collection<User>;
  meta: Collection<Meta>;
}

interface DbGlobal {
  client?: MongoClient;
  connecting?: Promise<MongoClient>;
  /**
   * Collections đã sẵn sàng theo công ty (khoá gồm cả "phiên bản" danh sách collection để dev server nạp lại đúng).
   * Tên trường khác bản cũ (`ready` = Promise một công ty): worker đang chạy mã cũ (không nạp lại nóng) vẫn dùng `ready`,
   * nên không được ghi đè trường đó.
   */
  readyByCompany?: Map<string, Promise<Collections>>;
  /** Danh sách mã công ty hợp lệ (đệm ngắn) để kiểm tra cookie. */
  companyIds?: { ids: Set<string>; at: number };
}

const g = globalThis as unknown as { __vpDb?: DbGlobal; __vpCompanyAls?: AsyncLocalStorage<{ companyId: string }> };
const state: DbGlobal = (g.__vpDb ??= {});
const als: AsyncLocalStorage<{ companyId: string }> = (g.__vpCompanyAls ??= new AsyncLocalStorage());

export const MAIN_COMPANY = 'main';
export const COMPANY_ID_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;
export const COMPANY_COOKIE = 'vp_company';

/** Tên CSDL của một công ty. */
export function companyDbName(companyId: string): string {
  return companyId === MAIN_COMPANY ? MONGODB_DB : `${MONGODB_DB}__${companyId}`.slice(0, 63);
}

/** Chạy hàm trong ngữ cảnh một công ty (worker, kênh chat, webhook…). */
export function runWithCompany<T>(companyId: string, fn: () => T): T {
  return als.run({ companyId }, fn);
}

/** Công ty của ngữ cảnh hiện tại nếu đã đặt rõ (không đọc cookie) – dùng cho hàm đồng bộ. */
export function contextCompanyId(): string {
  return als.getStore()?.companyId ?? MAIN_COMPANY;
}

async function knownCompanyIds(): Promise<Set<string>> {
  const cached = state.companyIds;
  if (cached && Date.now() - cached.at < 5000) return cached.ids;
  const root = await companyCollections(MAIN_COMPANY);
  const rows = await root.companies.find({ status: { $ne: 'archived' } }, { projection: { _id: 1 } }).toArray();
  const ids = new Set([MAIN_COMPANY, ...rows.map((r) => r._id)]);
  state.companyIds = { ids, at: Date.now() };
  return ids;
}

export function forgetCompanyCache(): void {
  state.companyIds = undefined;
}

/** Công ty đang làm việc: ngữ cảnh đặt rõ → cookie của yêu cầu (nếu là công ty hợp lệ) → công ty chính. */
export async function currentCompanyId(): Promise<string> {
  const store = als.getStore();
  if (store) return store.companyId;
  try {
    const { cookies } = await import('next/headers');
    const v = (await cookies()).get(COMPANY_COOKIE)?.value;
    if (v && v !== MAIN_COMPANY && COMPANY_ID_RE.test(v) && (await knownCompanyIds()).has(v)) return v;
  } catch {
    /* ngoài yêu cầu HTTP (worker) */
  }
  return MAIN_COMPANY;
}

export function newId(): string {
  return new ObjectId().toHexString();
}

export function now(): string {
  return new Date().toISOString();
}

/** Danh sách collection – collection dùng chung lấy từ CSDL gốc. */
function collections(db: Db, root: Db): Collections {
  return {
    departments: db.collection<Department>('departments'),
    providers: root.collection<Provider>('providers'),
    workflows: db.collection<Workflow>('workflows'),
    projects: db.collection<Project>('projects'),
    tasks: db.collection<Task>('tasks'),
    messages: db.collection<Message>('messages'),
    approvals: db.collection<Approval>('approvals'),
    artifacts: db.collection<Artifact>('artifacts'),
    events: db.collection<AppEvent>('events'),
    settings: db.collection<Settings>('settings'),
    floors: db.collection<Floor>('floors'),
    companies: root.collection<Company>('companies'),
    goals: db.collection<Goal>('goals'),
    departmentRevisions: db.collection<DepartmentRevision>('department_revisions'),
    runs: db.collection<Run>('runs'),
    costEvents: db.collection<CostEvent>('cost_events'),
    budgetPolicies: db.collection<BudgetPolicy>('budget_policies'),
    budgetIncidents: db.collection<BudgetIncident>('budget_incidents'),
    routines: db.collection<Routine>('routines'),
    routineRuns: db.collection<RoutineRun>('routine_runs'),
    activity: db.collection<ActivityEntry>('activity'),
    secrets: db.collection<Secret>('secrets'),
    skills: db.collection<Skill>('skills'),
    documents: db.collection<IssueDocument>('documents'),
    documentRevisions: db.collection<DocumentRevision>('document_revisions'),
    documentThreads: db.collection<DocumentThread>('document_threads'),
    inboxState: db.collection<InboxState>('inbox_state'),
    chatConnectors: db.collection<ChatConnector>('chat_connectors'),
    mcpConnections: db.collection<McpConnection>('mcp_connections'),
    chatBindings: db.collection<ChatBinding>('chat_bindings'),
    evalSuites: db.collection<EvalSuite>('eval_suites'),
    evalRuns: db.collection<EvalRun>('eval_runs'),
    plugins: db.collection<InstalledPlugin>('plugins'),
    users: root.collection<User>('users'),
    meta: db.collection<Meta>('meta'),
  };
}

async function ensureIndexes(c: Collections) {
  await Promise.all([
    c.tasks.createIndex({ projectId: 1, createdAt: 1 }),
    c.tasks.createIndex({ status: 1, retryAt: 1 }),
    c.tasks.createIndex({ parentId: 1 }),
    c.tasks.createIndex({ departmentId: 1, status: 1 }),
    c.messages.createIndex({ projectId: 1, createdAt: 1 }),
    c.messages.createIndex({ taskId: 1, createdAt: 1 }),
    c.approvals.createIndex({ status: 1, createdAt: -1 }),
    c.approvals.createIndex({ taskId: 1 }),
    c.artifacts.createIndex({ projectId: 1, createdAt: -1 }),
    c.events.createIndex({ seq: 1 }),
    // Sự kiện realtime chỉ cần giữ 3 ngày.
    c.events.createIndex({ createdAtDate: 1 }, { expireAfterSeconds: 3 * 24 * 3600 }),
    c.projects.createIndex({ status: 1, updatedAt: -1 }),
    c.floors.createIndex({ projectId: 1 }),
    c.goals.createIndex({ parentId: 1, createdAt: 1 }),
    c.departmentRevisions.createIndex({ departmentId: 1, createdAt: -1 }),
    c.runs.createIndex({ taskId: 1, startedAt: -1 }),
    c.runs.createIndex({ status: 1, startedAt: -1 }),
    c.runs.createIndex({ startedAt: -1 }),
    c.costEvents.createIndex({ occurredAt: -1 }),
    c.costEvents.createIndex({ departmentId: 1, occurredAt: -1 }),
    c.costEvents.createIndex({ projectId: 1, occurredAt: -1 }),
    c.budgetIncidents.createIndex({ policyId: 1, windowStart: 1, threshold: 1 }, { unique: true }),
    c.routineRuns.createIndex({ routineId: 1, createdAt: -1 }),
    c.activity.createIndex({ createdAt: -1 }),
    c.activity.createIndex({ entityType: 1, entityId: 1, createdAt: -1 }),
    c.secrets.createIndex({ key: 1 }, { unique: true }),
    c.skills.createIndex({ key: 1 }, { unique: true }),
    c.tasks.createIndex({ identifier: 1 }),
    c.tasks.createIndex({ routineId: 1, status: 1 }),
    c.documents.createIndex({ taskId: 1, key: 1 }, { unique: true }),
    c.documents.createIndex({ projectId: 1 }),
    c.documentRevisions.createIndex({ documentId: 1, revision: -1 }),
    c.documentThreads.createIndex({ documentId: 1, createdAt: 1 }),
    c.documentThreads.createIndex({ taskId: 1, status: 1 }),
    c.chatBindings.createIndex({ connectorId: 1, chatId: 1 }, { unique: true }),
    c.chatBindings.createIndex({ projectId: 1, status: 1 }),
    c.mcpConnections.createIndex({ key: 1 }, { unique: true }),
    c.evalSuites.createIndex({ departmentId: 1, createdAt: 1 }),
    c.evalRuns.createIndex({ suiteId: 1, startedAt: -1 }),
    c.evalRuns.createIndex({ status: 1 }),
    c.users.createIndex({ email: 1 }, { unique: true }),
  ]);
}

async function seed(c: Collections, companyId: string) {
  const ts = now();
  if ((await c.departments.estimatedDocumentCount()) === 0) {
    await c.departments.insertMany(DEFAULT_DEPARTMENTS.map((d) => ({ ...d, createdAt: ts, updatedAt: ts })));
  }
  for (const wf of [DEFAULT_WORKFLOW, DIRECTOR_WORKFLOW]) {
    await c.workflows.updateOne({ _id: wf._id }, { $setOnInsert: { ...wf, updatedAt: ts } }, { upsert: true });
  }
  for (const f of DEFAULT_FLOORS) {
    await c.floors.updateOne({ _id: f._id }, { $setOnInsert: { ...f, updatedAt: ts } }, { upsert: true });
  }
  await c.settings.updateOne(
    { _id: 'global' },
    { $setOnInsert: { ...DEFAULT_SETTINGS, updatedAt: ts } },
    { upsert: true },
  );
  if (companyId !== MAIN_COMPANY) return;
  await importLegacyJson(c);
  // Dữ liệu từ bản trước (đã có dự án) → coi như đã thiết lập: tạo bản ghi công ty, không hiện màn hình thiết lập.
  if (!(await c.companies.findOne({ _id: MAIN_COMPANY })) && (await c.projects.estimatedDocumentCount()) > 0) {
    await c.companies.insertOne({ ...DEFAULT_COMPANY, onboardedAt: ts, createdAt: ts, updatedAt: ts });
  }
  // Đổi màu phòng ban từ bảng màu cũ sang bảng màu mới (chỉ khi người dùng chưa tự đổi màu).
  for (const d of DEFAULT_DEPARTMENTS) {
    const old = LEGACY_DEPARTMENT_COLORS[d._id];
    if (old) await c.departments.updateOne({ _id: d._id, color: old }, { $set: { color: d.color } });
  }
}

/** Nhập dữ liệu từ phiên bản cũ dùng tệp JSON (data/*.json) – chạy một lần. */
async function importLegacyJson(c: Collections) {
  const done = await c.meta.findOne({ _id: 'legacy-json-import' });
  if (done) return;
  const dataDir = path.join(process.cwd(), 'data');
  const imported: string[] = [];
  try {
    const raw = await fs.readFile(path.join(dataDir, 'projects.json'), 'utf-8');
    const legacy = JSON.parse(raw) as Array<Record<string, unknown>>;
    for (const p of legacy) {
      const id = String(p.id ?? newId());
      const exists = await c.projects.findOne({ _id: id });
      if (exists) continue;
      const ts = now();
      await c.projects.insertOne({
        _id: id,
        name: String(p.name ?? 'Dự án'),
        description: String(p.description ?? ''),
        goal: String(p.description ?? ''),
        path: null,
        status: p.status === 'completed' ? 'completed' : 'paused',
        workflowId: 'default',
        currentPhase: String(p.currentPhase ?? 'ideation'),
        phaseState: 'idle',
        phaseTaskId: null,
        approvals: {},
        phaseAttempts: {},
        phaseSummaries: {},
        completedPhases: [],
        autopilot: true,
        permission: 'write',
        createdAt: String(p.createdAt ?? ts),
        updatedAt: String(p.updatedAt ?? ts),
      });
      imported.push(id);
    }
  } catch {
    // Không có dữ liệu cũ – bỏ qua.
  }
  await c.meta.updateOne(
    { _id: 'legacy-json-import' },
    { $set: { value: { at: now(), projects: imported } } },
    { upsert: true },
  );
}

async function mongo(): Promise<MongoClient> {
  if (state.client) return state.client;
  state.connecting ??= (async () => {
    const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 5000, appName: 'vanphong-ai' });
    await client.connect();
    state.client = client;
    return client;
  })().catch((err) => {
    state.connecting = undefined;
    throw err;
  });
  return state.connecting;
}

/** "Phiên bản" danh sách collection – đổi khi thêm collection (dev server nạp lại module nhưng giữ globalThis). */
const SCHEMA_KEY = String(Object.keys(collections({ collection: () => null } as unknown as Db, { collection: () => null } as unknown as Db)).length);

async function init(companyId: string): Promise<Collections> {
  const client = await mongo();
  const c = collections(client.db(companyDbName(companyId)), client.db(MONGODB_DB));
  await ensureIndexes(c);
  await seed(c, companyId);
  return c;
}

/** Collections của một công ty cụ thể (kết nối + index + dữ liệu mặc định). */
export function companyCollections(companyId: string): Promise<Collections> {
  const id = COMPANY_ID_RE.test(companyId) ? companyId : MAIN_COMPANY;
  const map = (state.readyByCompany ??= new Map());
  const key = `${id}#${SCHEMA_KEY}`;
  let p = map.get(key);
  if (!p) {
    p = init(id).catch((err) => {
      map.delete(key);
      throw err;
    });
    map.set(key, p);
  }
  return p;
}

/** Collections của công ty đang làm việc (xem currentCompanyId). */
export async function getCollections(): Promise<Collections> {
  return companyCollections(await currentCompanyId());
}

/** Collections của công ty chính (CSDL gốc: danh sách công ty, tài khoản, kết nối AI, nhịp tim worker). */
export function getRootCollections(): Promise<Collections> {
  return companyCollections(MAIN_COMPANY);
}

/** Xoá hẳn CSDL của một công ty (không áp dụng cho công ty chính). */
export async function dropCompanyDb(companyId: string): Promise<void> {
  if (companyId === MAIN_COMPANY || !COMPANY_ID_RE.test(companyId)) throw new Error('Không xoá được công ty chính.');
  const client = await mongo();
  await client.db(companyDbName(companyId)).dropDatabase();
  for (const k of Array.from(state.readyByCompany?.keys() ?? [])) if (k.startsWith(`${companyId}#`)) state.readyByCompany!.delete(k);
  forgetCompanyCache();
}

export async function pingDb(): Promise<{ ok: boolean; message: string }> {
  try {
    await getCollections();
    await (await mongo()).db(MONGODB_DB).command({ ping: 1 });
    return { ok: true, message: 'Đã kết nối' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function nextSeq(name: string): Promise<number> {
  const c = await getCollections();
  const res = await c.meta.findOneAndUpdate(
    { _id: `seq:${name}` },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  return res?.seq ?? 1;
}

/** Ẩn URI có mật khẩu khi hiển thị. */
export function displayUri(): string {
  return MONGODB_URI.replace(/\/\/([^:@/]+):([^@/]+)@/, '//$1:***@');
}

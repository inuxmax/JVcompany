// Công ty, mục tiêu và màn hình thiết lập ban đầu (giống trình hướng dẫn "onboarding" của Paperclip).
import type { ChatQuestion, Company, Goal, GoalLevel, GoalStatus } from '../types';
import { DIRECTOR_WORKFLOW_ID } from '../catalog';
import { getTeam } from '../teams';
import { COMPANY_ID_RE, MAIN_COMPANY, companyCollections, companyDbName, currentCompanyId, dropCompanyDb, forgetCompanyCache, getCollections, getRootCollections, newId, now, runWithCompany } from './db';
import { emit } from './bus';
import { logActivity } from './activity';
import { DEFAULT_COMPANY, DEFAULT_DEPARTMENTS, EXTRA_DEPARTMENTS } from './seed';
import { createProject, getSettings, listDepartments, postMessage, updateProject, updateSettings } from './repo';
import { LocalizedError } from './http';
import { m } from '../i18n';

export async function getCompany(): Promise<Company | null> {
  const c = await getCollections();
  return c.companies.findOne({ _id: await currentCompanyId() });
}

/** Công ty luôn có (tạo bản mặc định nếu chưa có). */
export async function ensureCompany(): Promise<Company> {
  const existing = await getCompany();
  if (existing) return existing;
  const c = await getCollections();
  const id = await currentCompanyId();
  const ts = now();
  const company: Company = { ...DEFAULT_COMPANY, _id: id, onboardedAt: null, createdAt: ts, updatedAt: ts };
  await c.companies.updateOne({ _id: id }, { $setOnInsert: company }, { upsert: true });
  return (await getCompany())!;
}

export async function updateCompany(patch: Partial<Company>): Promise<Company> {
  await ensureCompany();
  const c = await getCollections();
  const { _id: _i, createdAt: _c, dbName: _d, ...rest } = patch;
  void _i;
  void _c;
  void _d;
  await c.companies.updateOne({ _id: await currentCompanyId() }, { $set: { ...rest, updatedAt: now() } });
  await emit('company.updated', null, {});
  return (await getCompany())!;
}

// ---------------- Nhiều công ty (mỗi công ty một toà nhà) ----------------

/** Mọi công ty (kể cả đã lưu trữ), công ty chính trước. */
export async function listCompanies(): Promise<Company[]> {
  const root = await getRootCollections();
  const rows = await root.companies.find().sort({ createdAt: 1 }).toArray();
  if (!rows.some((r) => r._id === MAIN_COMPANY)) {
    const ts = now();
    rows.unshift({ ...DEFAULT_COMPANY, _id: MAIN_COMPANY, onboardedAt: null, createdAt: ts, updatedAt: ts });
  }
  return rows.sort((a, b) => (a._id === MAIN_COMPANY ? -1 : b._id === MAIN_COMPANY ? 1 : a.createdAt.localeCompare(b.createdAt)));
}

/** Mã các công ty đang hoạt động (worker lặp qua các công ty này). */
export async function activeCompanyIds(): Promise<string[]> {
  const rows = await listCompanies();
  return rows.filter((r) => r.status !== 'archived').map((r) => r._id);
}

/** Bỏ dấu tiếng Việt, chữ thường, gạch ngang. */
function asciiSlug(name: string, max: number): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
}

/**
 * Tạo công ty mới = một toà nhà mới (CSDL riêng: phòng ban mẫu, 5 tầng, quy trình, cài đặt).
 * Kết nối AI dùng chung; công ty mới lấy kết nối mặc định của công ty đang làm việc. Lần đầu mở sẽ chạy màn hình thiết lập.
 */
export async function createCompany(name: string, opts: { mission?: string; issuePrefix?: string } = {}): Promise<Company> {
  const title = name.trim().slice(0, 80);
  if (!title) throw new LocalizedError(m('Nhập tên công ty'));
  const root = await getRootCollections();
  let base = asciiSlug(title, 24);
  if (!COMPANY_ID_RE.test(base) || base === MAIN_COMPANY) base = `cong-ty-${base || 'moi'}`.slice(0, 24).replace(/-+$/, '');
  let id = base;
  for (let i = 2; await root.companies.findOne({ _id: id }); i++) id = `${base}-${i}`;
  const fromSettings = await getSettings();
  const ts = now();
  const prefix =
    (opts.issuePrefix ?? asciiSlug(title, 40).split('-').map((w) => w[0] ?? '').join(''))
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 6) || 'CT';
  const company: Company = { ...DEFAULT_COMPANY, _id: id, name: title, mission: opts.mission?.trim() ?? '', issuePrefix: prefix, issueCounter: 0, dbName: companyDbName(id), onboardedAt: null, createdAt: ts, updatedAt: ts };
  await root.companies.insertOne(company);
  forgetCompanyCache();
  // Khởi tạo CSDL riêng + cài đặt ban đầu theo công ty đang làm việc
  await companyCollections(id);
  await runWithCompany(id, () =>
    updateSettings({
      defaultProviderId: fromSettings.defaultProviderId,
      defaultPermission: fromSettings.defaultPermission,
      computerControl: fromSettings.computerControl,
      setupDone: true,
    }),
  );
  await logActivity({ action: 'company.created', entityType: 'company', entityId: id, summary: `Tạo công ty ${title}` });
  await emit('company.updated', null, { id, created: true });
  return company;
}

export async function setCompanyStatus(id: string, status: Company['status']): Promise<Company | null> {
  if (id === MAIN_COMPANY && status === 'archived') throw new LocalizedError(m('Không lưu trữ được công ty chính.'));
  const root = await getRootCollections();
  await root.companies.updateOne({ _id: id }, { $set: { status, updatedAt: now() } });
  forgetCompanyCache();
  await logActivity({ action: status === 'archived' ? 'company.archived' : 'company.restored', entityType: 'company', entityId: id, summary: `${status === 'archived' ? 'Lưu trữ' : 'Mở lại'} công ty ${id}` });
  await emit('company.updated', null, { id });
  return root.companies.findOne({ _id: id });
}

/** Xoá hẳn một công ty đã lưu trữ (xoá CSDL riêng của công ty). */
export async function deleteCompany(id: string): Promise<void> {
  if (id === MAIN_COMPANY) throw new LocalizedError(m('Không xoá được công ty chính.'));
  const root = await getRootCollections();
  const company = await root.companies.findOne({ _id: id });
  if (!company) return;
  if (company.status !== 'archived') throw new LocalizedError(m('Lưu trữ công ty trước khi xoá hẳn.'));
  await dropCompanyDb(id);
  await root.companies.deleteOne({ _id: id });
  forgetCompanyCache();
  await logActivity({ action: 'company.deleted', entityType: 'company', entityId: id, summary: `Xoá hẳn công ty ${company.name}` });
  await emit('company.updated', null, { id, deleted: true });
}

/**
 * Cần hiện màn hình thiết lập: công ty chưa hoàn tất thiết lập (đang làm dở / bấm "Chạy lại thiết lập"),
 * hoặc chưa có công ty và chưa có dự án nào (cơ sở dữ liệu mới).
 */
export async function needsSetup(): Promise<boolean> {
  const company = await getCompany();
  if (company) return !company.onboardedAt;
  const c = await getCollections();
  return (await c.projects.countDocuments({}, { limit: 1 })) === 0;
}

// ---------------- Mục tiêu ----------------

export async function listGoals(): Promise<Goal[]> {
  const c = await getCollections();
  return c.goals.find().sort({ createdAt: 1 }).toArray();
}

export async function getGoal(id: string): Promise<Goal | null> {
  const c = await getCollections();
  return c.goals.findOne({ _id: id });
}

export async function createGoal(data: { title: string; description?: string; level?: GoalLevel; status?: GoalStatus; parentId?: string | null; ownerDepartmentId?: string | null }): Promise<Goal> {
  const c = await getCollections();
  const ts = now();
  const goal: Goal = {
    _id: newId(),
    title: data.title.trim(),
    description: data.description?.trim() ?? '',
    level: data.level ?? 'task',
    status: data.status ?? 'active',
    parentId: data.parentId ?? null,
    ownerDepartmentId: data.ownerDepartmentId ?? null,
    createdAt: ts,
    updatedAt: ts,
  };
  await c.goals.insertOne(goal);
  await emit('goal.updated', null, { id: goal._id });
  return goal;
}

export async function updateGoal(id: string, patch: Partial<Goal>): Promise<Goal | null> {
  const c = await getCollections();
  const { _id: _i, createdAt: _c, ...rest } = patch;
  void _i;
  void _c;
  // Không cho tạo vòng lặp cha–con
  if (rest.parentId) {
    let cur: string | null = rest.parentId;
    for (let i = 0; cur && i < 50; i++) {
      if (cur === id) throw new LocalizedError(m('Mục tiêu cha không được là chính nó hoặc mục tiêu con của nó.'));
      cur = (await c.goals.findOne({ _id: cur }))?.parentId ?? null;
    }
  }
  await c.goals.updateOne({ _id: id }, { $set: { ...rest, updatedAt: now() } });
  await emit('goal.updated', null, { id });
  return getGoal(id);
}

export async function deleteGoal(id: string): Promise<void> {
  const c = await getCollections();
  const goal = await getGoal(id);
  if (!goal) return;
  // Con của mục tiêu bị xoá chuyển lên cha của nó
  await c.goals.updateMany({ parentId: id }, { $set: { parentId: goal.parentId, updatedAt: now() } });
  await c.projects.updateMany({ goalIds: id }, { $pull: { goalIds: id } });
  await c.goals.deleteOne({ _id: id });
  await emit('goal.updated', null, { id, deleted: true });
}

/** Mục tiêu mặc định của công ty: mục tiêu gốc cấp công ty đang hoạt động, lâu nhất. */
export async function defaultCompanyGoal(): Promise<Goal | null> {
  const c = await getCollections();
  return (
    (await c.goals.findOne({ level: 'company', parentId: null, status: 'active' }, { sort: { createdAt: 1 } })) ??
    (await c.goals.findOne({ level: 'company', parentId: null, status: { $ne: 'cancelled' } }, { sort: { createdAt: 1 } }))
  );
}

/** Chuỗi mục tiêu từ một mục tiêu lên tới gốc (để agent biết "vì sao"). */
export async function goalAncestry(goalId: string | null | undefined): Promise<Goal[]> {
  const out: Goal[] = [];
  let cur = goalId ?? null;
  for (let i = 0; cur && i < 8; i++) {
    const g = await getGoal(cur);
    if (!g) break;
    out.push(g);
    cur = g.parentId;
  }
  return out;
}

// ---------------- Thiết lập ban đầu ----------------

/** Bước 1: tên công ty + sứ mệnh (dòng đầu của sứ mệnh thành mục tiêu gốc của công ty). */
export async function setupCompany(name: string, mission: string): Promise<Company> {
  const company = await updateCompany({ name: name.trim(), mission: mission.trim() });
  const m = mission.trim();
  if (m) {
    const [first, ...rest] = m.split(/\r?\n/);
    const root = await defaultCompanyGoal();
    if (root) await updateGoal(root._id, { title: first.trim().slice(0, 200), description: rest.join('\n').trim() });
    else await createGoal({ title: first.trim().slice(0, 200), description: rest.join('\n').trim(), level: 'company', status: 'active' });
  }
  return company;
}

/**
 * Bước 2 / cài đội mẫu: bật các phòng trong đội (tạo phòng còn thiếu từ danh mục phòng mẫu).
 * `exclusive` = đội đầu tiên của công ty → tắt các phòng không thuộc đội.
 */
export async function applyTeam(teamId: string, opts: { exclusive?: boolean; leadTitle?: string } = {}): Promise<{ enabled: string[]; created: string[] }> {
  const team = getTeam(teamId);
  if (!team) throw new LocalizedError(m('Không tìm thấy đội mẫu'), undefined, 404);
  const c = await getCollections();
  const ts = now();
  const created: string[] = [];
  for (const id of team.departments) {
    if (await c.departments.findOne({ _id: id })) continue;
    const seed = [...DEFAULT_DEPARTMENTS, ...EXTRA_DEPARTMENTS].find((d) => d._id === id);
    if (!seed) continue;
    await c.departments.insertOne({ ...seed, createdAt: ts, updatedAt: ts });
    created.push(id);
  }
  await c.departments.updateMany({ _id: { $in: team.departments } }, { $set: { enabled: true, updatedAt: ts } });
  if (opts.exclusive) await c.departments.updateMany({ _id: { $nin: team.departments } }, { $set: { enabled: false, updatedAt: ts } });
  if (opts.leadTitle?.trim()) await c.departments.updateOne({ _id: team.lead }, { $set: { title: opts.leadTitle.trim(), updatedAt: ts } });
  await emit('department.updated', null, { team: teamId });
  return { enabled: team.departments, created };
}

const OPENING: ChatQuestion = {
  prompt: 'Bạn muốn bắt đầu thế nào?',
  options: [
    { id: 'interview', label: 'Phỏng vấn tôi rồi đề xuất kế hoạch và đội ngũ để thực hiện' },
    { id: 'task', label: 'Tôi đã có việc cụ thể', freeText: true, placeholder: 'Mô tả việc cần làm…' },
  ],
};

/**
 * Bước cuối: tạo dự án "Làm quen" giao cho giám đốc, lời chào + câu hỏi mở đầu (chưa đánh thức agent –
 * agent bắt đầu khi bạn trả lời), đánh dấu đã thiết lập.
 */
export async function finishSetup(): Promise<{ projectId: string }> {
  const company = await ensureCompany();
  const settings = await getSettings();
  const depts = await listDepartments();
  const lead = depts.find((d) => d._id === 'director' && d.enabled) ?? depts.find((d) => d.enabled);
  const root = await defaultCompanyGoal();
  const c = await getCollections();
  const existing = await c.projects.findOne({ onboarding: true });
  let projectId = existing?._id;
  if (!projectId) {
    const project = await createProject({
      name: 'Làm quen',
      description: [
        `Buổi làm quen đầu tiên của ${company.name}.`,
        'Nếu chủ công ty chọn "Phỏng vấn tôi": hỏi 3–5 câu ngắn về mục tiêu, người dùng, ưu tiên và nguồn lực; sau khi có câu trả lời thì đề xuất kế hoạch + đội ngũ (phòng ban nào làm gì), chờ chủ công ty đồng ý rồi mới giao việc.',
        'Nếu chủ công ty đưa việc cụ thể: lập kế hoạch ngắn và giao việc ngay cho đúng phòng.',
      ].join('\n'),
      goal: root?.title ?? company.mission,
      path: null,
      autopilot: true,
      permission: settings.defaultPermission,
      workflowId: DIRECTOR_WORKFLOW_ID,
    });
    projectId = project._id;
    await updateProject(projectId, { onboarding: true, ...(root ? { goalIds: [root._id] } : {}) });
    await postMessage({
      projectId,
      taskId: null,
      author: lead ? { type: 'agent', departmentId: lead._id, name: lead.name } : { type: 'system' },
      kind: 'chat',
      content: `Chào mừng bạn đến với **${company.name}**! Tôi là ${lead?.title || lead?.name || 'giám đốc'}, người đồng hành đầu tiên của bạn. Chọn cách bắt đầu bên dưới, tôi sẽ lo phần còn lại.`,
      meta: { question: OPENING },
    });
  }
  await updateCompany({ onboardedAt: now() });
  return { projectId };
}

/** Dự án làm quen có câu hỏi mở đầu chưa trả lời → id của dự án (để mở đúng cuộc trò chuyện sau khi thiết lập). */
export async function onboardingProjectId(): Promise<string | null> {
  const c = await getCollections();
  return (await c.projects.findOne({ onboarding: true }, { projection: { _id: 1 } }))?._id ?? null;
}


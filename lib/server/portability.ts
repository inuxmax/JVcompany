// Xuất / nhập công ty (giống "company portability" của Paperclip): gói JSON gồm công ty, mục tiêu, phòng ban,
// quy trình, kỹ năng, lịch định kỳ – xoá bí mật, đường dẫn riêng của máy, id cơ sở dữ liệu kết nối.
import type { Company, Department, Goal, Routine, Skill, Workflow } from '../types';
import { getCollections, newId, now } from './db';
import { emit } from './bus';
import { logActivity } from './activity';
import { ensureCompany, updateCompany } from './company';

const SENSITIVE = /(_key|_token|secret|password|passwd|auth|bearer|jwt|credential|private_key|cookie|connectionstring|apikey)$/i;

export interface EnvInput {
  key: string;
  department: string;
  kind: 'secret' | 'plain';
  defaultValue: string;
  portability: 'portable' | 'system_dependent';
}

export interface CompanyPackage {
  format: 'jv-company/v1';
  exportedAt: string;
  company: Pick<Company, 'name' | 'mission' | 'issuePrefix' | 'budgetMonthlyUsd' | 'requireApprovalForNewAgents'>;
  goals: Omit<Goal, 'createdAt' | 'updatedAt'>[];
  departments: Omit<Department, 'createdAt' | 'updatedAt' | 'providerId' | 'fallbackProviderIds' | 'lastHeartbeatAt'>[];
  workflows: Omit<Workflow, 'updatedAt'>[];
  skills: Pick<Skill, 'key' | 'name' | 'description' | 'markdown' | 'source'>[];
  routines: Omit<Routine, 'webhookSecret' | 'createdAt' | 'updatedAt' | 'lastTriggeredAt'>[];
  envInputs: EnvInput[];
  projects?: { name: string; description: string; goal: string; status: string }[];
  /** Những gì KHÔNG có trong gói. */
  notIncluded: string[];
}

/** Biến môi trường của phòng → giữ tên, xoá giá trị nhạy cảm, đánh dấu đường dẫn phụ thuộc máy. */
function scrubEnv(dept: Department, inputs: EnvInput[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(dept.env ?? {})) {
    if (k === 'PATH') continue;
    const secret = v.startsWith('secret:') || SENSITIVE.test(k);
    const local = /^([a-zA-Z]:\\|\/(home|Users|mnt|opt|var)\/)/.test(v);
    inputs.push({ key: k, department: dept._id, kind: secret ? 'secret' : 'plain', defaultValue: secret ? '' : v, portability: local ? 'system_dependent' : 'portable' });
    out[k] = secret ? '' : v;
  }
  return out;
}

export async function exportCompany(opts: { withProjects?: boolean } = {}): Promise<CompanyPackage> {
  const c = await getCollections();
  const company = await ensureCompany();
  const [goals, depts, workflows, skills, routines, projects] = await Promise.all([
    c.goals.find().toArray(),
    c.departments.find().sort({ order: 1 }).toArray(),
    c.workflows.find().toArray(),
    c.skills.find({ 'source.type': { $ne: 'builtin' } }).toArray(),
    c.routines.find({ status: { $ne: 'archived' } }).toArray(),
    opts.withProjects ? c.projects.find({ internal: { $ne: true } }).toArray() : Promise.resolve([]),
  ]);
  const envInputs: EnvInput[] = [];
  const pkg: CompanyPackage = {
    format: 'jv-company/v1',
    exportedAt: now(),
    company: { name: company.name, mission: company.mission, issuePrefix: company.issuePrefix, budgetMonthlyUsd: company.budgetMonthlyUsd, requireApprovalForNewAgents: company.requireApprovalForNewAgents },
    goals: goals.map(({ createdAt: _c, updatedAt: _u, ...g }) => (void _c, void _u, g)),
    departments: depts.map((d) => {
      const { createdAt: _c, updatedAt: _u, providerId: _p, fallbackProviderIds: _f, lastHeartbeatAt: _h, ...rest } = d;
      void _c;
      void _u;
      void _p;
      void _f;
      void _h;
      return { ...rest, env: scrubEnv(d, envInputs) };
    }),
    workflows: workflows.map(({ updatedAt: _u, ...w }) => (void _u, w)),
    skills: skills.map((s) => ({ key: s.key, name: s.name, description: s.description, markdown: s.markdown, source: s.source.type === 'path' ? { type: 'manual' as const } : s.source })),
    routines: routines.map((r) => {
      const { webhookSecret: _s, createdAt: _c, updatedAt: _u, lastTriggeredAt: _l, ...rest } = r;
      void _s;
      void _c;
      void _u;
      void _l;
      return { ...rest, triggers: rest.triggers.map((t) => ({ ...t, nextRunAt: null, lastFiredAt: null, publicId: undefined })) };
    }),
    envInputs,
    ...(opts.withProjects ? { projects: projects.map((p) => ({ name: p.name, description: p.description, goal: p.goal, status: p.status })) } : {}),
    notIncluded: ['Kết nối AI và API key', 'Giá trị kho bí mật', 'Lịch sử chat, nhiệm vụ, lượt chạy, chi phí, nhật ký', 'Thư mục dự án trên máy'],
  };
  await logActivity({ action: 'company.exported', entityType: 'company', entityId: 'main', summary: `Xuất gói công ty (${depts.length} phòng, ${skills.length} kỹ năng, ${routines.length} lịch)` });
  return pkg;
}

export interface ImportReport {
  applied: boolean;
  departments: { id: string; name: string; action: 'create' | 'rename' | 'skip' | 'replace'; newId?: string }[];
  skills: { key: string; action: 'create' | 'rename' | 'skip' | 'replace' }[];
  goals: number;
  routines: number;
  workflows: { id: string; action: 'create' | 'skip' | 'replace' }[];
  envInputs: EnvInput[];
}

/**
 * Nhập gói: xem trước (apply=false) hoặc áp dụng. Trùng id/khoá: đổi tên / bỏ qua / thay thế.
 * Sau khi nhập: heartbeat tắt, lịch định kỳ tạm dừng (bạn bật lại khi đã kiểm tra).
 */
export async function importCompany(pkg: CompanyPackage, opts: { strategy: 'rename' | 'skip' | 'replace'; apply: boolean }): Promise<ImportReport> {
  const c = await getCollections();
  const report: ImportReport = { applied: opts.apply, departments: [], skills: [], goals: pkg.goals?.length ?? 0, routines: pkg.routines?.length ?? 0, workflows: [], envInputs: pkg.envInputs ?? [] };
  const ts = now();
  const idMap = new Map<string, string>();

  for (const d of pkg.departments ?? []) {
    const exists = await c.departments.findOne({ _id: d._id });
    let action: ImportReport['departments'][number]['action'] = exists ? opts.strategy : 'create';
    let id = d._id;
    if (exists && opts.strategy === 'rename') {
      for (let i = 2; await c.departments.findOne({ _id: `${d._id}-${i}` }); i++) id = `${d._id}-${i + 1}`;
      if (id === d._id) id = `${d._id}-2`;
      action = 'rename';
    }
    idMap.set(d._id, action === 'skip' ? d._id : id);
    report.departments.push({ id: d._id, name: d.name, action, ...(id !== d._id ? { newId: id } : {}) });
  }
  for (const s of pkg.skills ?? []) {
    const exists = await c.skills.findOne({ key: s.key });
    report.skills.push({ key: s.key, action: exists ? opts.strategy : 'create' });
  }
  for (const w of pkg.workflows ?? []) {
    const exists = await c.workflows.findOne({ _id: w._id });
    report.workflows.push({ id: w._id, action: exists ? (opts.strategy === 'replace' ? 'replace' : 'skip') : 'create' });
  }
  if (!opts.apply) return report;

  // Công ty: chỉ điền những gì đang trống
  const company = await ensureCompany();
  await updateCompany({ mission: company.mission || pkg.company?.mission || '', requireApprovalForNewAgents: pkg.company?.requireApprovalForNewAgents ?? company.requireApprovalForNewAgents });

  const remap = (id: string | null | undefined) => (id ? (idMap.get(id) ?? id) : id);
  for (const d of pkg.departments ?? []) {
    const r = report.departments.find((x) => x.id === d._id)!;
    if (r.action === 'skip') continue;
    const id = r.newId ?? d._id;
    const doc: Department = {
      ...(d as Department),
      _id: id,
      name: r.action === 'rename' ? `${d.name} (nhập)` : d.name,
      reportsTo: remap(d.reportsTo) ?? null,
      canDelegateTo: (d.canDelegateTo ?? []).map((x) => remap(x)!),
      providerId: null,
      fallbackProviderIds: [],
      heartbeat: d.heartbeat ? { ...d.heartbeat, enabled: false } : undefined,
      status: 'active',
      createdAt: ts,
      updatedAt: ts,
    };
    await c.departments.replaceOne({ _id: id }, doc, { upsert: true });
  }
  for (const s of pkg.skills ?? []) {
    const r = report.skills.find((x) => x.key === s.key)!;
    if (r.action === 'skip') continue;
    const key = r.action === 'rename' ? `${s.key}-nhap` : s.key;
    const existing = await c.skills.findOne({ key });
    const doc: Skill = { _id: existing?._id ?? newId(), key, name: s.name, description: s.description, markdown: s.markdown, source: s.source ?? { type: 'manual' }, currentVersion: (existing?.currentVersion ?? 0) + 1, versions: [...(existing?.versions ?? []), { version: (existing?.currentVersion ?? 0) + 1, markdown: s.markdown, note: 'Nhập từ gói', createdAt: ts }], createdAt: existing?.createdAt ?? ts, updatedAt: ts };
    await c.skills.replaceOne({ key }, doc, { upsert: true });
  }
  for (const w of pkg.workflows ?? []) {
    const r = report.workflows.find((x) => x.id === w._id)!;
    if (r.action === 'skip') continue;
    await c.workflows.replaceOne({ _id: w._id }, { ...w, updatedAt: ts } as Workflow, { upsert: true });
  }
  const goalMap = new Map<string, string>();
  for (const g of pkg.goals ?? []) goalMap.set(g._id, newId());
  for (const g of pkg.goals ?? []) {
    await c.goals.insertOne({ ...g, _id: goalMap.get(g._id)!, parentId: g.parentId ? (goalMap.get(g.parentId) ?? null) : null, ownerDepartmentId: remap(g.ownerDepartmentId) ?? null, createdAt: ts, updatedAt: ts });
  }
  for (const r of pkg.routines ?? []) {
    await c.routines.insertOne({ ...r, _id: newId(), departmentId: remap(r.departmentId)!, projectId: null, status: 'paused', triggers: r.triggers.map((t) => ({ ...t, id: newId() })), revision: 1, lastTriggeredAt: null, createdAt: ts, updatedAt: ts });
  }
  await logActivity({ action: 'company.imported', entityType: 'company', entityId: 'main', summary: `Nhập gói công ty: ${report.departments.filter((d) => d.action !== 'skip').length} phòng, ${report.skills.length} kỹ năng, ${report.goals} mục tiêu, ${report.routines} lịch (đang tạm dừng)` });
  await emit('department.updated', null, {});
  return report;
}

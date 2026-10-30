// Kỹ năng (SKILL.md): viết tay / tải từ URL, GitHub, thư mục; có phiên bản; gán cho phòng ban; đưa vào lượt chạy của agent.
import fs from 'fs/promises';
import path from 'path';
import type { Skill } from '../types';
import { currentCompanyId, getCollections, newId, now } from './db';
import { appDataDir } from './platform';
import { emit } from './bus';
import { logActivity } from './activity';
import { LocalizedError } from './http';
import { m } from '../i18n';

export const SKILL_KEY_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

/** Kỹ năng có sẵn: quy trình làm việc của JVCompany. */
export const BUILTIN_SKILLS: Omit<Skill, '_id' | 'createdAt' | 'updatedAt' | 'versions'>[] = [
  {
    key: 'quy-trinh-jvcompany',
    name: 'Quy trình JVCompany',
    description: 'Dùng ở MỌI nhiệm vụ: cách nhận việc, giao việc, bàn giao, báo cáo và nộp kết quả trong công ty.',
    markdown: `---
name: Quy trình JVCompany
description: Cách nhận việc, giao việc, bàn giao, báo cáo và nộp kết quả trong công ty.
---

# Quy trình làm việc

1. **Đọc bối cảnh trước**: mục tiêu công ty → mục tiêu dự án → nhiệm vụ cha → nhiệm vụ của bạn. Làm đúng phần việc của phòng mình.
2. **Đã có kế hoạch thì làm tiếp**, không khảo sát lại từ đầu. Đọc báo cáo của phòng trước (mục "Bàn giao") rồi tiếp tục.
3. **Giao việc** chỉ khi phòng khác chuyên môn hơn. Mỗi việc giao có: mục tiêu, bối cảnh, đầu ra, tiêu chí xong, quyền vừa đủ.
4. **Chuỗi bàn giao**: đặt "step"/"after" để phòng sau tự nhận kết quả của phòng trước.
5. **Sản phẩm công việc**: ghi lại link PR, commit, nhánh, trang xem trước trong "work_products".
6. **Cần chủ công ty quyết định** (không tự giả định được): dùng "question" với 2–4 lựa chọn rõ ràng.
7. **Báo cáo** cuối việc: đã làm gì, kết quả, rủi ro còn lại, việc tiếp theo đề xuất.
`,
    source: { type: 'builtin' },
    currentVersion: 1,
  },
];

export async function ensureBuiltinSkills(): Promise<void> {
  const c = await getCollections();
  const ts = now();
  for (const s of BUILTIN_SKILLS) {
    await c.skills.updateOne(
      { key: s.key },
      { $setOnInsert: { ...s, _id: newId(), versions: [{ version: 1, markdown: s.markdown, createdAt: ts }], createdAt: ts, updatedAt: ts } },
      { upsert: true },
    );
  }
}

export async function listSkills(): Promise<Skill[]> {
  await ensureBuiltinSkills();
  const c = await getCollections();
  return c.skills.find({}, { projection: { versions: 0 } }).sort({ name: 1 }).toArray();
}

export async function getSkill(id: string): Promise<Skill | null> {
  const c = await getCollections();
  return c.skills.findOne({ _id: id });
}

/** Tên + mô tả từ phần đầu (front matter) của SKILL.md. */
export function parseFrontMatter(md: string): { name?: string; description?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (!m) return {};
  const get = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(m[1])?.[1]?.trim().replace(/^["']|["']$/g, '');
  return { name: get('name'), description: get('description') };
}

function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export async function saveSkill(data: { _id?: string; key?: string; name?: string; description?: string; markdown: string; source?: Skill['source']; note?: string }): Promise<Skill> {
  const c = await getCollections();
  const fm = parseFrontMatter(data.markdown);
  const name = (data.name || fm.name || 'Kỹ năng mới').trim();
  const description = (data.description || fm.description || '').trim();
  const ts = now();
  if (data._id) {
    const s = await c.skills.findOne({ _id: data._id });
    if (!s) throw new LocalizedError(m('Không tìm thấy kỹ năng'), undefined, 404);
    const changed = s.markdown !== data.markdown;
    const version = changed ? s.currentVersion + 1 : s.currentVersion;
    const versions = changed ? [...(s.versions ?? []), { version, markdown: data.markdown, note: data.note, createdAt: ts }].slice(-30) : s.versions;
    await c.skills.updateOne({ _id: s._id }, { $set: { name, description, markdown: data.markdown, currentVersion: version, versions, updatedAt: ts } });
    await logActivity({ action: 'skill.updated', entityType: 'skill', entityId: s._id, summary: `Sửa kỹ năng "${name}"${changed ? ` (phiên bản ${version})` : ''}` });
    await emit('skill.updated', null, { id: s._id });
    return (await c.skills.findOne({ _id: s._id }))!;
  }
  let key = (data.key || slug(name) || 'ky-nang').slice(0, 60);
  if (!SKILL_KEY_RE.test(key)) key = `ky-nang-${Date.now().toString(36)}`;
  for (let i = 2; await c.skills.findOne({ key }); i++) key = `${key.replace(/-\d+$/, '')}-${i}`;
  const skill: Skill = {
    _id: newId(),
    key,
    name,
    description,
    markdown: data.markdown,
    source: data.source ?? { type: 'manual' },
    currentVersion: 1,
    versions: [{ version: 1, markdown: data.markdown, createdAt: ts }],
    createdAt: ts,
    updatedAt: ts,
  };
  await c.skills.insertOne(skill);
  await logActivity({ action: 'skill.created', entityType: 'skill', entityId: skill._id, summary: `Thêm kỹ năng "${name}"` });
  await emit('skill.updated', null, { id: skill._id });
  return skill;
}

/** Khôi phục một phiên bản cũ (tạo phiên bản mới có nội dung đó). */
export async function restoreSkillVersion(id: string, version: number): Promise<Skill> {
  const s = await getSkill(id);
  const v = s?.versions?.find((x) => x.version === version);
  if (!s || !v) throw new LocalizedError(m('Không tìm thấy phiên bản'), undefined, 404);
  return saveSkill({ _id: id, markdown: v.markdown, note: `Khôi phục phiên bản ${version}` });
}

export async function deleteSkill(id: string): Promise<void> {
  const c = await getCollections();
  const s = await c.skills.findOne({ _id: id });
  if (!s) return;
  if (s.source.type === 'builtin') throw new LocalizedError(m('Không xoá được kỹ năng có sẵn.'));
  await c.skills.deleteOne({ _id: id });
  await c.departments.updateMany({ skills: s.key }, { $pull: { skills: s.key } });
  await logActivity({ action: 'skill.deleted', entityType: 'skill', entityId: id, summary: `Xoá kỹ năng "${s.name}"` });
  await emit('skill.updated', null, { id, deleted: true });
}

/** Đổi link GitHub (trang xem tệp / thư mục) sang link tải nội dung thô của SKILL.md. */
export function githubRaw(url: string): string {
  const u = url.trim();
  const blob = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/.exec(u);
  if (blob) return `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}/${blob[4]}`;
  const tree = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+?)\/?$/.exec(u);
  if (tree) return `https://raw.githubusercontent.com/${tree[1]}/${tree[2]}/${tree[3]}/${tree[4]}/SKILL.md`;
  return u;
}

/** Nhập kỹ năng từ URL (kể cả GitHub) hoặc thư mục / tệp trên máy. */
export async function importSkill(locator: string): Promise<Skill> {
  const loc = locator.trim();
  let markdown: string;
  let source: Skill['source'];
  if (/^https?:\/\//i.test(loc)) {
    const url = githubRaw(loc);
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new LocalizedError(m('Không tải được {url} (HTTP {status}).'), { url, status: res.status });
    markdown = await res.text();
    source = { type: /github\.com|githubusercontent/.test(url) ? 'github' : 'url', locator: loc };
  } else {
    let file = loc;
    try {
      if ((await fs.stat(loc)).isDirectory()) file = path.join(loc, 'SKILL.md');
    } catch {
      throw new LocalizedError(m('Không tìm thấy "{path}".'), { path: loc }, 404);
    }
    markdown = await fs.readFile(file, 'utf8');
    source = { type: 'path', locator: loc };
  }
  if (markdown.length > 200_000) throw new LocalizedError(m('Tệp kỹ năng quá lớn (tối đa 200 KB).'));
  return saveSkill({ markdown, source });
}

/**
 * Ghi các kỹ năng của phòng ra một thư mục gói (.claude/skills/<khoá>/SKILL.md) để agent CLI đọc,
 * trả về thư mục gói và danh sách kỹ năng (kèm đường dẫn tệp) để đưa vào prompt.
 */
export async function materializeSkills(departmentId: string, keys: string[] | undefined): Promise<{ dir: string | null; skills: { key: string; name: string; description: string; path: string }[] }> {
  await ensureBuiltinSkills();
  const c = await getCollections();
  const wanted = Array.from(new Set(['quy-trinh-jvcompany', ...(keys ?? [])]));
  const rows = await c.skills.find({ key: { $in: wanted } }, { projection: { versions: 0 } }).toArray();
  if (!rows.length) return { dir: null, skills: [] };
  // Công ty khác có thể trùng mã phòng (vd "director") → gói kỹ năng tách theo công ty
  const companyId = await currentCompanyId();
  const dir = companyId === 'main' ? path.join(appDataDir(), 'skill-bundles', departmentId) : path.join(appDataDir(), 'skill-bundles', companyId, departmentId);
  const skillsDir = path.join(dir, '.claude', 'skills');
  await fs.rm(skillsDir, { recursive: true, force: true });
  const out: { key: string; name: string; description: string; path: string }[] = [];
  for (const s of rows) {
    const d = path.join(skillsDir, s.key);
    await fs.mkdir(d, { recursive: true });
    const md = s.markdown.startsWith('---') ? s.markdown : `---\nname: ${s.name}\ndescription: ${s.description}\n---\n\n${s.markdown}`;
    const file = path.join(d, 'SKILL.md');
    await fs.writeFile(file, md, 'utf8');
    out.push({ key: s.key, name: s.name, description: s.description, path: file });
  }
  return { dir, skills: out };
}

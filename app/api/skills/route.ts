import { importSkill, listSkills, saveSkill } from '@/lib/server/skills';
import { listDepartments } from '@/lib/server/repo';
import { fail, failFrom, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

export const GET = route(async () => {
  const [skills, depts] = await Promise.all([listSkills(), listDepartments()]);
  return ok(skills.map((s) => ({ ...s, departments: depts.filter((d) => d.skills?.includes(s.key) || s.key === 'quy-trinh-jvcompany').map((d) => d._id) })));
});

/** { markdown, name?, description? } = viết tay; { locator } = nhập từ URL / GitHub / thư mục trên máy. */
export const POST = route(async (req: Request) => {
  const body = await readJson<{ markdown?: string; name?: string; description?: string; locator?: string }>(req);
  try {
    if (body.locator?.trim()) return ok(await importSkill(body.locator), 201);
    if (!body.markdown?.trim()) return fail(m('Nhập nội dung SKILL.md'));
    return ok(await saveSkill({ markdown: body.markdown, name: body.name, description: body.description }), 201);
  } catch (err) {
    return failFrom(err);
  }
});

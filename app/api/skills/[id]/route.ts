import { deleteSkill, getSkill, restoreSkillVersion, saveSkill } from '@/lib/server/skills';
import { getCollections } from '@/lib/server/db';
import { emit } from '@/lib/server/bus';
import { type Ctx, fail, failFrom, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const s = await getSkill(id);
  return s ? ok(s) : fail(m('Không tìm thấy kỹ năng'), 404);
});

/** { markdown, name?, description?, note? } = lưu phiên bản mới; { restore: n } = khôi phục; { departments: [...] } = gán cho phòng. */
export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson<{ markdown?: string; name?: string; description?: string; note?: string; restore?: number; departments?: string[] }>(req);
  const s = await getSkill(id);
  if (!s) return fail(m('Không tìm thấy kỹ năng'), 404);
  try {
    if (body.restore) return ok(await restoreSkillVersion(id, Number(body.restore)));
    if (body.departments) {
      const c = await getCollections();
      await c.departments.updateMany({ _id: { $in: body.departments } }, { $addToSet: { skills: s.key } });
      await c.departments.updateMany({ _id: { $nin: body.departments } }, { $pull: { skills: s.key } });
      await emit('department.updated', null, { skill: s.key });
      return ok(s);
    }
    return ok(await saveSkill({ _id: id, markdown: body.markdown ?? s.markdown, name: body.name, description: body.description, note: body.note }));
  } catch (err) {
    return failFrom(err);
  }
});

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  try {
    await deleteSkill(id);
    return ok({ ok: true });
  } catch (err) {
    return failFrom(err);
  }
});

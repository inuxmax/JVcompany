import { deleteCompany, setCompanyStatus } from '@/lib/server/company';
import { getRootCollections, now } from '@/lib/server/db';
import { emit } from '@/lib/server/bus';
import { type Ctx, fail, failFrom, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';
import type { Company } from '@/lib/types';

/** Đổi tên / lưu trữ / mở lại một công ty. */
export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson<{ name?: string; status?: Company['status'] }>(req);
  const root = await getRootCollections();
  if (!(await root.companies.findOne({ _id: id }))) return fail(m('Không tìm thấy công ty'), 404);
  try {
    if (body.name?.trim()) {
      await root.companies.updateOne({ _id: id }, { $set: { name: body.name.trim().slice(0, 80), updatedAt: now() } });
      await emit('company.updated', null, { id });
    }
    if (body.status === 'archived' || body.status === 'active') await setCompanyStatus(id, body.status);
    return ok(await root.companies.findOne({ _id: id }));
  } catch (err) {
    return failFrom(err);
  }
});

/** Xoá hẳn công ty đã lưu trữ (xoá toàn bộ dữ liệu của công ty đó). */
export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  try {
    await deleteCompany(id);
    return ok({ ok: true });
  } catch (err) {
    return failFrom(err);
  }
});

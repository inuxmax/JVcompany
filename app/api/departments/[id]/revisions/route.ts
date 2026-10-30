import { listDepartmentRevisions, rollbackDepartment } from '@/lib/server/repo';
import { logActivity } from '@/lib/server/activity';
import { type Ctx, fail, failFrom, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

/** Lịch sử cấu hình của phòng ban. */
export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return ok(await listDepartmentRevisions(id));
});

/** Khôi phục về trạng thái trước một lần sửa: { revisionId }. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { revisionId } = await readJson<{ revisionId?: string }>(req);
  if (!revisionId) return fail(m('Thiếu bản ghi cần khôi phục'));
  try {
    const d = await rollbackDepartment(revisionId);
    await logActivity({ action: 'department.config_rolled_back', entityType: 'department', entityId: id, summary: `Khôi phục cấu hình ${d?.name ?? id}` });
    return ok(d);
  } catch (err) {
    return failFrom(err);
  }
});

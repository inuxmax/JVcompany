import { getTask } from '@/lib/server/repo';
import { DocConflictError, listTaskDocuments, saveDocument } from '@/lib/server/documents';
import { userAuthor } from '@/lib/server/auth';
import { type Ctx, fail, failFrom, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

/** Tài liệu của nhiệm vụ (kèm số bình luận đang mở). */
export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return ok(await listTaskDocuments(id));
});

/** Tạo tài liệu mới (hoặc ghi phiên bản mới nếu khoá đã có). */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!(await getTask(id))) return fail(m('Không tìm thấy nhiệm vụ'), 404);
  const body = await readJson<{ key?: string; title?: string; body?: string; changeSummary?: string; baseRevision?: number }>(req);
  if (!body.title?.trim() && !body.key?.trim()) return fail(m('Nhập tiêu đề tài liệu'));
  try {
    const r = await saveDocument({ taskId: id, key: body.key, title: body.title, body: body.body ?? '', changeSummary: body.changeSummary, author: await userAuthor(), baseRevision: body.baseRevision ?? null });
    return ok(r.document, r.created ? 201 : 200);
  } catch (err) {
    if (err instanceof DocConflictError) return failFrom(err, 409);
    throw err;
  }
});

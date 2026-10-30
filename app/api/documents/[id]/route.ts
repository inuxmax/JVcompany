import { DocConflictError, deleteDocument, getDocument, getDocumentBundle, restoreRevision, saveDocument } from '@/lib/server/documents';
import { userAuthor } from '@/lib/server/auth';
import { type Ctx, fail, failFrom, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

/** Tài liệu kèm các phiên bản và luồng bình luận. */
export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const bundle = await getDocumentBundle(id);
  if (!bundle) return fail(m('Không tìm thấy tài liệu'), 404);
  return ok(bundle);
});

/** save: ghi phiên bản mới (kèm baseRevision để phát hiện xung đột) · restore: khôi phục một phiên bản cũ. */
export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const doc = await getDocument(id);
  if (!doc) return fail(m('Không tìm thấy tài liệu'), 404);
  const body = await readJson<{ action?: string; title?: string; body?: string; changeSummary?: string; baseRevision?: number; revision?: number }>(req);
  try {
    if (body.action === 'restore') {
      if (!body.revision) return fail(m('Chọn phiên bản cần khôi phục'));
      return ok(await restoreRevision(id, Number(body.revision), await userAuthor()));
    }
    const r = await saveDocument({ taskId: doc.taskId, key: doc.key, title: body.title ?? doc.title, body: body.body ?? doc.body, changeSummary: body.changeSummary, author: await userAuthor(), baseRevision: body.baseRevision ?? null });
    return ok(r.document);
  } catch (err) {
    if (err instanceof DocConflictError) return failFrom(err, 409);
    throw err;
  }
});

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  await deleteDocument(id, await userAuthor());
  return ok({ ok: true });
});

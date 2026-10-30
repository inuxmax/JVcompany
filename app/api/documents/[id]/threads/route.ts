import { createThread, getDocument } from '@/lib/server/documents';
import { userAuthor } from '@/lib/server/auth';
import { commentOnTask } from '@/lib/server/governance';
import { type Ctx, fail, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

/**
 * Mở luồng bình luận trên một đoạn của tài liệu (anchor = đoạn trích + vài ký tự trước/sau).
 * `notifyAgent`: báo cho phòng phụ trách (việc đã xong thì được mở lại để sửa theo góp ý).
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const doc = await getDocument(id);
  if (!doc) return fail(m('Không tìm thấy tài liệu'), 404);
  const body = await readJson<{ anchor?: unknown; body?: string; notifyAgent?: boolean }>(req);
  if (!body.body?.trim()) return fail(m('Nhập nội dung bình luận'));
  const author = await userAuthor();
  const thread = await createThread(id, { anchor: body.anchor, body: body.body, author });
  if (body.notifyAgent) {
    const quote = thread.anchor ? `Về đoạn “${thread.anchor.quote.slice(0, 400)}”: ` : '';
    await commentOnTask(doc.taskId, `💬 Bình luận trên tài liệu "${doc.title}" (luồng ${thread._id}): ${quote}${body.body.trim()}`, {
      wakeReason: 'document_comment',
      authorName: author.name,
      heading: 'BÌNH LUẬN MỚI TRÊN TÀI LIỆU',
    });
  }
  return ok(thread, 201);
});

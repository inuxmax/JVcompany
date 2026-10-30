import { getThread, replyThread, setThreadStatus } from '@/lib/server/documents';
import { userAuthor } from '@/lib/server/auth';
import { type Ctx, fail, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

/** reply: trả lời · resolve / reopen: đóng / mở lại luồng bình luận. */
export const PATCH = route(async (req: Request, { params }: Ctx<{ id: string; threadId: string }>) => {
  const { id, threadId } = await params;
  const thread = await getThread(threadId);
  if (!thread || thread.documentId !== id) return fail(m('Không tìm thấy luồng bình luận'), 404);
  const body = await readJson<{ action?: string; body?: string }>(req);
  const author = await userAuthor();
  if (body.action === 'reply') return ok(await replyThread(threadId, body.body ?? '', author));
  if (body.action === 'resolve' || body.action === 'reopen') return ok(await setThreadStatus(threadId, body.action === 'resolve' ? 'resolved' : 'open', author));
  return fail(m('Hành động không hợp lệ'));
});

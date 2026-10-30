import { inboxItems, inboxSummary, markInbox } from '@/lib/server/inbox';
import { fail, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';
import { requestLocale } from '@/lib/i18n/server';

/** Hộp thư: ?summary=1 → chỉ số đếm (huy hiệu); ?dismissed=1 → gồm cả mục đã ẩn. */
export const GET = route(async (req: Request) => {
  const url = new URL(req.url);
  const locale = await requestLocale();
  if (url.searchParams.get('summary')) return ok(await inboxSummary(locale));
  return ok(await inboxItems({ includeDismissed: url.searchParams.get('dismissed') === '1', locale }));
});

/** Đánh dấu đã đọc / chưa đọc / ẩn / hiện lại (ids = khoá mục hộp thư). */
export const POST = route(async (req: Request) => {
  const { action, ids } = await readJson<{ action?: 'read' | 'unread' | 'dismiss' | 'restore'; ids?: string[] }>(req);
  if (!action || !['read', 'unread', 'dismiss', 'restore'].includes(action)) return fail(m('Hành động không hợp lệ'));
  if (!Array.isArray(ids) || !ids.length) return fail(m('Chưa chọn mục nào'));
  await markInbox(ids.map(String), action);
  return ok({ ok: true });
});

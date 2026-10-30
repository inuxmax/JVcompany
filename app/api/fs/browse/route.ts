import { listDir } from '@/lib/server/fsbrowse';
import { fail, ok, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

/** Duyệt thư mục trên máy (dùng cho hộp thoại chọn dự án khi chạy trên trình duyệt). */
export const GET = route(async (req: Request) => {
  const url = new URL(req.url);
  const target = url.searchParams.get('path');
  const files = url.searchParams.get('files') === '1';
  const hidden = url.searchParams.get('hidden') === '1';
  try {
    return ok(await listDir(target || null, { files, hidden }));
  } catch (err) {
    return fail(m('Không mở được thư mục: {message}'), 400, { message: (err as Error).message });
  }
});

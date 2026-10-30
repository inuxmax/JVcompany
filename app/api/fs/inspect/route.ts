import { inspectProject } from '@/lib/server/fsbrowse';
import { fail, ok, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

/** Nhận diện thông tin dự án trong một thư mục (tên, mô tả, công nghệ, git…). */
export const GET = route(async (req: Request) => {
  const target = new URL(req.url).searchParams.get('path');
  if (!target) return fail(m('Thiếu đường dẫn'));
  return ok(await inspectProject(target));
});

import { getProvider } from '@/lib/server/repo';
import { providerQuota } from '@/lib/server/agent/quota';
import { type Ctx, fail, ok, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

/** Hạn mức của kết nối (số dư API / máy chủ trung gian). `?force=1` bỏ qua bản lưu tạm 60 giây. */
export const GET = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const p = await getProvider(id);
  if (!p) return fail(m('Không tìm thấy kết nối'), 404);
  const force = new URL(req.url).searchParams.get('force') === '1';
  return ok({ quota: await providerQuota(p, force) });
});

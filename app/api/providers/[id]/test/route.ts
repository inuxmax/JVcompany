import { getProvider, sanitizeProvider, updateProvider } from '@/lib/server/repo';
import { testProvider } from '@/lib/server/agent/detect';
import { type Ctx, fail, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

/** "Kiểm tra môi trường": mặc định chạy thử thật (agent trả lời một câu); `{ "probe": false }` chỉ kiểm tra nhanh. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson<{ probe?: boolean }>(req).catch(() => ({}) as { probe?: boolean });
  const p = await getProvider(id);
  if (!p) return fail(m('Không tìm thấy kết nối'), 404);
  const r = await testProvider(p, { probe: body.probe !== false });
  const updated = await updateProvider(id, {
    status: r.status,
    envTest: r.envTest,
    ...(r.models?.length ? { models: r.models } : {}),
    ...(r.defaultModel ? { defaultModel: r.defaultModel } : {}),
    ...(r.status.ok ? { cooldownUntil: null } : {}),
  });
  return ok({ provider: sanitizeProvider(updated!), models: r.models ?? [], envTest: r.envTest });
});

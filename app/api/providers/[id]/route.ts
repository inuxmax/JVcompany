import { deleteProvider, getProvider, sanitizeProvider, updateProvider, updateSettings } from '@/lib/server/repo';
import { logActivity } from '@/lib/server/activity';
import { wakeWorker } from '@/lib/server/bus';
import { type Ctx, fail, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';
import type { Provider } from '@/lib/types';
import { cleanProviderInput } from '../input';

const EDITABLE: (keyof Provider)[] = ['name', 'enabled', 'baseUrl', 'apiKey', 'command', 'extraArgs', 'promptMode', 'webUrl', 'defaultModel', 'models'];

export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson<Partial<Provider> & { makeDefault?: boolean; clearCooldown?: boolean; clearApiKey?: boolean }>(req);
  const existing = await getProvider(id);
  if (!existing) return fail(m('Không tìm thấy kết nối'), 404);
  const patch = Object.fromEntries(Object.entries(body).filter(([k]) => EDITABLE.includes(k as keyof Provider))) as Partial<Provider>;
  if (patch.apiKey === '') delete patch.apiKey; // để trống = giữ khóa cũ
  if (body.clearApiKey) patch.apiKey = undefined;
  if (body.clearCooldown) patch.cooldownUntil = null;
  Object.assign(patch, cleanProviderInput(body, existing));
  const p = await updateProvider(id, patch);
  if (body.makeDefault) await updateSettings({ defaultProviderId: id });
  await logActivity({ action: 'provider.updated', entityType: 'provider', entityId: id, summary: `Sửa kết nối AI "${p?.name ?? id}": ${Object.keys(patch).filter((k) => k !== 'apiKey').join(', ')}${patch.apiKey ? ', API key' : ''}` });
  wakeWorker();
  return ok(sanitizeProvider(p!));
});

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const p = await getProvider(id);
  await deleteProvider(id);
  await logActivity({ action: 'provider.deleted', entityType: 'provider', entityId: id, summary: `Xoá kết nối AI "${p?.name ?? id}"` });
  return ok({ ok: true });
});

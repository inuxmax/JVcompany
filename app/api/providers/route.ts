import { createProvider, getSettings, listProviders, sanitizeProvider, updateProvider, updateSettings } from '@/lib/server/repo';
import { logActivity } from '@/lib/server/activity';
import { testProvider } from '@/lib/server/agent/detect';
import { fail, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';
import { getPreset } from '@/lib/catalog';
import type { Provider } from '@/lib/types';
import { cleanProviderInput } from './input';

export const GET = route(async () => {
  const [providers, settings] = await Promise.all([listProviders(), getSettings()]);
  return ok({ providers: providers.map(sanitizeProvider), defaultProviderId: settings.defaultProviderId });
});

export const POST = route(async (req: Request) => {
  const body = await readJson<Partial<Provider> & { makeDefault?: boolean; probe?: boolean }>(req);
  if (!body.type) return fail(m('Thiếu loại kết nối'));
  const preset = getPreset(body.type);
  const extra = cleanProviderInput(body);
  const p = await createProvider({
    name: body.name?.trim() || preset.label,
    type: preset.type,
    kind: preset.kind,
    enabled: body.enabled ?? true,
    baseUrl: body.baseUrl?.trim() || preset.baseUrl,
    apiKey: body.apiKey?.trim() || undefined,
    command: body.command?.trim() || preset.command,
    extraArgs: body.extraArgs ?? [],
    promptMode: body.promptMode,
    webUrl: body.webUrl || preset.webUrl,
    defaultModel: body.defaultModel ?? preset.defaultModel ?? '',
    models: body.models?.length ? body.models : preset.models,
    ...extra,
  });
  const result = await testProvider(p, { probe: Boolean(body.probe) });
  const updated = await updateProvider(p._id, {
    status: result.status,
    envTest: result.envTest,
    ...(result.models?.length ? { models: result.models } : {}),
    ...(result.defaultModel ? { defaultModel: result.defaultModel } : {}),
  });
  const settings = await getSettings();
  if (body.makeDefault || !settings.defaultProviderId) await updateSettings({ defaultProviderId: p._id });
  await logActivity({ action: 'provider.created', entityType: 'provider', entityId: p._id, summary: `Thêm kết nối AI "${p.name}" (${p.type})` });
  return ok(sanitizeProvider(updated ?? p), 201);
});

import { getProvider } from '@/lib/server/repo';
import { listModels } from '@/lib/server/agent/detect';
import { fail, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';
import { sysMsg } from '@/lib/i18n/format';
import { getPreset } from '@/lib/catalog';
import type { Provider, ProviderAuthMode, ProviderType } from '@/lib/types';

/** Thông báo kèm khoá dịch: `message` tiếng Việt gốc + `i18n` để giao diện hiện theo ngôn ngữ (localizedContent). */
function note(s: ReturnType<typeof sysMsg>) {
  return { message: s.content, i18n: s.i18n };
}

// Tải danh sách model theo thông tin đang nhập trong hộp thoại (chưa cần lưu). API key để trống = dùng khóa đã lưu.
export const POST = route(async (req: Request) => {
  const body = await readJson<{ id?: string; type?: ProviderType; baseUrl?: string; apiKey?: string; command?: string; authMode?: ProviderAuthMode }>(req);
  const saved = body.id ? await getProvider(body.id) : null;
  const type = body.type ?? saved?.type;
  if (!type) return fail(m('Thiếu loại kết nối'));
  const preset = getPreset(type);
  const apiKey = body.apiKey?.trim() || saved?.apiKey;
  if (preset.kind === 'api' && preset.needsApiKey && !apiKey) return ok({ ok: false, models: [], ...note(sysMsg('Nhập API key để tải danh sách model.')) });
  const provider = {
    ...saved,
    _id: saved?._id ?? 'draft',
    type,
    kind: preset.kind,
    name: saved?.name ?? preset.label,
    baseUrl: body.baseUrl?.trim() || (body.id ? saved?.baseUrl : undefined) || preset.baseUrl,
    command: body.command?.trim() || saved?.command || preset.command,
    authMode: body.authMode ?? saved?.authMode,
    apiKey,
  } as Provider;
  try {
    const models = await listModels(provider);
    const fromCli = preset.kind === 'cli' && models !== preset.models;
    return ok({
      ok: true,
      models,
      ...(models.length
        ? fromCli
          ? note(sysMsg('Tải được {n} model từ CLI.', { n: models.length }))
          : note(sysMsg('Tải được {n} model.', { n: models.length }))
        : preset.kind === 'cli'
          ? note(sysMsg('CLI không liệt kê model – chọn từ gợi ý hoặc tự nhập.'))
          : note(sysMsg('Kết nối không trả về model nào.'))),
    });
  } catch (err) {
    return ok({ ok: false, models: [], message: err instanceof Error ? err.message : String(err) });
  }
});

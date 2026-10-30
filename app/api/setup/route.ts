import { finishSetup, getCompany, needsSetup, setupCompany, applyTeam, updateCompany, onboardingProjectId } from '@/lib/server/company';
import { getSettings, listDepartments, listProviders, sanitizeProvider, updateSettings } from '@/lib/server/repo';
import { fail, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

/** Trạng thái thiết lập ban đầu (trang nào cũng hỏi để chuyển tới /setup khi cơ sở dữ liệu còn trống). */
export const GET = route(async () => {
  const [needs, company, providers, settings, departments] = await Promise.all([needsSetup(), getCompany(), listProviders(), getSettings(), listDepartments()]);
  return ok({
    needsSetup: needs,
    company,
    providers: providers.map(sanitizeProvider),
    defaultProviderId: settings.defaultProviderId,
    departments: departments.filter((d) => d.enabled).map((d) => ({ _id: d._id, name: d.name, title: d.title, icon: d.icon, color: d.color })),
    onboardingProjectId: await onboardingProjectId(),
  });
});

/**
 * Các bước thiết lập:
 * - { step: "company", name, mission }      → tạo công ty + mục tiêu gốc
 * - { step: "team", teamId, leadTitle? }    → chọn đội ngũ đầu tiên
 * - { step: "model", providerId }           → đặt kết nối AI mặc định
 * - { step: "finish" }                      → tạo dự án "Làm quen" + câu hỏi mở đầu
 * - { step: "restart" }                     → chạy lại thiết lập (từ Cài đặt)
 */
export const POST = route(async (req: Request) => {
  const body = await readJson<{ step?: string; name?: string; mission?: string; teamId?: string; leadTitle?: string; providerId?: string }>(req);
  switch (body.step) {
    case 'company': {
      const name = body.name?.trim();
      if (!name) return fail(m('Nhập tên công ty'));
      return ok({ company: await setupCompany(name, body.mission ?? '') });
    }
    case 'team': {
      if (!body.teamId) return fail(m('Chọn một đội ngũ'));
      return ok(await applyTeam(body.teamId, { exclusive: true, leadTitle: body.leadTitle }));
    }
    case 'model': {
      if (!body.providerId) return fail(m('Chọn kết nối AI'));
      await updateSettings({ defaultProviderId: body.providerId });
      return ok({ ok: true });
    }
    case 'finish':
      return ok(await finishSetup());
    case 'restart':
      await updateCompany({ onboardedAt: null });
      return ok({ ok: true });
    default:
      return fail(m('Bước không hợp lệ'));
  }
});

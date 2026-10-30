import { getCollections } from '@/lib/server/db';
import { installBundle, installLibrarySkill, listPlugins, planExternal, runExternal } from '@/lib/server/plugins';
import { fail, failFrom, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

/** Plugin đã cài + kỹ năng / kết nối đã có (thư viện dựng sẵn nằm ở lib/plugins-catalog, giao diện tự đọc). */
export const GET = route(async () => {
  const c = await getCollections();
  const installedSkills = (await c.skills.find({}, { projection: { key: 1 } }).toArray()).map((s) => s.key);
  const connectorIds = (await c.mcpConnections.find({ directoryId: { $exists: true, $ne: null } }, { projection: { directoryId: 1 } }).toArray()).map((x) => x.directoryId);
  return ok({ plugins: await listPlugins(), installedSkills, installedConnectors: connectorIds });
});

interface Body {
  action?: 'install-skill' | 'install-bundle' | 'plan' | 'run';
  key?: string;
  id?: string;
  input?: string;
  planId?: string;
  confirm?: boolean;
  departments?: string[];
}

/**
 * - install-skill { key, departments? }: cài kỹ năng từ thư viện.
 * - install-bundle { id, departments? }: cài gói dựng sẵn.
 * - plan { input }: xem trước ĐÚNG lệnh sẽ chạy cho npm / npx / GitHub / URL (chưa chạy gì).
 * - run { planId, confirm: true, departments? }: chạy kế hoạch đã xem trước.
 */
export const POST = route(async (req: Request) => {
  const body = await readJson<Body>(req);
  const departments = Array.isArray(body.departments) ? body.departments.map(String) : undefined;
  try {
    switch (body.action) {
      case 'install-skill':
        if (!body.key) return fail(m('Thiếu mã kỹ năng.'));
        return ok(await installLibrarySkill(body.key, departments), 201);
      case 'install-bundle':
        if (!body.id) return fail(m('Thiếu mã gói.'));
        return ok(await installBundle(body.id, { departments }), 201);
      case 'plan':
        return ok(await planExternal(String(body.input ?? '')));
      case 'run':
        if (!body.planId || body.confirm !== true) return fail(m('Cần xác nhận lệnh cài trước khi chạy.'));
        return ok(await runExternal(body.planId, { departments }), 201);
      default:
        return fail(m('Thao tác không hợp lệ.'));
    }
  } catch (err) {
    return failFrom(err);
  }
});

import { importCompany, type CompanyPackage } from '@/lib/server/portability';
import { fail, failFrom, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

/** Nhập gói công ty: { package, strategy: 'rename' | 'skip' | 'replace', apply: boolean } – apply=false chỉ xem trước. */
export const POST = route(async (req: Request) => {
  const body = await readJson<{ package?: CompanyPackage; strategy?: 'rename' | 'skip' | 'replace'; apply?: boolean }>(req);
  if (!body.package || body.package.format !== 'vanphong-company/v1') return fail(m('Tệp không phải gói công ty Văn Phòng AI (vanphong-company/v1).'));
  try {
    return ok(await importCompany(body.package, { strategy: body.strategy ?? 'rename', apply: Boolean(body.apply) }));
  } catch (err) {
    return failFrom(err);
  }
});

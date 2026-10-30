import { createCompany, listCompanies } from '@/lib/server/company';
import { currentCompanyId } from '@/lib/server/db';
import { currentUser } from '@/lib/server/auth';
import { failFrom, ok, readJson, route } from '@/lib/server/http';

/** Các công ty (mỗi công ty một toà nhà) + công ty đang mở. */
export const GET = route(async () => {
  const [companies, current, me] = await Promise.all([listCompanies(), currentCompanyId(), currentUser()]);
  // Tài khoản chỉ được giao một số công ty → chỉ thấy các công ty đó
  const visible = me?.companies.length ? companies.filter((c) => me.companies.includes(c._id)) : companies;
  return ok({ current, companies: visible.map(({ dbName: _d, ...c }) => (void _d, c)) });
});

/** Tạo công ty mới (CSDL riêng; lần đầu mở sẽ chạy màn hình thiết lập). */
export const POST = route(async (req: Request) => {
  const body = await readJson<{ name?: string; mission?: string; issuePrefix?: string }>(req);
  try {
    return ok(await createCompany(body.name ?? '', { mission: body.mission, issuePrefix: body.issuePrefix }), 201);
  } catch (err) {
    return failFrom(err);
  }
});

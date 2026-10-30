import { exportCompany } from '@/lib/server/portability';
import { route } from '@/lib/server/http';

/** Xuất công ty thành gói JSON (đã xoá bí mật và đường dẫn riêng của máy). ?projects=1 kèm danh sách dự án. */
export const GET = route(async (req: Request) => {
  const withProjects = new URL(req.url).searchParams.get('projects') === '1';
  const pkg = await exportCompany({ withProjects });
  return new Response(JSON.stringify(pkg, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="cong-ty-${new Date().toISOString().slice(0, 10)}.jvcompany.json"`,
    },
  });
});

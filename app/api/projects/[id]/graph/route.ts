import { getProject } from '@/lib/server/repo';
import { ensureGraph, graphState, loadGraph } from '@/lib/server/codegraph/store';
import { reportMarkdown } from '@/lib/server/codegraph/build';
import { godNodes } from '@/lib/server/codegraph/query';
import { type Ctx, fail, ok, readJson, route } from '@/lib/server/http';

/** Số nút tối đa gửi về để vẽ (giữ nút quan trọng nhất – như chế độ gộp của graph.html khi đồ thị quá lớn). */
const MAX_DRAW = 700;

/**
 * Bản đồ mã của dự án: trạng thái, thống kê, phân hệ, báo cáo và phần đồ thị để vẽ.
 * Không tự dựng – bấm "Dựng bản đồ mã" (POST) hoặc để agent tự dựng khi chạy nhiệm vụ.
 */
export const GET = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) return fail('Không tìm thấy dự án', 404);
  if (!project.path) return ok({ available: false, built: false, building: false });
  const limit = Math.min(Number(new URL(req.url).searchParams.get('limit')) || MAX_DRAW, 2000);
  const state = graphState(id);
  const ix = await loadGraph(id);
  if (!ix) return ok({ available: true, built: false, building: state.building, error: state.error });
  const g = ix.graph;
  // Giữ nút bậc cao nhất (bỏ gói bên ngoài) + mọi nút tiêu biểu của phân hệ
  const keep = new Set(
    [...g.nodes]
      .filter((n) => n.kind !== 'package')
      .sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0))
      .slice(0, limit)
      .map((n) => n.id),
  );
  for (const c of g.communities) for (const t of c.top) keep.add(t);
  const nodes = g.nodes.filter((n) => keep.has(n.id));
  const links = g.links.filter((l) => keep.has(l.source) && keep.has(l.target));
  return ok({
    available: true,
    built: true,
    building: state.building,
    error: state.error,
    root: g.root,
    builtAt: g.builtAt,
    stats: g.stats,
    communities: g.communities,
    gods: godNodes(ix, 12).map((n) => n.id),
    nodes,
    links,
    total: { nodes: g.nodes.length, links: g.links.length },
    report: reportMarkdown(ix),
  });
});

/** Dựng / dựng lại bản đồ mã ngay (chỉ trích lại tệp đã đổi). */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson<{ action?: string }>(req).catch(() => ({ action: 'build' }));
  if (body.action && body.action !== 'build') return fail('Thao tác không hợp lệ');
  const project = await getProject(id);
  if (!project) return fail('Không tìm thấy dự án', 404);
  if (!project.path) return fail('Dự án chưa gắn thư mục trên máy');
  const ix = await ensureGraph(id, project.path, { force: true });
  if (!ix) return fail('Không đọc được thư mục dự án: {path}', 400, { path: project.path });
  return ok({ stats: ix.graph.stats, builtAt: ix.graph.builtAt });
});

import { loadGraph } from '@/lib/server/codegraph/store';
import { explain, query, shortestPath } from '@/lib/server/codegraph/query';
import { type Ctx, fail, ok, route } from '@/lib/server/http';

/**
 * Hỏi bản đồ mã (đúng như agent nhận): ?q=câu hỏi[&mode=dfs&depth=3] · ?explain=tên · ?from=A&to=B · ?node=id (chi tiết + kết nối).
 */
export const GET = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const ix = await loadGraph(id);
  if (!ix) return fail('Dự án chưa có bản đồ mã', 404);
  const sp = new URL(req.url).searchParams;
  const nodeId = sp.get('node');
  if (nodeId) {
    const node = ix.byId.get(nodeId);
    if (!node) return fail('Không tìm thấy nút', 404);
    const neighbors = (ix.adj.get(nodeId) ?? []).slice(0, 200).map((nb) => {
      const other = ix.byId.get(nb.id);
      return { id: nb.id, label: other?.label ?? nb.id, kind: other?.kind ?? 'file', file: other?.file, line: other?.line, relation: nb.edge.relation, confidence: nb.edge.confidence, dir: nb.dir };
    });
    return ok({ node, neighbors, text: explain(ix, node.label) });
  }
  const name = sp.get('explain');
  if (name) return ok({ text: explain(ix, name), nodes: [], tokens: 0 });
  const from = sp.get('from');
  const to = sp.get('to');
  if (from && to) return ok({ text: shortestPath(ix, from, to), nodes: [], tokens: 0 });
  const q = (sp.get('q') ?? '').trim();
  if (!q) return fail('Nhập câu hỏi');
  const r = query(ix, q, { mode: sp.get('mode') === 'dfs' ? 'dfs' : 'bfs', depth: Number(sp.get('depth')) || 2, budget: Number(sp.get('budget')) || 1500 });
  return ok(r);
});

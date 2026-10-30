// Gắn bản đồ mã vào lượt chạy của agent để tiết kiệm token (mục đích cốt lõi của Graphify):
// - Lời nhắc của mỗi nhiệm vụ có sẵn tổng quan dự án + phần đồ thị liên quan đến nhiệm vụ → agent biết ngay cần đọc
//   tệp nào, không phải grep / đọc lan man cả thư mục.
// - Agent API: công cụ graph_query / graph_explain / graph_path. Agent CLI: lệnh chỉ đọc scripts/vp-graph.cjs.
import path from 'path';
import type { Project, Settings, Task } from '../../types';
import { overviewText } from './build';
import { ensureGraph, graphFile } from './store';
import { explain, query, shortestPath, type GraphIndex } from './query';

/** Công cụ dòng lệnh cho agent CLI (đường dẫn tuyệt đối, dấu / để chạy được cả trên Windows). */
export const GRAPH_CLI = path.join(process.cwd(), 'scripts', 'vp-graph.cjs').replace(/\\/g, '/');

const fwd = (p: string) => p.replace(/\\/g, '/');
const sleep = (ms: number) => new Promise<null>((r) => setTimeout(() => r(null), ms));

/** Bật mặc định; tắt ở Cài đặt (settings.codeGraph === false). */
export const codeGraphEnabled = (settings: Pick<Settings, 'codeGraph'>) => settings.codeGraph !== false;

/** Đồ thị đã dựng cho lượt chạy này (để thêm công cụ cho agent API). */
const forRun = new Map<string, GraphIndex>();
export const graphForProject = (projectId: string) => forRun.get(projectId) ?? null;

/**
 * Phần "Bản đồ mã" của lời nhắc. Dựng / cập nhật đồ thị nếu cần (chờ tối đa 25 giây – dự án rất lớn thì lượt này chạy
 * không kèm bản đồ, lần sau sẽ có). Trả về '' khi không có thư mục dự án thật hoặc dự án quá nhỏ.
 */
export async function codeMapSection(
  ctx: { project: Pick<Project, '_id'>; task: Pick<Task, 'title' | 'instructions'>; root: string; hasRealPath: boolean; settings: Pick<Settings, 'codeGraph'> },
  mode: 'tools' | 'cli',
): Promise<string> {
  if (!ctx.hasRealPath || !codeGraphEnabled(ctx.settings)) return '';
  const ix = await Promise.race([ensureGraph(ctx.project._id, ctx.root).catch(() => null), sleep(25_000)]);
  if (!ix || ix.graph.stats.files < 3 || ix.graph.stats.nodes < 10) return '';
  forRun.set(ctx.project._id, ix);
  const g = ix.graph;
  const related = query(ix, `${ctx.task.title}\n${ctx.task.instructions ?? ''}`.slice(0, 2000), { budget: 700, depth: 2 });
  const file = fwd(graphFile(ctx.project._id));
  const how =
    mode === 'tools'
      ? '- Cần thêm: gọi công cụ graph_query (câu hỏi), graph_explain (một hàm / lớp) hoặc graph_path (A → B) trước khi đọc tệp.'
      : [
          '- Cần thêm, tra đồ thị (lệnh chỉ đọc, chạy được ở mọi mức quyền):',
          `  node "${GRAPH_CLI}" query "<câu hỏi hoặc từ khoá>" --graph "${file}"`,
          `  node "${GRAPH_CLI}" explain "<tên hàm / lớp>" --graph "${file}"`,
          `  node "${GRAPH_CLI}" path "<A>" "<B>" --graph "${file}"`,
        ].join('\n');
  return [
    '# Bản đồ mã của dự án (đồ thị tri thức – dùng thay cho grep / đọc lan man)',
    `Đọc toàn bộ mã ≈ ${g.stats.corpusTokens.toLocaleString('en')} token; bản đồ dưới đây chỉ vài trăm token. Mỗi cạnh ghi EXTRACTED (có trực tiếp trong mã) hoặc INFERRED (suy ra theo tên).`,
    '',
    overviewText(ix, 650),
    ...(related.start.length ? ['', '## Phần liên quan tới nhiệm vụ này', related.text] : []),
    '',
    '## Cách dùng để tiết kiệm token',
    '- Xác định đúng tệp / dòng cần xem từ bản đồ; chỉ mở những tệp đó, không đọc cả thư mục.',
    how,
    `- Bản đồ dựng lúc ${g.builtAt}; tệp vừa sửa trong lượt này có thể chưa có – đọc tệp khi cần chắc chắn.`,
  ].join('\n');
}

/** Công cụ đồ thị cho agent API (định dạng ToolDef trung lập). */
export const GRAPH_TOOLS = [
  {
    name: 'graph_query',
    description:
      'Tra bản đồ mã (đồ thị tri thức) của dự án bằng câu hỏi hoặc từ khoá – trả về các hàm / lớp / tệp liên quan kèm vị trí và quan hệ (gọi, import, kế thừa…). Dùng TRƯỚC khi đọc tệp để chỉ đọc đúng chỗ.',
    parameters: {
      type: 'object' as const,
      properties: {
        question: { type: 'string', description: 'Câu hỏi hoặc từ khoá (tên hàm, tệp, khái niệm…)' },
        mode: { type: 'string', enum: ['bfs', 'dfs'], description: 'bfs = bối cảnh rộng (mặc định), dfs = lần theo một đường' },
        depth: { type: 'number', description: 'Độ sâu duyệt 1–6 (mặc định 2)' },
      },
      required: ['question'],
    },
  },
  {
    name: 'graph_explain',
    description: 'Giải thích một hàm / lớp / tệp trong bản đồ mã: vị trí, phân hệ và mọi kết nối (ai gọi nó, nó gọi gì).',
    parameters: { type: 'object' as const, properties: { name: { type: 'string', description: 'Tên hàm / lớp / tệp' } }, required: ['name'] },
  },
  {
    name: 'graph_path',
    description: 'Đường ngắn nhất giữa hai thứ trong bản đồ mã (vd từ API route tới bảng dữ liệu).',
    parameters: {
      type: 'object' as const,
      properties: { from: { type: 'string', description: 'Điểm đầu' }, to: { type: 'string', description: 'Điểm cuối' } },
      required: ['from', 'to'],
    },
  },
];

/** Thực thi công cụ đồ thị; null = không phải công cụ đồ thị. */
export function runGraphTool(projectId: string, name: string, input: Record<string, unknown>): string | null {
  if (!name.startsWith('graph_')) return null;
  const ix = graphForProject(projectId);
  if (!ix) return 'Dự án chưa có bản đồ mã.';
  const s = (k: string) => String(input[k] ?? '');
  if (name === 'graph_query') return query(ix, s('question'), { mode: input.mode === 'dfs' ? 'dfs' : 'bfs', depth: Number(input.depth) || 2, budget: 1500 }).text;
  if (name === 'graph_explain') return explain(ix, s('name'));
  if (name === 'graph_path') return shortestPath(ix, s('from'), s('to'));
  return null;
}

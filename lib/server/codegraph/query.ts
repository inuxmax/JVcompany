// Tra cứu đồ thị (chuyển từ serve.py của Graphify): query (BFS/DFS theo câu hỏi, cắt theo ngân sách token),
// explain (một nút + các kết nối), path (đường ngắn nhất), god nodes, phân hệ, thống kê.
// Giữ cùng thuật toán với scripts/jv-graph.cjs (công cụ dòng lệnh cho agent CLI).
import type { CodeGraph, GraphEdge, GraphNode } from './types';

export interface Neighbor {
  id: string;
  edge: GraphEdge;
  /** out: nút này → hàng xóm; in: hàng xóm → nút này. */
  dir: 'out' | 'in';
}

export interface GraphIndex {
  graph: CodeGraph;
  byId: Map<string, GraphNode>;
  adj: Map<string, Neighbor[]>;
}

export function indexGraph(graph: CodeGraph): GraphIndex {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const adj = new Map<string, Neighbor[]>();
  const push = (a: string, nb: Neighbor) => {
    const list = adj.get(a);
    if (list) list.push(nb);
    else adj.set(a, [nb]);
  };
  for (const e of graph.links) {
    push(e.source, { id: e.target, edge: e, dir: 'out' });
    push(e.target, { id: e.source, edge: e, dir: 'in' });
  }
  return { graph, byId, adj };
}

/** Từ tiếng Việt thường gặp trong yêu cầu → từ khoá tiếng Anh hay dùng trong mã. */
const VI_HINTS: [RegExp, string[]][] = [
  [/đăng nhập|đăng xuất|xác thực/, ['login', 'auth', 'session']],
  [/đăng ký/, ['register', 'signup']],
  [/mật khẩu/, ['password']],
  [/người dùng|tài khoản/, ['user', 'account']],
  [/phân quyền|vai trò/, ['permission', 'role']],
  [/thanh toán|hoá đơn|hóa đơn/, ['payment', 'billing', 'invoice']],
  [/giỏ hàng/, ['cart']],
  [/đơn hàng/, ['order']],
  [/sản phẩm/, ['product']],
  [/cơ sở dữ liệu|csdl|dữ liệu/, ['db', 'database', 'model', 'schema']],
  [/giao diện|màn hình|trang/, ['page', 'component', 'view', 'layout']],
  [/nút/, ['button']],
  [/biểu mẫu|form/, ['form']],
  [/kiểm thử|test/, ['test', 'spec']],
  [/lỗi|sửa lỗi|bug/, ['error', 'exception', 'handler']],
  [/tìm kiếm/, ['search', 'query']],
  [/bảo mật/, ['security', 'auth', 'csrf']],
  [/tệp|tập tin|tải lên/, ['file', 'upload']],
  [/ảnh|hình/, ['image', 'photo']],
  [/thông báo/, ['notification', 'notify', 'toast']],
  [/email|thư/, ['mail', 'email']],
  [/cài đặt|cấu hình/, ['settings', 'config']],
  [/báo cáo|thống kê/, ['report', 'stats', 'analytics']],
  [/hiệu năng|tối ưu|chậm/, ['performance', 'cache']],
  [/chi phí|giá tiền|giá|ngân sách/, ['cost', 'price', 'pricing', 'budget', 'usage']],
  [/bộ nhớ đệm/, ['cache']],
  [/đường dẫn|định tuyến/, ['route', 'router']],
  [/máy chủ|api/, ['api', 'server', 'route', 'handler']],
  [/lịch|hẹn giờ/, ['schedule', 'cron']],
  [/chat|trò chuyện|tin nhắn/, ['chat', 'message']],
  [/ngôn ngữ|dịch/, ['i18n', 'locale', 'translation']],
];

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'what', 'how', 'why', 'where', 'into', 'are', 'does', 'use', 'uses', 'make']);

/** Tách câu hỏi thành từ khoá: tên mã (camelCase, snake_case, đường dẫn), từ tiếng Anh ≥ 3 chữ, gợi ý từ tiếng Việt. */
export function termsFrom(question: string): string[] {
  const q = question.toLowerCase();
  const terms = new Set<string>();
  for (const m of question.matchAll(/[A-Za-z_][\w./-]{2,}/g)) {
    const w = m[0].replace(/[./-]+$/, '');
    if (!STOP.has(w.toLowerCase())) terms.add(w.toLowerCase());
    // handleLogin → handle, login
    for (const part of w.split(/(?=[A-Z])|[_./-]/)) if (part.length >= 3 && !STOP.has(part.toLowerCase())) terms.add(part.toLowerCase());
  }
  for (const [re, words] of VI_HINTS) if (re.test(q)) words.forEach((w) => terms.add(w));
  return [...terms].slice(0, 24);
}

/**
 * Điểm khớp (như Graphify, thêm trọng số IDF): từ khoá nằm trong tên nút +1 (trùng hẳn một từ +2), nằm trong đường dẫn
 * tệp +0.5; nhân với độ hiếm của từ khoá – từ xuất hiện ở hàng trăm nút (vd "agent") gần như không được tính.
 * Nút tệp chấm theo tên tệp (đường dẫn chỉ tính +0.5).
 */
export function scoreNodes(ix: GraphIndex, terms: string[]): [number, string][] {
  const rows = ix.graph.nodes
    .filter((n) => n.kind !== 'package')
    .map((n) => {
      const name = n.kind === 'file' || n.kind === 'doc' ? (n.label.split('/').pop() ?? n.label) : n.label;
      return { n, name: name.toLowerCase(), words: new Set(name.split(/(?=[A-Z])|[_.\s/-]/).map((w) => w.toLowerCase())), file: (n.file ?? '').toLowerCase() };
    });
  const total = rows.length || 1;
  const idf = new Map(terms.map((t) => [t, Math.log(1 + total / (1 + rows.filter((r) => r.name.includes(t) || r.file.includes(t)).length))]));
  const out: [number, string][] = [];
  for (const r of rows) {
    let score = 0;
    for (const t of terms) {
      const w = idf.get(t) ?? 1;
      if (r.name.includes(t)) score += (r.words.has(t) || r.name === t ? 2 : 1) * w;
      if (r.file.includes(t)) score += 0.5 * w;
    }
    if (score > 0) out.push([score + Math.min(1, (r.n.degree ?? 0) / 50), r.n.id]);
  }
  return out.sort((a, b) => b[0] - a[0]);
}

function traverse(ix: GraphIndex, start: string[], depth: number, mode: 'bfs' | 'dfs'): { order: string[]; edges: GraphEdge[] } {
  const seen = new Set<string>();
  const order: string[] = [];
  const edges: GraphEdge[] = [];
  if (mode === 'dfs') {
    const stack: [string, number][] = start.map((s) => [s, 0] as [string, number]).reverse();
    while (stack.length) {
      const [id, d] = stack.pop()!;
      if (seen.has(id) || d > depth) continue;
      seen.add(id);
      order.push(id);
      for (const nb of ix.adj.get(id) ?? []) if (!seen.has(nb.id)) {
        stack.push([nb.id, d + 1]);
        edges.push(nb.edge);
      }
    }
    return { order, edges };
  }
  let frontier = start.filter((s) => ix.byId.has(s));
  frontier.forEach((s) => {
    seen.add(s);
    order.push(s);
  });
  for (let d = 0; d < depth && frontier.length; d++) {
    const next: string[] = [];
    // Ưu tiên hàng xóm bậc cao trước (cắt theo ngân sách vẫn giữ phần quan trọng)
    for (const id of frontier) {
      const nbs = [...(ix.adj.get(id) ?? [])].sort((a, b) => (ix.byId.get(b.id)?.degree ?? 0) - (ix.byId.get(a.id)?.degree ?? 0));
      for (const nb of nbs) {
        edges.push(nb.edge);
        if (!seen.has(nb.id)) {
          seen.add(nb.id);
          next.push(nb.id);
          order.push(nb.id);
        }
      }
    }
    frontier = next;
  }
  return { order, edges };
}

const loc = (n: GraphNode) => (n.file ? `${n.file}${n.line ? `:${n.line}` : ''}` : '');

/** Đồ thị con dạng văn bản (giống Graphify): NODE …, EDGE … – cắt theo ngân sách token (≈ 4 ký tự / token). */
function subgraphText(ix: GraphIndex, order: string[], edges: GraphEdge[], budget: number): { text: string; shown: string[] } {
  const chars = budget * 4;
  const lines: string[] = [];
  const shown: string[] = [];
  let used = 0;
  for (const id of order) {
    const n = ix.byId.get(id);
    if (!n) continue;
    const line = `NODE ${n.label} [${n.kind}${loc(n) ? ` ${loc(n)}` : ''}${n.community !== undefined && n.community >= 0 ? ` c${n.community}` : ''}]`;
    if (used + line.length > chars * 0.6) break;
    lines.push(line);
    shown.push(id);
    used += line.length + 1;
  }
  const inSet = new Set(shown);
  const seenEdge = new Set<string>();
  for (const e of edges) {
    if (!inSet.has(e.source) || !inSet.has(e.target)) continue;
    const key = `${e.source}|${e.target}|${e.relation}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    const line = `EDGE ${ix.byId.get(e.source)!.label} --${e.relation} [${e.confidence}]--> ${ix.byId.get(e.target)!.label}`;
    if (used + line.length > chars) {
      lines.push(`… (cắt bớt cho vừa ~${budget} token)`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return { text: lines.join('\n'), shown };
}

export interface QueryResult {
  text: string;
  /** Nút bắt đầu (khớp câu hỏi nhất) và các nút có trong kết quả. */
  start: string[];
  nodes: string[];
  tokens: number;
}

export function query(ix: GraphIndex, question: string, opts: { mode?: 'bfs' | 'dfs'; depth?: number; budget?: number } = {}): QueryResult {
  const mode = opts.mode ?? 'bfs';
  const depth = Math.min(Math.max(opts.depth ?? 2, 1), 6);
  const budget = Math.min(Math.max(opts.budget ?? 1500, 200), 8000);
  const scored = scoreNodes(ix, termsFrom(question));
  const start = scored.slice(0, 3).map(([, id]) => id);
  if (!start.length) return { text: 'Không tìm thấy nút nào khớp câu hỏi.', start: [], nodes: [], tokens: 0 };
  const { order, edges } = traverse(ix, start, depth, mode);
  const { text, shown } = subgraphText(ix, order, edges, budget);
  const header = `${mode.toUpperCase()} depth=${depth} · bắt đầu: ${start.map((s) => ix.byId.get(s)!.label).join(', ')} · ${order.length} nút\n`;
  const body = header + text;
  return { text: body, start, nodes: shown, tokens: Math.ceil(body.length / 4) };
}

/** Tìm nút theo tên / id (không phân biệt hoa thường); trùng hẳn tên được ưu tiên. */
export function findNodes(ix: GraphIndex, label: string): GraphNode[] {
  const t = label.trim().toLowerCase();
  if (!t) return [];
  const exact = ix.graph.nodes.filter((n) => n.label.toLowerCase() === t || n.id.toLowerCase() === t);
  if (exact.length) return exact;
  return ix.graph.nodes.filter((n) => n.label.toLowerCase().includes(t)).sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0));
}

export function explain(ix: GraphIndex, label: string, limit = 40): string {
  const matches = findNodes(ix, label);
  if (!matches.length) return `Không có nút nào tên "${label}".`;
  const n = matches[0];
  const nbs = ix.adj.get(n.id) ?? [];
  const lines = [
    `Nút: ${n.label} (${n.kind})`,
    `  Vị trí: ${loc(n) || '—'}`,
    `  Phân hệ: ${n.community ?? '—'} · Bậc: ${n.degree ?? nbs.length}`,
    `Kết nối (${nbs.length}):`,
    ...nbs.slice(0, limit).map((nb) => `  ${nb.dir === 'out' ? '-->' : '<--'} ${ix.byId.get(nb.id)?.label ?? nb.id} [${nb.edge.relation}] [${nb.edge.confidence}]`),
  ];
  if (nbs.length > limit) lines.push(`  … và ${nbs.length - limit} kết nối khác`);
  if (matches.length > 1) lines.push(`(Còn ${matches.length - 1} nút cùng tên: ${matches.slice(1, 6).map((m) => loc(m)).join(', ')})`);
  return lines.join('\n');
}

export function shortestPath(ix: GraphIndex, from: string, to: string, maxHops = 8): string {
  const a = scoreNodes(ix, termsFrom(from))[0]?.[1] ?? findNodes(ix, from)[0]?.id;
  const b = scoreNodes(ix, termsFrom(to))[0]?.[1] ?? findNodes(ix, to)[0]?.id;
  if (!a) return `Không có nút nào khớp "${from}".`;
  if (!b) return `Không có nút nào khớp "${to}".`;
  const prev = new Map<string, { id: string; edge: GraphEdge; dir: 'out' | 'in' } | null>([[a, null]]);
  let frontier = [a];
  for (let d = 0; d < maxHops && frontier.length && !prev.has(b); d++) {
    const next: string[] = [];
    for (const id of frontier) for (const nb of ix.adj.get(id) ?? []) if (!prev.has(nb.id)) {
      prev.set(nb.id, { id, edge: nb.edge, dir: nb.dir });
      next.push(nb.id);
    }
    frontier = next;
  }
  if (!prev.has(b)) return `Không có đường nối "${ix.byId.get(a)!.label}" và "${ix.byId.get(b)!.label}" trong ${maxHops} bước.`;
  const steps: string[] = [];
  let cur = b;
  while (prev.get(cur)) {
    const p = prev.get(cur)!;
    steps.unshift(`${p.dir === 'out' ? '--' : '<--'}${p.edge.relation} [${p.edge.confidence}]${p.dir === 'out' ? '-->' : '--'} ${ix.byId.get(cur)!.label}`);
    cur = p.id;
  }
  return `Đường ngắn nhất (${steps.length} bước):\n  ${ix.byId.get(a)!.label} ${steps.join(' ')}`;
}

/** Nút trung tâm: bậc cao nhất (bỏ tệp, gói bên ngoài, ghi chú). */
export function godNodes(ix: GraphIndex, top = 10): GraphNode[] {
  return ix.graph.nodes
    .filter((n) => n.kind !== 'file' && n.kind !== 'doc' && n.kind !== 'package' && n.kind !== 'rationale' && n.kind !== 'section')
    .sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0))
    .slice(0, top);
}

export function communityText(ix: GraphIndex, id: number, limit = 60): string {
  const c = ix.graph.communities.find((x) => x.id === id);
  if (!c) return `Không có phân hệ ${id}.`;
  const members = ix.graph.nodes.filter((n) => n.community === id).sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0));
  return [`Phân hệ ${id} – ${c.label} (${members.length} nút):`, ...members.slice(0, limit).map((n) => `  ${n.label} [${n.kind} ${loc(n)}]`)].join('\n');
}

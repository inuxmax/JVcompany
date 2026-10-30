#!/usr/bin/env node
// Tra bản đồ mã (đồ thị tri thức) của dự án – dành cho agent CLI (Claude Code, Codex, Gemini…) thay vì grep / đọc lan man.
// Chỉ ĐỌC graph.json do JVCompany dựng (.jvcompany/graphs/<dự án>/graph.json). Giữ cùng thuật toán với
// lib/server/codegraph/query.ts.
//
//   node scripts/jv-graph.cjs query "câu hỏi hoặc từ khoá" --graph <graph.json> [--dfs] [--depth 2] [--budget 1500]
//   node scripts/jv-graph.cjs explain "TênHàm" --graph <graph.json>
//   node scripts/jv-graph.cjs path "A" "B" --graph <graph.json>
//   node scripts/jv-graph.cjs god [10] | community <id> | stats | report   --graph <graph.json>
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, v === undefined || v.startsWith('--') ? 1 : 2);
  return v === undefined || v.startsWith('--') ? true : v;
};
const graphPath = flag('graph', process.env.JV_GRAPH);
const depthArg = Number(flag('depth', 2));
const budgetArg = Number(flag('budget', 1500));
const dfs = flag('dfs', false) === true;
const [cmd, ...rest] = args;

if (!graphPath || !cmd) {
  console.error('Cách dùng: node jv-graph.cjs <query|explain|path|god|community|stats|report> … --graph <graph.json>');
  process.exit(2);
}
let graph;
try {
  graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
} catch (e) {
  console.error(`Không đọc được bản đồ mã: ${e.message}`);
  process.exit(1);
}

const byId = new Map(graph.nodes.map((n) => [n.id, n]));
const adj = new Map();
const push = (a, nb) => (adj.has(a) ? adj.get(a).push(nb) : adj.set(a, [nb]));
for (const e of graph.links) {
  push(e.source, { id: e.target, edge: e, dir: 'out' });
  push(e.target, { id: e.source, edge: e, dir: 'in' });
}
const loc = (n) => (n.file ? `${n.file}${n.line ? `:${n.line}` : ''}` : '');

const VI_HINTS = [
  [/đăng nhập|đăng xuất|xác thực/, ['login', 'auth', 'session']], [/đăng ký/, ['register', 'signup']], [/mật khẩu/, ['password']],
  [/người dùng|tài khoản/, ['user', 'account']], [/phân quyền|vai trò/, ['permission', 'role']], [/thanh toán|hoá đơn|hóa đơn/, ['payment', 'billing', 'invoice']],
  [/giỏ hàng/, ['cart']], [/đơn hàng/, ['order']], [/sản phẩm/, ['product']], [/cơ sở dữ liệu|csdl|dữ liệu/, ['db', 'database', 'model', 'schema']],
  [/giao diện|màn hình|trang/, ['page', 'component', 'view', 'layout']], [/nút/, ['button']], [/biểu mẫu|form/, ['form']], [/kiểm thử|test/, ['test', 'spec']],
  [/lỗi|sửa lỗi|bug/, ['error', 'exception', 'handler']], [/tìm kiếm/, ['search', 'query']], [/bảo mật/, ['security', 'auth', 'csrf']],
  [/tệp|tập tin|tải lên/, ['file', 'upload']], [/ảnh|hình/, ['image', 'photo']], [/thông báo/, ['notification', 'notify', 'toast']],
  [/email|thư/, ['mail', 'email']], [/cài đặt|cấu hình/, ['settings', 'config']], [/báo cáo|thống kê/, ['report', 'stats', 'analytics']],
  [/hiệu năng|tối ưu|chậm/, ['performance', 'cache']], [/chi phí|giá tiền|giá|ngân sách/, ['cost', 'price', 'pricing', 'budget', 'usage']], [/bộ nhớ đệm/, ['cache']], [/đường dẫn|định tuyến/, ['route', 'router']],
  [/máy chủ|api/, ['api', 'server', 'route', 'handler']], [/lịch|hẹn giờ/, ['schedule', 'cron']], [/chat|trò chuyện|tin nhắn/, ['chat', 'message']],
  [/ngôn ngữ|dịch/, ['i18n', 'locale', 'translation']],
];
const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'what', 'how', 'why', 'where', 'into', 'are', 'does', 'use', 'uses', 'make']);

function termsFrom(question) {
  const q = question.toLowerCase();
  const terms = new Set();
  for (const m of question.matchAll(/[A-Za-z_][\w./-]{2,}/g)) {
    const w = m[0].replace(/[./-]+$/, '');
    if (!STOP.has(w.toLowerCase())) terms.add(w.toLowerCase());
    for (const part of w.split(/(?=[A-Z])|[_./-]/)) if (part.length >= 3 && !STOP.has(part.toLowerCase())) terms.add(part.toLowerCase());
  }
  for (const [re, words] of VI_HINTS) if (re.test(q)) words.forEach((w) => terms.add(w));
  return [...terms].slice(0, 24);
}

function scoreNodes(terms) {
  const rows = graph.nodes
    .filter((n) => n.kind !== 'package')
    .map((n) => {
      const name = n.kind === 'file' || n.kind === 'doc' ? n.label.split('/').pop() : n.label;
      return { n, name: name.toLowerCase(), words: new Set(name.split(/(?=[A-Z])|[_.\s/-]/).map((w) => w.toLowerCase())), file: (n.file || '').toLowerCase() };
    });
  const total = rows.length || 1;
  const idf = new Map(terms.map((t) => [t, Math.log(1 + total / (1 + rows.filter((r) => r.name.includes(t) || r.file.includes(t)).length))]));
  const out = [];
  for (const r of rows) {
    let score = 0;
    for (const t of terms) {
      const w = idf.get(t) || 1;
      if (r.name.includes(t)) score += (r.words.has(t) || r.name === t ? 2 : 1) * w;
      if (r.file.includes(t)) score += 0.5 * w;
    }
    if (score > 0) out.push([score + Math.min(1, (r.n.degree || 0) / 50), r.n.id]);
  }
  return out.sort((a, b) => b[0] - a[0]);
}

function findNodes(label) {
  const t = label.trim().toLowerCase();
  const exact = graph.nodes.filter((n) => n.label.toLowerCase() === t || n.id.toLowerCase() === t);
  if (exact.length) return exact;
  return graph.nodes.filter((n) => n.label.toLowerCase().includes(t)).sort((a, b) => (b.degree || 0) - (a.degree || 0));
}

function query(question) {
  const depth = Math.min(Math.max(depthArg || 2, 1), 6);
  const budget = Math.min(Math.max(budgetArg || 1500, 200), 8000);
  const start = scoreNodes(termsFrom(question)).slice(0, 3).map(([, id]) => id);
  if (!start.length) return 'Không tìm thấy nút nào khớp câu hỏi.';
  const seen = new Set();
  const order = [];
  const edges = [];
  if (dfs) {
    const stack = start.map((s) => [s, 0]).reverse();
    while (stack.length) {
      const [id, d] = stack.pop();
      if (seen.has(id) || d > depth) continue;
      seen.add(id);
      order.push(id);
      for (const nb of adj.get(id) || []) if (!seen.has(nb.id)) {
        stack.push([nb.id, d + 1]);
        edges.push(nb.edge);
      }
    }
  } else {
    let frontier = start;
    frontier.forEach((s) => (seen.add(s), order.push(s)));
    for (let d = 0; d < depth && frontier.length; d++) {
      const next = [];
      for (const id of frontier) {
        const nbs = [...(adj.get(id) || [])].sort((a, b) => ((byId.get(b.id) || {}).degree || 0) - ((byId.get(a.id) || {}).degree || 0));
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
  }
  const chars = budget * 4;
  const lines = [];
  const shown = new Set();
  let used = 0;
  for (const id of order) {
    const n = byId.get(id);
    if (!n) continue;
    const line = `NODE ${n.label} [${n.kind}${loc(n) ? ` ${loc(n)}` : ''}${n.community >= 0 ? ` c${n.community}` : ''}]`;
    if (used + line.length > chars * 0.6) break;
    lines.push(line);
    shown.add(id);
    used += line.length + 1;
  }
  const seenEdge = new Set();
  for (const e of edges) {
    if (!shown.has(e.source) || !shown.has(e.target)) continue;
    const key = `${e.source}|${e.target}|${e.relation}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    const line = `EDGE ${byId.get(e.source).label} --${e.relation} [${e.confidence}]--> ${byId.get(e.target).label}`;
    if (used + line.length > chars) {
      lines.push(`… (cắt bớt cho vừa ~${budget} token)`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return `${dfs ? 'DFS' : 'BFS'} depth=${depth} · bắt đầu: ${start.map((s) => byId.get(s).label).join(', ')} · ${order.length} nút\n${lines.join('\n')}`;
}

function explain(label) {
  const matches = findNodes(label);
  if (!matches.length) return `Không có nút nào tên "${label}".`;
  const n = matches[0];
  const nbs = adj.get(n.id) || [];
  const lines = [`Nút: ${n.label} (${n.kind})`, `  Vị trí: ${loc(n) || '—'}`, `  Phân hệ: ${n.community ?? '—'} · Bậc: ${n.degree ?? nbs.length}`, `Kết nối (${nbs.length}):`];
  for (const nb of nbs.slice(0, 40)) lines.push(`  ${nb.dir === 'out' ? '-->' : '<--'} ${(byId.get(nb.id) || {}).label || nb.id} [${nb.edge.relation}] [${nb.edge.confidence}]`);
  if (nbs.length > 40) lines.push(`  … và ${nbs.length - 40} kết nối khác`);
  if (matches.length > 1) lines.push(`(Còn ${matches.length - 1} nút cùng tên: ${matches.slice(1, 6).map(loc).join(', ')})`);
  return lines.join('\n');
}

function shortestPath(from, to) {
  const a = (scoreNodes(termsFrom(from))[0] || [])[1] || (findNodes(from)[0] || {}).id;
  const b = (scoreNodes(termsFrom(to))[0] || [])[1] || (findNodes(to)[0] || {}).id;
  if (!a) return `Không có nút nào khớp "${from}".`;
  if (!b) return `Không có nút nào khớp "${to}".`;
  const prev = new Map([[a, null]]);
  let frontier = [a];
  for (let d = 0; d < 8 && frontier.length && !prev.has(b); d++) {
    const next = [];
    for (const id of frontier) for (const nb of adj.get(id) || []) if (!prev.has(nb.id)) {
      prev.set(nb.id, { id, edge: nb.edge, dir: nb.dir });
      next.push(nb.id);
    }
    frontier = next;
  }
  if (!prev.has(b)) return `Không có đường nối "${byId.get(a).label}" và "${byId.get(b).label}" trong 8 bước.`;
  const steps = [];
  let cur = b;
  while (prev.get(cur)) {
    const p = prev.get(cur);
    steps.unshift(`${p.dir === 'out' ? '--' : '<--'}${p.edge.relation} [${p.edge.confidence}]${p.dir === 'out' ? '-->' : '--'} ${byId.get(cur).label}`);
    cur = p.id;
  }
  return `Đường ngắn nhất (${steps.length} bước):\n  ${byId.get(a).label} ${steps.join(' ')}`;
}

const SKIP = new Set(['file', 'doc', 'package', 'rationale', 'section']);
let out;
switch (cmd) {
  case 'query':
    out = query(rest.join(' '));
    break;
  case 'explain':
    out = explain(rest.join(' '));
    break;
  case 'path':
    out = shortestPath(rest[0] || '', rest[1] || '');
    break;
  case 'god': {
    const top = Number(rest[0]) || 10;
    const gods = graph.nodes.filter((n) => !SKIP.has(n.kind)).sort((a, b) => (b.degree || 0) - (a.degree || 0)).slice(0, top);
    out = ['Nút trung tâm:', ...gods.map((n, i) => `  ${i + 1}. ${n.label} (${n.kind}) ${loc(n)} – ${n.degree} liên kết`)].join('\n');
    break;
  }
  case 'community': {
    const id = Number(rest[0]);
    const c = graph.communities.find((x) => x.id === id);
    const members = graph.nodes.filter((n) => n.community === id).sort((a, b) => (b.degree || 0) - (a.degree || 0));
    out = c ? [`Phân hệ ${id} – ${c.label} (${members.length} nút):`, ...members.slice(0, 60).map((n) => `  ${n.label} [${n.kind} ${loc(n)}]`)].join('\n') : `Không có phân hệ ${id}.`;
    break;
  }
  case 'stats': {
    const s = graph.stats;
    out = `Tệp: ${s.files}\nNút: ${s.nodes}\nCạnh: ${s.edges}\nPhân hệ: ${s.communities}\nEXTRACTED: ${s.extractedPct}%\nINFERRED: ${s.inferredPct}%\nDựng lúc: ${graph.builtAt}`;
    break;
  }
  case 'report':
    try {
      out = fs.readFileSync(path.join(path.dirname(graphPath), 'report.md'), 'utf8');
    } catch {
      out = 'Chưa có báo cáo.';
    }
    break;
  default:
    console.error(`Lệnh không hỗ trợ: ${cmd}`);
    process.exit(2);
}
process.stdout.write(`${out}\n`);

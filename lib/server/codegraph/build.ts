// Bước 3–6 – gộp kết quả trích từng tệp thành một đồ thị: giải import & lời gọi ra cạnh (EXTRACTED khi có trực tiếp
// trong mã, INFERRED khi chỉ khớp theo tên), chia phân hệ (Louvain), tìm nút trung tâm, viết báo cáo & bản đồ cho agent.
import path from 'path';
import fs from 'fs';
import type { CodeGraph, Community, FileExtraction, GraphEdge, GraphNode } from './types';
import { louvain, type Adjacency } from './cluster';
import { godNodes, indexGraph, type GraphIndex } from './query';

const posix = path.posix;
const CODE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte'];
/** Tên quá chung – không suy cạnh theo tên (tránh nối nhầm). */
const COMMON = new Set([
  'get', 'set', 'map', 'then', 'catch', 'push', 'pop', 'filter', 'find', 'some', 'every', 'join', 'split', 'slice', 'replace', 'test', 'exec', 'keys', 'values',
  'entries', 'has', 'add', 'delete', 'clear', 'init', 'main', 'run', 'start', 'stop', 'close', 'open', 'read', 'write', 'load', 'save', 'update', 'create',
  'render', 'handle', 'call', 'apply', 'bind', 'next', 'log', 'error', 'warn', 'info', 'debug', 'toString', 'valueOf', 'constructor', 'default', 'index', 'name',
  'value', 'data', 'list', 'item', 'items', 'parse', 'format', 'resolve', 'reject', 'emit', 'send', 'fetch', 'query', 'print', 'append', 'len', 'new', 'string',
]);

interface PathAlias {
  prefix: string;
  targets: string[];
}

/** "paths" trong tsconfig.json / jsconfig.json (vd "@/*": ["./*"]). */
function readAliases(root: string): PathAlias[] {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    try {
      const raw = fs.readFileSync(path.join(root, name), 'utf8').replace(/\/\*[\s\S]*?\*\/|(^|[^:"])\/\/.*$/gm, '$1').replace(/,(\s*[}\]])/g, '$1');
      const opts = (JSON.parse(raw) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } }).compilerOptions ?? {};
      const base = opts.baseUrl ?? '.';
      return Object.entries(opts.paths ?? {}).map(([k, v]) => ({
        prefix: k.replace(/\*$/, ''),
        targets: v.map((t) => posix.normalize(posix.join(base, t.replace(/\*$/, ''))).replace(/^\.\/?/, '')),
      }));
    } catch {
      /* không có hoặc không đọc được */
    }
  }
  return [];
}

class Resolver {
  private files: Set<string>;
  private byBase = new Map<string, string[]>();
  constructor(
    rels: string[],
    private aliases: PathAlias[],
  ) {
    this.files = new Set(rels);
    for (const r of rels) {
      const b = posix.basename(r).toLowerCase();
      this.byBase.set(b, [...(this.byBase.get(b) ?? []), r]);
    }
  }

  private tryCode(p: string): string | null {
    const clean = posix.normalize(p).replace(/^\.\//, '');
    if (this.files.has(clean)) return clean;
    const noExt = clean.replace(/\.(js|jsx|mjs|cjs)$/, '');
    for (const e of CODE_EXTS) if (this.files.has(noExt + e)) return noExt + e;
    for (const e of CODE_EXTS) if (this.files.has(`${clean}/index${e}`)) return `${clean}/index${e}`;
    return null;
  }

  private byBasename(name: string, from: string): string | null {
    const list = this.byBase.get(name.toLowerCase());
    if (!list?.length) return null;
    if (list.length === 1) return list[0];
    // Nhiều tệp trùng tên: chọn tệp gần thư mục hiện tại nhất
    const dir = posix.dirname(from);
    return list.find((f) => f.startsWith(dir)) ?? null;
  }

  /** Đường dẫn tệp trong dự án, hoặc { pkg } nếu là thư viện bên ngoài, hoặc null. */
  resolve(spec: string, from: string, language: string, link?: boolean): string | { pkg: string } | null {
    const dir = posix.dirname(from);
    if (link) return this.tryCode(posix.join(dir, decodeURI(spec))) ?? (this.files.has(posix.normalize(spec)) ? posix.normalize(spec) : null);
    if (language === 'typescript' || language === 'javascript') {
      if (spec.startsWith('.')) return this.tryCode(posix.join(dir, spec));
      for (const a of this.aliases) if (a.prefix && spec.startsWith(a.prefix)) for (const t of a.targets) {
        const hit = this.tryCode(posix.join(t, spec.slice(a.prefix.length)));
        if (hit) return hit;
      }
      if (spec.startsWith('/')) return this.tryCode(spec.slice(1));
      const parts = spec.split('/');
      return { pkg: spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0] };
    }
    if (language === 'python') {
      const dots = /^\.+/.exec(spec)?.[0].length ?? 0;
      const mod = spec.slice(dots).replace(/\./g, '/');
      const bases = dots ? [posix.join(dir, ...Array(dots - 1).fill('..'))] : ['', 'src'];
      for (const b of bases) for (const c of [`${mod}.py`, `${mod}/__init__.py`]) {
        const p = posix.normalize(posix.join(b, c)).replace(/^\.\//, '');
        if (this.files.has(p)) return p;
      }
      return dots ? null : { pkg: spec.split('.')[0] };
    }
    if (language === 'rust') {
      const segs = spec.replace(/^(crate|self|super)::/, '').split('::').filter((s) => s && s !== '*' && !s.startsWith('{'));
      for (let n = segs.length; n > 0; n--) {
        const p = segs.slice(0, n).join('/');
        for (const c of [`src/${p}.rs`, `src/${p}/mod.rs`, posix.join(dir, `${p}.rs`), posix.join(dir, p, 'mod.rs')]) if (this.files.has(posix.normalize(c))) return posix.normalize(c);
      }
      return spec.startsWith('crate') || spec.startsWith('self') || spec.startsWith('super') ? null : { pkg: segs[0] ?? spec };
    }
    if (spec.startsWith('.') || /\.(h|hpp|php|rb|dart|lua)$/.test(spec)) {
      const rel = posix.normalize(posix.join(dir, spec));
      for (const c of [rel, `${rel}.rb`, `${rel}.lua`]) if (this.files.has(c)) return c;
    }
    // Java / Kotlin / C# / PHP / Go / Dart…: khớp theo tên tệp cuối (A.B.C → C.java)
    const last = spec.replace(/^package:/, '').split(/[./\\:]+/).filter(Boolean).pop() ?? spec;
    const exts: Record<string, string[]> = {
      java: ['.java'], kotlin: ['.kt'], csharp: ['.cs'], php: ['.php'], scala: ['.scala'], dart: ['.dart'], swift: ['.swift'], ruby: ['.rb'], lua: ['.lua'], c: ['.h', '.c'], cpp: ['.hpp', '.h', '.cpp'], go: ['.go'],
    };
    for (const e of exts[language] ?? []) {
      const hit = this.byBasename(last.endsWith(e) ? last : last + e, from);
      if (hit) return hit;
    }
    return language === 'go' || language === 'java' || language === 'kotlin' || language === 'csharp' || language === 'scala' || language === 'swift' || language === 'dart' ? { pkg: spec.split(/[./]/).slice(0, 2).join('.') } : null;
  }
}

/** Gộp các tệp đã trích → đồ thị hoàn chỉnh (chưa chia phân hệ). */
function assemble(root: string, extractions: Map<string, FileExtraction>): { nodes: Map<string, GraphNode>; links: GraphEdge[] } {
  const nodes = new Map<string, GraphNode>();
  const links: GraphEdge[] = [];
  const seen = new Set<string>();
  const addEdge = (e: GraphEdge) => {
    if (e.source === e.target || !nodes.has(e.source) || !nodes.has(e.target)) return;
    const key = `${e.source}|${e.target}|${e.relation}`;
    if (seen.has(key)) {
      // Cùng cạnh vừa suy vừa có trực tiếp → giữ mức chắc chắn hơn
      if (e.confidence === 'EXTRACTED') {
        const old = links.find((l) => `${l.source}|${l.target}|${l.relation}` === key);
        if (old) old.confidence = 'EXTRACTED';
      }
      return;
    }
    seen.add(key);
    links.push(e);
  };
  for (const ex of extractions.values()) for (const n of ex.nodes) if (!nodes.has(n.id)) nodes.set(n.id, { ...n });
  for (const ex of extractions.values()) for (const e of ex.edges) addEdge(e);

  const resolver = new Resolver([...extractions.keys()], readAliases(root));
  // Chỉ mục theo tên để suy cạnh: tên đầy đủ (Class.method) và tên ngắn (method)
  const byLabel = new Map<string, string[]>();
  const index = (key: string, id: string) => byLabel.set(key, [...(byLabel.get(key) ?? []), id]);
  for (const n of nodes.values()) {
    if (n.kind === 'file' || n.kind === 'doc' || n.kind === 'section' || n.kind === 'rationale' || n.kind === 'package') continue;
    index(n.label, n.id);
    if (n.label.includes('.')) index(n.label.split('.').pop()!, n.id);
  }
  const unique = (name: string): string | null => {
    const ids = byLabel.get(name);
    return ids && ids.length === 1 ? ids[0] : null;
  };

  for (const [rel, ex] of extractions) {
    const fileId = `file:${rel}`;
    const resolvedSpec = new Map<string, string | null>();
    for (const imp of ex.imports) {
      const target = resolver.resolve(imp.spec, rel, ex.language, imp.link);
      if (typeof target === 'string') {
        resolvedSpec.set(imp.spec, target);
        addEdge({ source: fileId, target: `file:${target}`, relation: imp.link ? 'references' : 'imports', confidence: 'EXTRACTED' });
      } else if (target && !imp.link) {
        const pid = `pkg:${target.pkg}`;
        if (!nodes.has(pid)) nodes.set(pid, { id: pid, label: target.pkg, kind: 'package' });
        addEdge({ source: fileId, target: pid, relation: 'imports', confidence: 'EXTRACTED' });
      }
    }
    const fileOf = (spec: string) => {
      if (!resolvedSpec.has(spec)) {
        const t = resolver.resolve(spec, rel, ex.language);
        resolvedSpec.set(spec, typeof t === 'string' ? t : null);
      }
      return resolvedSpec.get(spec) ?? null;
    };
    const exportOf = (file: string, name: string): string | null => {
      const target = extractions.get(file);
      return target?.exports[name] ?? (nodes.has(`${file}#${name}`) ? `${file}#${name}` : null);
    };
    for (const ref of ex.refs) {
      if (!nodes.has(ref.from)) continue;
      let target: string | null = null;
      let confidence: GraphEdge['confidence'] = 'EXTRACTED';
      const [head, member] = ref.name.split('.', 2);
      if (ref.relation === 'references') target = unique(ref.name);
      else if (member) {
        const b = ex.bindings[head];
        if (b) {
          const f = fileOf(b.spec);
          if (f) target = b.imported === '*' ? exportOf(f, member) : exportOf(f, `${b.imported === 'default' ? head : b.imported}.${member}`);
        } else if (nodes.has(`${rel}#${head}.${member}`)) target = `${rel}#${head}.${member}`;
        if (!target && !COMMON.has(member) && member.length >= 4) {
          target = unique(`${head}.${member}`) ?? unique(member);
          confidence = 'INFERRED';
        }
      } else if (nodes.has(`${rel}#${ref.name}`)) target = `${rel}#${ref.name}`;
      else if (ex.bindings[ref.name]) {
        const b = ex.bindings[ref.name];
        const f = fileOf(b.spec);
        if (f) target = exportOf(f, b.imported === '*' ? ref.name : b.imported);
      }
      if (!target && ref.relation !== 'references' && !member && !COMMON.has(ref.name) && ref.name.length >= 3) {
        target = unique(ref.name);
        confidence = 'INFERRED';
      }
      if (target) addEdge({ source: ref.from, target, relation: ref.relation, confidence: ref.relation === 'mentions' ? 'INFERRED' : confidence });
    }
  }
  return { nodes, links };
}

/** Chia phân hệ + bậc + nhãn phân hệ (không dùng AI: thư mục chính · nút tiêu biểu). */
function clusterAndLabel(nodes: Map<string, GraphNode>, links: GraphEdge[]): Community[] {
  const ids = [...nodes.keys()].filter((id) => nodes.get(id)!.kind !== 'package');
  const pos = new Map(ids.map((id, i) => [id, i]));
  const adj: Adjacency = ids.map(() => new Map());
  const degree = new Map<string, number>();
  for (const e of links) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    const a = pos.get(e.source);
    const b = pos.get(e.target);
    if (a === undefined || b === undefined) continue;
    const w = e.confidence === 'EXTRACTED' ? 1 : 0.5;
    adj[a].set(b, (adj[a].get(b) ?? 0) + w);
    adj[b].set(a, (adj[b].get(a) ?? 0) + w);
  }
  for (const n of nodes.values()) n.degree = degree.get(n.id) ?? 0;
  const membership = louvain(adj);
  const groups = new Map<number, string[]>();
  membership.forEach((c, i) => groups.set(c, [...(groups.get(c) ?? []), ids[i]]));
  // Đánh số theo kích thước (0 = lớn nhất) như Graphify
  const sorted = [...groups.values()].sort((a, b) => b.length - a.length);
  const communities: Community[] = [];
  sorted.forEach((members, cid) => {
    for (const id of members) nodes.get(id)!.community = cid;
    const dirs = new Map<string, number>();
    for (const id of members) {
      const f = nodes.get(id)!.file;
      if (!f) continue;
      const d = posix.dirname(f).split('/').slice(-2).join('/') || '.';
      dirs.set(d, (dirs.get(d) ?? 0) + 1);
    }
    const dir = [...dirs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '.';
    const top = members
      .map((id) => nodes.get(id)!)
      .filter((n) => n.kind !== 'file' && n.kind !== 'doc' && n.kind !== 'rationale' && n.kind !== 'section')
      .sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0))
      .slice(0, 4)
      .map((n) => n.id);
    const head = top[0] ? nodes.get(top[0])!.label : posix.basename(dir);
    communities.push({ id: cid, label: `${dir === '.' ? 'gốc' : dir} · ${head}`, size: members.length, top, dir });
  });
  for (const n of nodes.values()) if (n.kind === 'package') n.community = -1;
  return communities;
}

const tok = (s: string) => Math.ceil(s.length / 4);
const where = (n: GraphNode) => (n.file ? `${n.file}${n.line ? `:${n.line}` : ''}` : '');

/** Bản đồ ngắn gọn đưa vào lời nhắc của agent (phân hệ chính + nút trung tâm), ~ maxTokens. */
export function overviewText(ix: GraphIndex, maxTokens = 700): string {
  const g = ix.graph;
  const lines: string[] = [
    `${g.stats.files} tệp · ${g.stats.nodes} nút · ${g.stats.edges} cạnh · ${g.communities.length} phân hệ (${g.stats.extractedPct}% cạnh có trực tiếp trong mã)`,
    '',
    '## Phân hệ chính',
  ];
  for (const c of g.communities.filter((c) => c.size > 2).slice(0, 10)) {
    const files = new Set(g.nodes.filter((n) => n.community === c.id && n.file).map((n) => n.file!));
    lines.push(`- C${c.id} ${c.label} (${c.size} nút) – ${c.top.map((id) => ix.byId.get(id)?.label).filter(Boolean).join(', ')} · tệp: ${[...files].slice(0, 4).join(', ')}${files.size > 4 ? '…' : ''}`);
  }
  lines.push('', '## Nút trung tâm (mọi thứ đi qua đây)');
  for (const n of godNodes(ix, 10)) lines.push(`- ${n.label} (${n.kind}) ${where(n)} – ${n.degree} liên kết`);
  let text = lines.join('\n');
  while (tok(text) > maxTokens && lines.length > 6) {
    lines.splice(lines.length - 1, 1);
    text = lines.join('\n');
  }
  return text;
}

/** Báo cáo đầy đủ (tương đương GRAPH_REPORT.md): nút trung tâm, phân hệ, kết nối bất ngờ, câu hỏi gợi ý. */
export function reportMarkdown(ix: GraphIndex): string {
  const g = ix.graph;
  const gods = godNodes(ix, 15);
  const lines = [
    `# Bản đồ mã – ${posix.basename(g.root.replace(/\\/g, '/'))}`,
    '',
    `Dựng lúc ${g.builtAt} · ${g.stats.files} tệp · ${g.stats.nodes} nút · ${g.stats.edges} cạnh · ${g.communities.length} phân hệ`,
    `Cạnh: ${g.stats.extractedPct}% EXTRACTED (có trực tiếp trong mã) · ${g.stats.inferredPct}% INFERRED (suy ra theo tên)`,
    `Đọc toàn bộ mã ≈ ${g.stats.corpusTokens.toLocaleString('en')} token · bản đồ này ≈ ${g.stats.mapTokens.toLocaleString('en')} token`,
    '',
    '## Nút trung tâm',
    ...gods.map((n, i) => `${i + 1}. **${n.label}** (${n.kind}) – ${where(n)} – ${n.degree} liên kết`),
    '',
    '## Phân hệ',
  ];
  for (const c of g.communities.filter((c) => c.size > 2).slice(0, 20)) {
    lines.push(`### C${c.id} – ${c.label} (${c.size} nút)`);
    lines.push(c.top.map((id) => ix.byId.get(id)).filter(Boolean).map((n) => `- ${n!.label} – ${where(n!)}`).join('\n'));
  }
  // Kết nối bất ngờ: cạnh nối hai phân hệ khác nhau ở hai thư mục gốc khác nhau (không qua nút trung tâm)
  const godIds = new Set(gods.map((n) => n.id));
  const surprises = g.links
    .filter((e) => {
      const a = ix.byId.get(e.source);
      const b = ix.byId.get(e.target);
      return (
        a && b && a.kind !== 'package' && b.kind !== 'package' && a.community !== b.community && !godIds.has(a.id) && !godIds.has(b.id) &&
        (a.file ?? '').split('/')[0] !== (b.file ?? '').split('/')[0] && e.relation !== 'contains'
      );
    })
    .slice(0, 10);
  if (surprises.length) {
    lines.push('', '## Kết nối bất ngờ');
    for (const e of surprises) lines.push(`- ${ix.byId.get(e.source)!.label} --${e.relation} [${e.confidence}]--> ${ix.byId.get(e.target)!.label}`);
  }
  if (gods.length >= 2) {
    lines.push('', '## Câu hỏi gợi ý');
    lines.push(`- ${gods[0].label} kết nối với ${gods[1].label} thế nào?`);
    const c0 = g.communities[0];
    if (c0) lines.push(`- Phân hệ "${c0.label}" làm gì, đi qua những tệp nào?`);
    lines.push(`- Những gì gọi tới ${gods[0].label}?`);
  }
  return lines.join('\n');
}

/** Dựng đồ thị hoàn chỉnh từ kết quả trích. */
export function buildGraph(root: string, extractions: Map<string, FileExtraction>, meta: { buildMs: number; skipped: number }): { graph: CodeGraph; index: GraphIndex } {
  const { nodes, links } = assemble(root, extractions);
  const communities = clusterAndLabel(nodes, links);
  const languages: Record<string, number> = {};
  let chars = 0;
  for (const ex of extractions.values()) {
    languages[ex.language] = (languages[ex.language] ?? 0) + 1;
    chars += ex.chars;
  }
  const extracted = links.filter((l) => l.confidence === 'EXTRACTED').length;
  const graph: CodeGraph = {
    schemaVersion: 1,
    generator: 'jvcompany-codegraph',
    root,
    builtAt: new Date().toISOString(),
    nodes: [...nodes.values()],
    links,
    communities,
    stats: {
      files: extractions.size,
      nodes: nodes.size,
      edges: links.length,
      communities: communities.length,
      extractedPct: links.length ? Math.round((extracted / links.length) * 100) : 100,
      inferredPct: links.length ? 100 - Math.round((extracted / links.length) * 100) : 0,
      languages,
      corpusTokens: Math.ceil(chars / 4),
      mapTokens: 0,
      buildMs: meta.buildMs,
      skipped: meta.skipped,
    },
  };
  const index = indexGraph(graph);
  graph.stats.mapTokens = tok(overviewText(index));
  return { graph, index };
}

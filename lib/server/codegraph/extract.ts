// Bước 2 – trích nút & cạnh từ từng tệp (chạy cục bộ, không gọi AI).
// - TS / JS: trình biên dịch TypeScript (AST chính xác: khai báo, import, lời gọi, new, JSX, kế thừa).
// - Python và các ngôn ngữ khác: bộ trích nhẹ theo mẫu (khai báo, import, lời gọi theo tên).
// - Markdown: tiêu đề, liên kết tới tệp, tên mã được nhắc tới. SQL: bảng và khoá ngoại.
// Ghi chú "NOTE:" / "WHY:" / "HACK:" / "IMPORTANT:" thành nút lý do gắn vào đoạn mã nó giải thích (như Graphify).
import path from 'path';
import type { FileExtraction, GraphNode, NodeKind } from './types';
import type { SourceFile } from './detect';

type TS = typeof import('typescript');

let tsModule: TS | null | undefined;

/** Trình biên dịch TypeScript (có sẵn trong máy chạy app); không có thì dùng bộ trích theo mẫu. */
async function loadTypeScript(): Promise<TS | null> {
  if (tsModule === undefined) {
    try {
      const m = (await import('typescript')) as unknown as { default?: TS } & TS;
      tsModule = m.default ?? m;
    } catch {
      tsModule = null;
    }
  }
  return tsModule;
}

const RATIONALE_RE = /(?:\/\/|\/\*+|^\s*\*|#|<!--)\s*(NOTE|WHY|HACK|IMPORTANT)\s*:\s*(.+?)\s*(?:\*\/|-->)?\s*$/;
const isComponentName = (n: string) => /^[A-Z][A-Za-z0-9]*$/.test(n);
const clip = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function empty(file: SourceFile, text: string): FileExtraction {
  const fileNode: GraphNode = { id: `file:${file.rel}`, label: file.rel, kind: file.language === 'markdown' ? 'doc' : 'file', file: file.rel, line: 1 };
  return { nodes: [fileNode], edges: [], refs: [], imports: [], bindings: {}, exports: {}, language: file.language, chars: text.length };
}

/** Khoảng dòng của các khai báo – để gắn ghi chú lý do vào khai báo bao quanh gần nhất. */
type Span = { id: string; start: number; end: number };

function attachRationale(out: FileExtraction, rel: string, lines: string[], spans: Span[]) {
  const fileId = `file:${rel}`;
  lines.forEach((line, i) => {
    const m = RATIONALE_RE.exec(line);
    if (!m) return;
    const ln = i + 1;
    const owner = spans.filter((s) => s.start <= ln + 1 && s.end >= ln).sort((a, b) => a.end - a.start - (b.end - b.start))[0];
    const id = `${rel}#note:${ln}`;
    out.nodes.push({ id, label: clip(`${m[1]}: ${m[2]}`), kind: 'rationale', file: rel, line: ln });
    out.edges.push({ source: id, target: owner?.id ?? fileId, relation: 'explains', confidence: 'EXTRACTED' });
  });
}

// ---------------- TypeScript / JavaScript ----------------

function extractTs(ts: TS, file: SourceFile, text: string): FileExtraction {
  const out = empty(file, text);
  const rel = file.rel;
  const fileId = `file:${rel}`;
  const ext = path.extname(rel).toLowerCase();
  const kind =
    ext === '.tsx' ? ts.ScriptKind.TSX : ext === '.jsx' ? ts.ScriptKind.JSX : ext === '.ts' || ext === '.mts' || ext === '.cts' ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind);
  const lineOf = (n: import('typescript').Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const endLineOf = (n: import('typescript').Node) => sf.getLineAndCharacterOfPosition(n.getEnd()).line + 1;
  const jsxFile = ext === '.tsx' || ext === '.jsx';
  const spans: Span[] = [];
  let defaultName: string | null = null;

  const add = (name: string, k: NodeKind, node: import('typescript').Node, parent = fileId, relation = 'contains'): string => {
    const id = `${rel}#${name}`;
    if (!out.nodes.some((n) => n.id === id)) out.nodes.push({ id, label: name, kind: k, file: rel, line: lineOf(node) });
    out.edges.push({ source: parent, target: id, relation, confidence: 'EXTRACTED' });
    spans.push({ id, start: lineOf(node), end: endLineOf(node) });
    return id;
  };
  const hasMod = (node: import('typescript').Node, k: import('typescript').SyntaxKind) =>
    Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === k));
  const markExport = (node: import('typescript').Node, name: string, id: string) => {
    if (hasMod(node, ts.SyntaxKind.ExportKeyword)) out.exports[name] = id;
    if (hasMod(node, ts.SyntaxKind.DefaultKeyword)) out.exports.default = id;
  };
  const heritage = (from: string, clauses: import('typescript').NodeArray<import('typescript').HeritageClause> | undefined) => {
    for (const h of clauses ?? []) {
      const relation = h.token === ts.SyntaxKind.ImplementsKeyword ? 'implements' : 'inherits';
      for (const t of h.types) out.refs.push({ from, name: t.expression.getText(sf), relation });
    }
  };

  /** Lời gọi, new, JSX bên trong một khai báo → tham chiếu theo tên (giải ở bước gộp). */
  const walk = (node: import('typescript').Node, from: string) => {
    const visit = (n: import('typescript').Node) => {
      if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
        const callee = n.expression;
        const relation = ts.isNewExpression(n) ? 'instantiates' : 'calls';
        if (ts.isIdentifier(callee)) out.refs.push({ from, name: callee.text, relation });
        else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression))
          out.refs.push({ from, name: `${callee.expression.text}.${callee.name.text}`, relation });
      } else if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && ts.isIdentifier(n.tagName) && isComponentName(n.tagName.text)) {
        out.refs.push({ from, name: n.tagName.text, relation: 'renders' });
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
  };

  const isFn = (n: import('typescript').Node | undefined) => Boolean(n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n)));
  /** memo(X), forwardRef(…), observer(…) → vẫn là component. */
  const wrapsComponent = (n: import('typescript').Node | undefined) =>
    Boolean(n && ts.isCallExpression(n) && ts.isIdentifier(n.expression) && /^(memo|forwardRef|observer|styled|lazy)$/.test(n.expression.text));

  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const spec = st.moduleSpecifier.text;
      out.imports.push({ spec, line: lineOf(st) });
      const clause = st.importClause;
      if (clause?.name) out.bindings[clause.name.text] = { spec, imported: 'default' };
      const nb = clause?.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) out.bindings[nb.name.text] = { spec, imported: '*' };
      else if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) out.bindings[el.name.text] = { spec, imported: (el.propertyName ?? el.name).text };
    } else if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
      out.imports.push({ spec: st.moduleSpecifier.text, line: lineOf(st) });
    } else if (ts.isFunctionDeclaration(st) && st.name) {
      const name = st.name.text;
      const id = add(name, jsxFile && isComponentName(name) ? 'component' : 'function', st);
      markExport(st, name, id);
      if (st.body) walk(st.body, id);
    } else if (ts.isClassDeclaration(st) && st.name) {
      const cls = st.name.text;
      const id = add(cls, 'class', st);
      markExport(st, cls, id);
      heritage(id, st.heritageClauses);
      for (const m of st.members) {
        const mName = m.name && (ts.isIdentifier(m.name) || ts.isPrivateIdentifier(m.name)) ? m.name.text : null;
        if (!mName) continue;
        if (ts.isMethodDeclaration(m) || ts.isConstructorDeclaration(m) || (ts.isPropertyDeclaration(m) && isFn(m.initializer))) {
          const mid = add(`${cls}.${mName}`, 'method', m, id, 'method');
          walk(m, mid);
        }
      }
    } else if (ts.isInterfaceDeclaration(st)) {
      const id = add(st.name.text, 'interface', st);
      markExport(st, st.name.text, id);
      heritage(id, st.heritageClauses);
    } else if (ts.isTypeAliasDeclaration(st)) {
      markExport(st, st.name.text, add(st.name.text, 'type', st));
    } else if (ts.isEnumDeclaration(st)) {
      markExport(st, st.name.text, add(st.name.text, 'enum', st));
    } else if (ts.isVariableStatement(st)) {
      const exported = hasMod(st, ts.SyntaxKind.ExportKeyword);
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        const name = d.name.text;
        const fn = isFn(d.initializer);
        const comp = isComponentName(name) && (jsxFile || wrapsComponent(d.initializer)) && (fn || wrapsComponent(d.initializer));
        if (fn || comp || exported) {
          const id = add(name, comp ? 'component' : fn ? 'function' : 'const', d);
          if (exported) out.exports[name] = id;
          if (d.initializer) walk(d.initializer, id);
        } else if (d.initializer) walk(d.initializer, fileId);
      }
    } else if (ts.isExportAssignment(st)) {
      if (ts.isIdentifier(st.expression)) defaultName = st.expression.text;
      else walk(st.expression, fileId);
    } else {
      walk(st, fileId);
    }
  }
  if (defaultName && out.nodes.some((n) => n.id === `${rel}#${defaultName}`)) out.exports.default = `${rel}#${defaultName}`;
  attachRationale(out, rel, text.split(/\r?\n/), spans);
  return out;
}

// ---------------- Python ----------------

const PY_KEYWORDS = new Set([
  'if', 'elif', 'for', 'while', 'with', 'return', 'print', 'and', 'or', 'not', 'in', 'is', 'lambda', 'except', 'assert', 'del', 'yield', 'await', 'raise',
  'super', 'len', 'str', 'int', 'float', 'list', 'dict', 'set', 'tuple', 'range', 'isinstance', 'type', 'open', 'enumerate', 'zip', 'map', 'filter', 'sorted',
  'getattr', 'setattr', 'hasattr', 'bool', 'min', 'max', 'sum', 'any', 'all', 'repr', 'format',
]);

function extractPython(file: SourceFile, text: string): FileExtraction {
  const out = empty(file, text);
  const rel = file.rel;
  const fileId = `file:${rel}`;
  const lines = text.split(/\r?\n/);
  const stack: { indent: number; id: string; kind: 'class' | 'def'; name: string }[] = [];
  const spans: Span[] = [];
  const open = new Map<string, Span>();
  const indentOf = (l: string) => l.length - l.trimStart().length;
  lines.forEach((line, i) => {
    if (!line.trim() || line.trimStart().startsWith('#')) return;
    const ln = i + 1;
    const indent = indentOf(line);
    while (stack.length && indent <= stack[stack.length - 1].indent) {
      const top = stack.pop()!;
      const sp = open.get(top.id);
      if (sp) sp.end = ln - 1;
    }
    const parent = stack[stack.length - 1];
    const def = /^\s*(?:async\s+)?def\s+(\w+)\s*\(/.exec(line);
    const cls = /^\s*class\s+(\w+)\s*(?:\(([^)]*)\))?\s*:/.exec(line);
    if (cls) {
      const name = parent?.kind === 'class' ? `${parent.name}.${cls[1]}` : cls[1];
      const id = `${rel}#${name}`;
      out.nodes.push({ id, label: name, kind: 'class', file: rel, line: ln });
      out.edges.push({ source: parent?.id ?? fileId, target: id, relation: 'contains', confidence: 'EXTRACTED' });
      if (!parent) out.exports[cls[1]] = id;
      for (const b of (cls[2] ?? '').split(',').map((s) => s.trim().split('[')[0]).filter((s) => s && !s.includes('='))) out.refs.push({ from: id, name: b, relation: 'inherits' });
      stack.push({ indent, id, kind: 'class', name });
      const sp = { id, start: ln, end: lines.length };
      spans.push(sp);
      open.set(id, sp);
      return;
    }
    if (def) {
      if (parent?.kind === 'def') return; // hàm lồng: tính vào hàm cha
      const name = parent?.kind === 'class' ? `${parent.name}.${def[1]}` : def[1];
      const id = `${rel}#${name}`;
      out.nodes.push({ id, label: name, kind: parent?.kind === 'class' ? 'method' : 'function', file: rel, line: ln });
      out.edges.push({ source: parent?.id ?? fileId, target: id, relation: parent?.kind === 'class' ? 'method' : 'contains', confidence: 'EXTRACTED' });
      if (!parent) out.exports[def[1]] = id;
      stack.push({ indent, id, kind: 'def', name });
      const sp = { id, start: ln, end: lines.length };
      spans.push(sp);
      open.set(id, sp);
      return;
    }
    const imp = /^\s*import\s+([\w.]+)(?:\s+as\s+(\w+))?/.exec(line);
    if (imp) {
      out.imports.push({ spec: imp[1], line: ln });
      out.bindings[imp[2] ?? imp[1].split('.')[0]] = { spec: imp[1], imported: '*' };
      return;
    }
    const from = /^\s*from\s+([.\w]+)\s+import\s+\(?([^)#]+)/.exec(line);
    if (from) {
      out.imports.push({ spec: from[1], line: ln });
      for (const part of from[2].split(',')) {
        const [imported, local] = part.trim().split(/\s+as\s+/);
        if (imported && imported !== '*') out.bindings[(local ?? imported).trim()] = { spec: from[1], imported: imported.trim() };
      }
      return;
    }
    const owner = [...stack].reverse().find((s) => s.kind === 'def')?.id ?? stack[stack.length - 1]?.id ?? fileId;
    for (const m of line.matchAll(/\b([A-Za-z_][\w]*(?:\.[A-Za-z_]\w*)?)\s*\(/g)) {
      const name = m[1].replace(/^self\./, '');
      if (!PY_KEYWORDS.has(name.split('.')[0]) && !line.trimStart().startsWith('@')) out.refs.push({ from: owner, name, relation: 'calls' });
    }
  });
  attachRationale(out, rel, lines, spans);
  return out;
}

// ---------------- Ngôn ngữ khác (theo mẫu) ----------------

interface LangRules {
  defs: { re: RegExp; kind: NodeKind; name: (m: RegExpExecArray) => string }[];
  imports: RegExp[];
  inherits?: RegExp;
}

const LANG_RULES: Record<string, LangRules> = {
  // Dự phòng cho JS/TS khi máy không có trình biên dịch TypeScript (vd bản desktop đã đóng gói)
  javascript: {
    defs: [
      { re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)/, kind: 'function', name: (m) => m[1] },
      { re: /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|\w+)\s*=>/, kind: 'function', name: (m) => m[1] },
      { re: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/, kind: 'class', name: (m) => m[1] },
    ],
    imports: [/\bfrom\s+['"]([^'"]+)['"]/, /\brequire\(\s*['"]([^'"]+)['"]\s*\)/, /^\s*import\s+['"]([^'"]+)['"]/],
    inherits: /\bclass\s+(\w+)\s+extends\s+([\w.]+)/,
  },
  go: {
    defs: [
      { re: /^func\s+\(\s*\w+\s+\*?(\w+)[^)]*\)\s*(\w+)\s*\(/, kind: 'method', name: (m) => `${m[1]}.${m[2]}` },
      { re: /^func\s+(\w+)\s*[(\[]/, kind: 'function', name: (m) => m[1] },
      { re: /^type\s+(\w+)\s+struct\b/, kind: 'class', name: (m) => m[1] },
      { re: /^type\s+(\w+)\s+interface\b/, kind: 'interface', name: (m) => m[1] },
    ],
    imports: [/^\s*import\s+(?:\w+\s+)?"([^"]+)"/, /^\s+(?:\w+\s+)?"([^"]+)"\s*$/],
  },
  rust: {
    defs: [
      { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:const\s+)?(?:unsafe\s+)?fn\s+(\w+)/, kind: 'function', name: (m) => m[1] },
      { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+(\w+)/, kind: 'class', name: (m) => m[1] },
      { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+(\w+)/, kind: 'enum', name: (m) => m[1] },
      { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+(\w+)/, kind: 'interface', name: (m) => m[1] },
    ],
    imports: [/^\s*use\s+([\w:]+)/, /^\s*mod\s+(\w+)\s*;/],
    inherits: /^\s*impl(?:<[^>]*>)?\s+(\w+)\s+for\s+(\w+)/,
  },
  java: {
    defs: [
      { re: /^\s*(?:public|private|protected|abstract|final|static|sealed|\s)*\s*(?:class|record)\s+(\w+)/, kind: 'class', name: (m) => m[1] },
      { re: /^\s*(?:public|private|protected|\s)*\s*interface\s+(\w+)/, kind: 'interface', name: (m) => m[1] },
      { re: /^\s*(?:public|private|protected|\s)*\s*enum\s+(\w+)/, kind: 'enum', name: (m) => m[1] },
      { re: /^\s+(?:public|private|protected)\s+(?:static\s+|final\s+|synchronized\s+|abstract\s+)*[\w<>\[\],.? ]+\s+(\w+)\s*\([^;]*$/, kind: 'method', name: (m) => m[1] },
    ],
    imports: [/^\s*import\s+(?:static\s+)?([\w.]+)\s*;/],
    inherits: /\b(?:class|interface)\s+(\w+)[^{]*?\b(?:extends|implements)\s+([\w., ]+)/,
  },
  kotlin: {
    defs: [
      { re: /^\s*(?:(?:data|sealed|abstract|open|inner|enum|private|public|internal)\s+)*class\s+(\w+)/, kind: 'class', name: (m) => m[1] },
      { re: /^\s*(?:(?:private|public|internal)\s+)*(?:interface|object)\s+(\w+)/, kind: 'interface', name: (m) => m[1] },
      { re: /^\s*(?:(?:private|public|internal|override|suspend|inline|open)\s+)*fun\s+(?:<[^>]*>\s*)?(?:\w+\.)?(\w+)\s*\(/, kind: 'function', name: (m) => m[1] },
    ],
    imports: [/^\s*import\s+([\w.]+)/],
  },
  csharp: {
    defs: [
      { re: /^\s*(?:public|private|protected|internal|static|abstract|sealed|partial|\s)*\s*(?:class|record|struct)\s+(\w+)/, kind: 'class', name: (m) => m[1] },
      { re: /^\s*(?:public|private|protected|internal|\s)*\s*interface\s+(\w+)/, kind: 'interface', name: (m) => m[1] },
      { re: /^\s*(?:public|private|protected|internal|\s)*\s*enum\s+(\w+)/, kind: 'enum', name: (m) => m[1] },
      { re: /^\s+(?:public|private|protected|internal)\s+(?:static\s+|async\s+|virtual\s+|override\s+|abstract\s+)*[\w<>\[\],.? ]+\s+(\w+)\s*\([^;]*$/, kind: 'method', name: (m) => m[1] },
    ],
    imports: [/^\s*using\s+(?:static\s+)?([\w.]+)\s*;/],
    inherits: /\b(?:class|record|struct|interface)\s+(\w+)[^:{]*:\s*([\w., <>]+)/,
  },
  php: {
    defs: [
      { re: /^\s*(?:abstract\s+|final\s+)?class\s+(\w+)/, kind: 'class', name: (m) => m[1] },
      { re: /^\s*interface\s+(\w+)/, kind: 'interface', name: (m) => m[1] },
      { re: /^\s*(?:public|private|protected|static|\s)*function\s+(\w+)\s*\(/, kind: 'function', name: (m) => m[1] },
    ],
    imports: [/^\s*use\s+([\w\\]+)/, /\b(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/],
    inherits: /\bclass\s+(\w+)[^{]*?\b(?:extends|implements)\s+([\w\\, ]+)/,
  },
  ruby: {
    defs: [
      { re: /^\s*class\s+(\w+)/, kind: 'class', name: (m) => m[1] },
      { re: /^\s*module\s+(\w+)/, kind: 'interface', name: (m) => m[1] },
      { re: /^\s*def\s+(?:self\.)?(\w+[?!]?)/, kind: 'function', name: (m) => m[1] },
    ],
    imports: [/^\s*require(?:_relative)?\s+['"]([^'"]+)['"]/],
    inherits: /^\s*class\s+(\w+)\s*<\s*([\w:]+)/,
  },
  swift: {
    defs: [
      { re: /^\s*(?:(?:public|private|internal|open|final)\s+)*(?:class|struct|actor)\s+(\w+)/, kind: 'class', name: (m) => m[1] },
      { re: /^\s*(?:(?:public|private|internal)\s+)*protocol\s+(\w+)/, kind: 'interface', name: (m) => m[1] },
      { re: /^\s*(?:(?:public|private|internal|open|static|override|mutating)\s+)*func\s+(\w+)/, kind: 'function', name: (m) => m[1] },
    ],
    imports: [/^\s*import\s+(\w+)/],
  },
  scala: {
    defs: [
      { re: /^\s*(?:case\s+)?(?:class|object)\s+(\w+)/, kind: 'class', name: (m) => m[1] },
      { re: /^\s*trait\s+(\w+)/, kind: 'interface', name: (m) => m[1] },
      { re: /^\s*(?:override\s+|private\s+)*def\s+(\w+)/, kind: 'function', name: (m) => m[1] },
    ],
    imports: [/^\s*import\s+([\w.]+)/],
  },
  dart: {
    defs: [
      { re: /^\s*(?:abstract\s+)?class\s+(\w+)/, kind: 'class', name: (m) => m[1] },
      { re: /^\s*(?:[\w<>?]+\s+)?(\w+)\s*\([^;]*\)\s*(?:async\s*)?\{\s*$/, kind: 'function', name: (m) => m[1] },
    ],
    imports: [/^\s*import\s+['"]([^'"]+)['"]/],
    inherits: /\bclass\s+(\w+)[^{]*?\b(?:extends|implements|with)\s+([\w, ]+)/,
  },
  c: {
    defs: [
      { re: /^(?:static\s+|inline\s+|extern\s+)*[\w*\s]+?\b(\w+)\s*\([^;]*\)\s*\{?\s*$/, kind: 'function', name: (m) => m[1] },
      { re: /^\s*(?:typedef\s+)?struct\s+(\w+)\s*\{?/, kind: 'class', name: (m) => m[1] },
    ],
    imports: [/^\s*#\s*include\s+"([^"]+)"/],
  },
  cpp: {
    defs: [
      { re: /^\s*(?:class|struct)\s+(\w+)/, kind: 'class', name: (m) => m[1] },
      { re: /^(?:static\s+|inline\s+|virtual\s+|constexpr\s+)*[\w:*&<>\s]+?\b((?:\w+::)?\w+)\s*\([^;]*\)\s*(?:const\s*)?\{?\s*$/, kind: 'function', name: (m) => m[1].replace('::', '.') },
    ],
    imports: [/^\s*#\s*include\s+"([^"]+)"/],
    inherits: /\b(?:class|struct)\s+(\w+)\s*:\s*(?:public|protected|private)?\s*([\w:]+)/,
  },
  lua: {
    defs: [{ re: /^\s*(?:local\s+)?function\s+([\w.:]+)\s*\(/, kind: 'function', name: (m) => m[1].replace(':', '.') }],
    imports: [/\brequire\s*\(?\s*['"]([^'"]+)['"]/],
  },
};

const CALL_STOP = new Set(['if', 'for', 'while', 'switch', 'return', 'catch', 'sizeof', 'function', 'func', 'fn', 'def', 'new', 'typeof', 'match', 'when', 'elif', 'and', 'or', 'not']);

function extractGeneric(file: SourceFile, text: string): FileExtraction {
  const out = empty(file, text);
  const rules = LANG_RULES[file.language] ?? LANG_RULES.c;
  const rel = file.rel;
  const fileId = `file:${rel}`;
  const lines = text.split(/\r?\n/);
  const spans: Span[] = [];
  let current = fileId;
  const seen = new Set<string>();
  lines.forEach((line, i) => {
    const ln = i + 1;
    if (/^\s*(\/\/|#(?!\s*include)|\*|--)/.test(line) && !/#\s*include/.test(line)) return;
    for (const r of rules.imports) {
      const m = r.exec(line);
      if (m) {
        out.imports.push({ spec: m[1], line: ln });
        const last = m[1].split(/[./\\:]+/).filter(Boolean).pop();
        if (last && /^[A-Z]/.test(last)) out.bindings[last] = { spec: m[1], imported: last };
        return;
      }
    }
    if (rules.inherits) {
      const m = rules.inherits.exec(line);
      if (m) for (const b of m[2].split(',').map((s) => s.trim().split(/[<\s]/)[0]).filter(Boolean)) out.refs.push({ from: `${rel}#${m[1]}`, name: b, relation: file.language === 'rust' ? 'implements' : 'inherits' });
    }
    for (const d of rules.defs) {
      const m = d.re.exec(line);
      if (!m) continue;
      const name = d.name(m);
      if (!name || CALL_STOP.has(name) || seen.has(name)) break;
      seen.add(name);
      const id = `${rel}#${name}`;
      out.nodes.push({ id, label: name, kind: d.kind, file: rel, line: ln });
      out.edges.push({ source: fileId, target: id, relation: 'contains', confidence: 'EXTRACTED' });
      out.exports[name] = id;
      spans.push({ id, start: ln, end: ln + 80 });
      current = d.kind === 'class' || d.kind === 'interface' || d.kind === 'enum' ? current : id;
      return;
    }
    for (const m of line.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) if (!CALL_STOP.has(m[1])) out.refs.push({ from: current, name: m[1], relation: 'calls' });
  });
  attachRationale(out, rel, lines, spans);
  return out;
}

// ---------------- Markdown & SQL ----------------

function extractMarkdown(file: SourceFile, text: string): FileExtraction {
  const out = empty(file, text);
  const rel = file.rel;
  const fileId = `file:${rel}`;
  let current = fileId;
  let inCode = false;
  text.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*```/.test(line)) inCode = !inCode;
    if (inCode) return;
    const h = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      const label = clip(h[2].replace(/[`*_]/g, ''), 80);
      const id = `${rel}#${label}@${i + 1}`;
      out.nodes.push({ id, label, kind: 'section', file: rel, line: i + 1 });
      out.edges.push({ source: fileId, target: id, relation: 'contains', confidence: 'EXTRACTED' });
      current = id;
    }
    for (const m of line.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) if (!/^(https?:|mailto:)/.test(m[1])) out.imports.push({ spec: m[1], line: i + 1, link: true });
    for (const m of line.matchAll(/`([A-Za-z_][\w.]{2,60})(?:\(\))?`/g)) out.refs.push({ from: current, name: m[1], relation: 'mentions' });
  });
  return out;
}

function extractSql(file: SourceFile, text: string): FileExtraction {
  const out = empty(file, text);
  const rel = file.rel;
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?[`"[]?([\w.]+)[`"\]]?\s*\(([\s\S]*?)\)\s*;/gi;
  for (const m of text.matchAll(re)) {
    const name = m[1].split('.').pop()!;
    const line = text.slice(0, m.index).split('\n').length;
    const id = `${rel}#${name}`;
    out.nodes.push({ id, label: name, kind: 'table', file: rel, line });
    out.edges.push({ source: `file:${rel}`, target: id, relation: 'contains', confidence: 'EXTRACTED' });
    out.exports[name] = id;
    for (const r of m[2].matchAll(/references\s+[`"[]?([\w.]+)/gi)) out.refs.push({ from: id, name: r[1].split('.').pop()!, relation: 'references' });
  }
  return out;
}

/** Trích một tệp; lỗi cú pháp → chỉ còn nút tệp (không làm hỏng cả đồ thị). */
export async function extractFile(file: SourceFile, text: string): Promise<FileExtraction> {
  try {
    if (file.language === 'typescript' || file.language === 'javascript') {
      const ts = await loadTypeScript();
      const ext = path.extname(file.rel).toLowerCase();
      if (ts && ext !== '.vue' && ext !== '.svelte') return extractTs(ts, file, text);
      return extractGeneric({ ...file, language: 'javascript' }, text);
    }
    if (file.language === 'python') return extractPython(file, text);
    if (file.language === 'markdown') return extractMarkdown(file, text);
    if (file.language === 'sql') return extractSql(file, text);
    return extractGeneric(file, text);
  } catch {
    return empty(file, text);
  }
}

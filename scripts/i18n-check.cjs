#!/usr/bin/env node
// Kiểm tra đa ngôn ngữ: câu tiếng Việt chưa bọc t()/m(), và câu đã bọc nhưng thiếu bản dịch.
//   node scripts/i18n-check.cjs                 → kiểm tra toàn bộ giao diện (app/**, components/**, lib/catalog…)
//   node scripts/i18n-check.cjs app/office      → chỉ một thư mục / tệp
//   --missing   chỉ liệt kê câu thiếu bản dịch   --unwrapped   chỉ liệt kê câu chưa bọc
//   --unused    liệt kê bản dịch không còn dùng   --keys        in các khoá chưa có bản dịch (dạng JSON)
// Bỏ qua một dòng: thêm chú thích `i18n-ignore` trên dòng đó hoặc dòng ngay trên.
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const VI = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const TARGETS = ['en', 'zh', 'ja', 'ko', 'es', 'fr', 'de', 'th', 'id'];
// Hàm nhận khoá dịch → vị trí tham số chứa khoá.
const KEY_FNS = { t: 0, m: 0, tl: 1, sysMsg: 0, fail: 0, LocalizedError: 0 };
const DEFAULT_SCOPE = ['app', 'components', 'lib/catalog.ts', 'lib/teams.ts', 'lib/connections-catalog.ts', 'lib/client'];
const SKIP_DIRS = new Set(['node_modules', 'api', 'i18n']);

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const targets = args.filter((a) => !a.startsWith('--'));

function walk(p, out) {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    if (SKIP_DIRS.has(path.basename(p)) && !targets.length) return out;
    for (const f of fs.readdirSync(p)) walk(path.join(p, f), out);
  } else if (/\.(tsx?)$/.test(p) && !p.endsWith('.d.ts')) out.push(p);
  return out;
}

function loadCatalog() {
  const dir = path.join(ROOT, 'lib/i18n/messages');
  const merged = new Map();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.ts') || f === 'index.ts') continue;
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const mod = { exports: {} };
    new Function('module', 'exports', 'require', js)(mod, mod.exports, () => ({}));
    const cat = mod.exports.default || {};
    for (const [k, v] of Object.entries(cat)) {
      const prev = merged.get(k) || { locales: {}, files: [] };
      for (const l of TARGETS) if (v[l] && !prev.locales[l]) prev.locales[l] = v[l];
      prev.files.push(f);
      merged.set(k, prev);
    }
  }
  return merged;
}

function check(file, used, unwrapped, dynamic) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
  const ignored = (node) => {
    const l = lineOf(node);
    return /i18n-ignore/.test(lines[l] || '') || /i18n-ignore/.test(lines[l - 1] || '');
  };
  const addUsed = (key, node) => {
    if (!used.has(key)) used.set(key, []);
    used.get(key).push(`${rel}:${lineOf(node) + 1}`);
  };

  function visit(node, covered) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isCallExpression(node) || (ts.isNewExpression(node) && node.arguments)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
      if (name === 'localize') {
        for (const a of node.arguments) collectAll(a);
        return;
      }
      if (name === 'tc' && node.arguments.length >= 2) {
        const [ctx, key] = node.arguments;
        if ((ts.isStringLiteral(ctx) || ts.isNoSubstitutionTemplateLiteral(ctx)) && (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key))) {
          addUsed(`${ctx.text}::${key.text}`, key);
        } else if (!ignored(node)) dynamic.push(`${rel}:${lineOf(node) + 1}: ${node.getText(sf).slice(0, 120)}`);
        node.arguments.slice(2).forEach((a) => visit(a, covered));
        return;
      }
      if (name in KEY_FNS) {
        const idx = KEY_FNS[name];
        node.arguments.forEach((a, i) => {
          if (i === idx) {
            if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) addUsed(a.text, a);
            else if (ts.isCallExpression(a) && ts.isIdentifier(a.expression) && a.expression.text in KEY_FNS) visit(a, covered);
            else if (ts.isConditionalExpression(a)) [a.whenTrue, a.whenFalse].forEach((b) => (ts.isStringLiteral(b) ? addUsed(b.text, b) : visit(b, covered)));
            else if (VI.test(a.getText(sf)) && !ignored(a)) dynamic.push(`${rel}:${lineOf(a) + 1}: ${a.getText(sf).slice(0, 120)}`);
            else visit(a, covered);
          } else visit(a, covered);
        });
        visit(callee, covered);
        return;
      }
    }
    const text =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
        ? node.text
        : ts.isJsxText(node)
          ? node.text.trim()
          : ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
            ? node.text
            : null;
    if (text != null && VI.test(text) && !covered && !ignored(node)) {
      unwrapped.push(`${rel}:${lineOf(node) + 1}: ${text.replace(/\s+/g, ' ').slice(0, 140)}`);
    }
    ts.forEachChild(node, (c) => visit(c, covered));
  }
  function collectAll(node) {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && VI.test(node.text)) addUsed(node.text, node);
    ts.forEachChild(node, collectAll);
  }
  visit(sf, false);
}

const files = (targets.length ? targets : DEFAULT_SCOPE).flatMap((t) => {
  const p = path.resolve(ROOT, t);
  return fs.existsSync(p) ? walk(p, []) : [];
});
const catalog = loadCatalog();
const used = new Map();
const unwrapped = [];
const dynamic = [];
for (const f of files) check(f, used, unwrapped, dynamic);

const missing = [];
for (const [key, where] of used) {
  const entry = catalog.get(key);
  const lack = TARGETS.filter((l) => !entry || !entry.locales[l]);
  if (lack.length) missing.push({ key, lack, where: where[0] });
}

if (flags.has('--keys')) {
  console.log(JSON.stringify(missing.map((m) => m.key), null, 1));
  process.exit(0);
}
const only = flags.has('--missing') ? 'missing' : flags.has('--unwrapped') ? 'unwrapped' : null;
if (only !== 'missing') {
  if (unwrapped.length) console.log(`\n## Câu tiếng Việt chưa bọc t()/m() (${unwrapped.length})\n` + unwrapped.join('\n'));
  if (dynamic.length) console.log(`\n## Khoá dịch không cố định – hãy dùng biến {x} thay vì ghép chuỗi (${dynamic.length})\n` + dynamic.join('\n'));
}
if (only !== 'unwrapped' && missing.length) {
  console.log(`\n## Thiếu bản dịch (${missing.length})`);
  for (const m of missing) console.log(`${m.where}: ${JSON.stringify(m.key)} → thiếu ${m.lack.length === TARGETS.length ? 'tất cả' : m.lack.join(',')}`);
}
if (flags.has('--unused')) {
  const unused = [...catalog.keys()].filter((k) => !used.has(k));
  console.log(`\n## Bản dịch không còn dùng trong phạm vi đã quét (${unused.length})\n` + unused.map((k) => JSON.stringify(k)).join('\n'));
}
console.log(`\n${files.length} tệp · ${used.size} khoá dùng · ${catalog.size} khoá trong từ điển · chưa bọc ${unwrapped.length} · khoá động ${dynamic.length} · thiếu dịch ${missing.length}`);
process.exitCode = unwrapped.length || dynamic.length || missing.length ? 1 : 0;

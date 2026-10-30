// Kho kỹ năng & plugin (giống plugin của Claude Code / Codex): cài kỹ năng dựng sẵn, gói plugin một chạm,
// và cài từ bên ngoài (npm, npx, GitHub, URL).
// An toàn: cài từ bên ngoài chạy 2 bước – xem trước ĐÚNG lệnh sẽ chạy → bạn xác nhận → chạy trong thư mục cách ly
// .vanphong/plugins/<tên> với --ignore-scripts (không chạy mã cài đặt của gói), môi trường không có bí mật.
// Chỉ người dùng gọi được (không có công cụ agent nào gọi tới đây).
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type { InstalledPlugin, McpConnection } from '../types';
import { getLibrarySkill, getPluginBundle } from '../plugins-catalog';
import { getDirectoryConnector } from '../connector-directory';
import { getCollections, newId, now } from './db';
import { emit } from './bus';
import { logActivity } from './activity';
import { appDataDir, runProcess, which } from './platform';
import { githubRaw, parseFrontMatter, saveSkill } from './skills';
import { getDepartment, updateDepartment } from './repo';
import { installDirectoryConnector } from './connectors-install';
import { saveConnection } from './connections';
import { CHILD_ENV } from './agent/adapters/shared';
import { LocalizedError } from './http';

export async function listPlugins(): Promise<InstalledPlugin[]> {
  const c = await getCollections();
  return c.plugins.find().sort({ installedAt: -1 }).toArray();
}

/** Gán kỹ năng cho các phòng (bỏ qua phòng không tồn tại). Trả về phòng đã gán. */
async function assignSkills(keys: string[], departments: string[]): Promise<string[]> {
  const done: string[] = [];
  for (const id of departments) {
    const d = await getDepartment(id);
    if (!d) continue;
    const skills = Array.from(new Set([...(d.skills ?? []), ...keys]));
    if (skills.length !== (d.skills ?? []).length) await updateDepartment(id, { skills }, { by: 'Kho plugin' });
    done.push(id);
  }
  return done;
}

/** Cài (hoặc cập nhật) một kỹ năng từ thư viện dựng sẵn. */
export async function installLibrarySkill(key: string, departments?: string[]): Promise<{ key: string; departments: string[] }> {
  const lib = getLibrarySkill(key);
  if (!lib) throw new Error('Không có kỹ năng này trong thư viện.');
  const c = await getCollections();
  const existing = await c.skills.findOne({ key: lib.key });
  if (existing) await saveSkill({ _id: existing._id, markdown: lib.markdown, note: 'Cập nhật từ thư viện' });
  else await saveSkill({ key: lib.key, name: lib.name, description: lib.description, markdown: lib.markdown, source: { type: 'library', locator: lib.key } });
  const assigned = await assignSkills([lib.key], departments ?? lib.departments);
  return { key: lib.key, departments: assigned };
}

async function recordPlugin(p: Omit<InstalledPlugin, '_id' | 'installedAt' | 'updatedAt'>): Promise<InstalledPlugin> {
  const c = await getCollections();
  const ts = now();
  const same = await c.plugins.findOne({ 'source.type': p.source.type, 'source.locator': p.source.locator });
  const doc: InstalledPlugin = { ...p, _id: same?._id ?? newId(), installedAt: same?.installedAt ?? ts, updatedAt: ts };
  await c.plugins.replaceOne({ _id: doc._id }, doc, { upsert: true });
  await emit('plugin.updated', null, { id: doc._id });
  await logActivity({ action: same ? 'plugin.updated' : 'plugin.installed', entityType: 'plugin', entityId: doc._id, summary: `${same ? 'Cập nhật' : 'Cài'} plugin "${doc.name}" (${doc.skills.length} kỹ năng, ${doc.connections.length} kết nối)` });
  return doc;
}

/**
 * Cài một gói dựng sẵn: kỹ năng (gán cho phòng của gói), kết nối không cần đăng nhập (cài luôn).
 * Kết nối cần token / OAuth trả về để giao diện gợi ý thêm.
 */
export async function installBundle(id: string, opts: { departments?: string[] } = {}): Promise<{ plugin: InstalledPlugin; suggested: string[] }> {
  const bundle = getPluginBundle(id);
  if (!bundle) throw new Error('Không có gói này.');
  const departments = opts.departments ?? bundle.departments;
  const assigned = new Set<string>();
  for (const key of bundle.skills) for (const d of (await installLibrarySkill(key, departments)).departments) assigned.add(d);
  const c = await getCollections();
  const connections: string[] = [];
  const suggested: string[] = [];
  const notes: string[] = [];
  for (const cid of bundle.connectors) {
    const dc = getDirectoryConnector(cid);
    if (!dc) continue;
    const already = await c.mcpConnections.findOne({ directoryId: cid });
    if (already) {
      connections.push(already._id);
      continue;
    }
    // Cần đăng nhập / token, hoặc chạy lệnh trên máy (npx) → để bạn tự thêm ở danh bạ (thấy rõ lệnh trước khi chạy)
    if (dc.auth !== 'none' || dc.transport === 'stdio') {
      suggested.push(cid);
      continue;
    }
    const r = await installDirectoryConnector(cid, {}, { departments: [], pluginId: null });
    connections.push(r.connection._id);
    if (r.error) notes.push(`${dc.name}: ${r.error}`);
  }
  const plugin = await recordPlugin({
    name: bundle.name,
    description: bundle.description,
    version: null,
    source: { type: 'catalog', locator: bundle.id },
    dir: null,
    skills: bundle.skills,
    connections,
    departments: Array.from(assigned),
    notes,
  });
  if (connections.length) await c.mcpConnections.updateMany({ _id: { $in: connections }, pluginId: null }, { $set: { pluginId: plugin._id } });
  return { plugin, suggested };
}

// ---------------- Cài từ bên ngoài (npm / npx / GitHub / URL) ----------------

export interface ExternalPlan {
  id: string;
  kind: 'npm' | 'npx' | 'github' | 'url';
  /** Tên hiển thị của plugin. */
  name: string;
  locator: string;
  /** ĐÚNG các lệnh sẽ chạy (hiển thị để bạn xác nhận). Rỗng = chỉ tải tệp qua HTTPS. */
  commands: string[];
  /** Thư mục cách ly (npm / GitHub). */
  dir: string | null;
  summary: string;
  warnings: string[];
  createdAt: number;
  /** Nội dung để chạy (không cho client sửa). */
  exec: { cmd: string; args: string[] }[];
  npx?: { command: string; args: string[] };
  subPath?: string | null;
}

const gp = globalThis as unknown as { __vpPluginPlans?: Map<string, ExternalPlan> };
const plans: Map<string, ExternalPlan> = (gp.__vpPluginPlans ??= new Map());

const NPM_SPEC = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*(@[a-zA-Z0-9._~^<>=*|+-]{1,64})?$/;
const GITHUB = /^(?:(?:https?:\/\/)?(?:www\.)?github\.com\/|github:|git@github\.com:)?([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?(?:\/tree\/([A-Za-z0-9._/-]+?))?\/?$/;

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'plugin';
}

const quote = (a: string) => (/[\s"'&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
const show = (cmd: string, args: string[]) => [cmd, ...args].map(quote).join(' ');

/**
 * Bước 1 – đọc lệnh / địa chỉ bạn nhập và lập kế hoạch (CHƯA chạy gì):
 * - `npx [-y] <gói> [tham số]` → thêm máy chủ MCP chạy bằng npx (kết nối dịch vụ, tắt sẵn, chờ bạn bật).
 * - `npm install <gói>` / `<gói>` → tải gói vào thư mục cách ly (--ignore-scripts), tìm SKILL.md / .mcp.json.
 * - GitHub (`owner/repo`, https://github.com/…, `git clone …`) → `git clone --depth 1` vào thư mục cách ly.
 * - URL tới SKILL.md → tải về thành kỹ năng.
 */
export async function planExternal(input: string): Promise<Omit<ExternalPlan, 'exec' | 'npx'>> {
  const raw = input.trim().replace(/^\$\s*/, '');
  if (!raw || raw.length > 500 || /[\r\n;&|`$<>]/.test(raw)) throw new Error('Chỉ nhập MỘT lệnh npm / npx, một địa chỉ GitHub hoặc URL (không nối nhiều lệnh).');
  const parts = raw.split(/\s+/);
  const root = path.join(appDataDir(), 'plugins');
  let plan: ExternalPlan;
  const base = { id: crypto.randomBytes(12).toString('hex'), createdAt: Date.now(), warnings: [] as string[] };

  if (parts[0] === 'npx' || (parts[0] === 'pnpm' && parts[1] === 'dlx') || parts[0] === 'bunx') {
    const rest = parts.slice(parts[0] === 'pnpm' ? 2 : 1).filter((p) => p !== '-y' && p !== '--yes');
    const pkg = rest[0] ?? '';
    if (!NPM_SPEC.test(pkg)) throw new LocalizedError('Tên gói không hợp lệ: "{pkg}".', { pkg });
    const args = rest.slice(1).filter((a) => !/^-{1,2}(registry|userconfig|prefix)/.test(a));
    plan = {
      ...base,
      kind: 'npx',
      name: pkg.replace(/@[^/@]+$/, ''),
      locator: [pkg, ...args].join(' '),
      commands: [],
      dir: null,
      summary: `Thêm kết nối dịch vụ (máy chủ MCP) chạy bằng: npx -y ${[pkg, ...args].join(' ')}. Lệnh chỉ chạy khi bạn bật kết nối / tải danh sách thao tác, và mỗi lần agent dùng.`,
      exec: [],
      npx: { command: 'npx', args: ['-y', pkg, ...args] },
    };
    plan.warnings.push('npx tải và chạy mã của gói này trên máy bạn – chỉ dùng gói bạn tin tưởng.');
  } else if (GITHUB.test(parts[parts[0] === 'git' ? 2 : 0] ?? '') && (parts[0] !== 'git' || parts[1] === 'clone')) {
    const loc = parts[0] === 'git' ? parts[2] : parts[0];
    const m = GITHUB.exec(loc)!;
    const [, owner, repo, tree] = m;
    let branch: string | null = null;
    let subPath: string | null = null;
    if (tree) {
      const [b, ...rest] = tree.split('/');
      branch = b;
      subPath = rest.join('/') || null;
    }
    const dir = path.join(root, slug(`${owner}-${repo}`));
    const git = which('git');
    if (!git) throw new Error('Máy chưa cài git – cài Git rồi thử lại (hoặc dán URL tới tệp SKILL.md).');
    const args = ['clone', '--depth', '1', ...(branch ? ['--branch', branch] : []), `https://github.com/${owner}/${repo}.git`, dir];
    plan = {
      ...base,
      kind: 'github',
      name: `${owner}/${repo}${subPath ? `/${subPath}` : ''}`,
      locator: `https://github.com/${owner}/${repo}${tree ? `/tree/${tree}` : ''}`,
      commands: [show('git', args)],
      dir,
      summary: 'Tải mã nguồn về thư mục cách ly (không chạy mã nào), rồi tìm kỹ năng (SKILL.md) và máy chủ MCP (.mcp.json) để cài.',
      exec: [{ cmd: git, args }],
      subPath,
    };
  } else if (/^https?:\/\//i.test(raw)) {
    plan = {
      ...base,
      kind: 'url',
      name: raw.split('/').filter(Boolean).slice(-2).join('/'),
      locator: raw,
      commands: [],
      dir: null,
      summary: `Tải tệp kỹ năng (SKILL.md) từ ${raw} qua HTTPS.`,
      exec: [],
    };
  } else {
    // npm install <gói> | npm i <gói> | pnpm add <gói> | yarn add <gói> | <gói>
    const manager = /^(npm|pnpm|yarn|bun)$/.test(parts[0]);
    // Tên gói trần chỉ được là MỘT từ (chặn "git clone …", "curl …" bị hiểu nhầm thành gói)
    if (!manager && parts.length > 1) throw new Error('Chỉ hỗ trợ "npm install <gói>", "npx <gói>", địa chỉ GitHub hoặc URL.');
    const pkg = manager ? parts.slice(2).find((p) => !p.startsWith('-')) ?? '' : parts[0];
    if (/^(npm|pnpm|yarn|bun)$/.test(parts[0]) && !/^(install|i|add)$/.test(parts[1] ?? '')) throw new Error('Chỉ hỗ trợ "npm install <gói>", "npx <gói>", địa chỉ GitHub hoặc URL.');
    if (!NPM_SPEC.test(pkg)) throw new LocalizedError('Tên gói không hợp lệ: "{pkg}".', { pkg });
    const npm = which('npm');
    if (!npm) throw new Error('Không tìm thấy npm trên máy (cài Node.js).');
    // Tiền tố "npm-": thư mục trùng tên gói thì npm coi là chính dự án và bỏ qua lệnh cài
    const dir = path.join(root, `npm-${slug(pkg.replace(/@[^/@]+$/, ''))}`);
    const args = ['install', '--prefix', dir, '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev', pkg];
    plan = {
      ...base,
      kind: 'npm',
      name: pkg.replace(/@[^/@]+$/, ''),
      // Khớp theo tên gói (không kèm phiên bản) để cài lại / nâng cấp cập nhật đúng plugin cũ
      locator: pkg.replace(/@[^/@]+$/, ''),
      commands: [show('npm', args)],
      dir,
      summary: 'Tải gói từ npm vào thư mục cách ly, KHÔNG chạy mã cài đặt của gói (--ignore-scripts), rồi tìm kỹ năng (SKILL.md) và máy chủ MCP (.mcp.json) để cài.',
      exec: [{ cmd: npm, args }],
    };
  }
  for (const [k, p] of plans) if (Date.now() - p.createdAt > 15 * 60_000) plans.delete(k);
  plans.set(plan.id, plan);
  const { exec: _e, npx: _n, ...visible } = plan;
  void _e;
  void _n;
  return visible;
}

interface Found {
  skills: { file: string; markdown: string }[];
  mcp: { name: string; config: Record<string, unknown> }[];
  manifest: { name?: string; description?: string; version?: string } | null;
  notes: string[];
}

/** Tìm thành phần trong thư mục plugin (theo định dạng plugin của Claude Code: .claude-plugin/plugin.json, skills/*\/SKILL.md, .mcp.json). */
async function scan(root: string): Promise<Found> {
  const found: Found = { skills: [], mcp: [], manifest: null, notes: [] };
  const readJson = async (f: string) => {
    try {
      return JSON.parse(await fs.readFile(f, 'utf8')) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const manifest = (await readJson(path.join(root, '.claude-plugin', 'plugin.json'))) ?? (await readJson(path.join(root, 'vanphong-plugin.json'))) ?? (await readJson(path.join(root, 'package.json')));
  if (manifest) found.manifest = { name: manifest.name ? String(manifest.name) : undefined, description: manifest.description ? String(manifest.description) : undefined, version: manifest.version ? String(manifest.version) : undefined };
  const mcpJson = await readJson(path.join(root, '.mcp.json'));
  const servers = (mcpJson?.mcpServers ?? (manifest as Record<string, unknown> | null)?.mcpServers) as Record<string, Record<string, unknown>> | undefined;
  if (servers && typeof servers === 'object') for (const [name, config] of Object.entries(servers)) found.mcp.push({ name, config });
  let commands = 0;
  let agents = 0;
  const walk = async (dir: string, depth: number) => {
    if (depth > 5 || found.skills.length >= 50) return;
    let items: import('fs').Dirent[];
    try {
      items = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of items) {
      const full = path.join(dir, it.name);
      if (it.isDirectory()) {
        if (['node_modules', '.git'].includes(it.name)) continue;
        if (it.name === 'commands') commands += (await fs.readdir(full).catch(() => [] as string[])).filter((f) => f.endsWith('.md')).length;
        if (it.name === 'agents') agents += (await fs.readdir(full).catch(() => [] as string[])).filter((f) => f.endsWith('.md')).length;
        await walk(full, depth + 1);
      } else if (it.name === 'SKILL.md') {
        const st = await fs.stat(full);
        if (st.size <= 200_000) found.skills.push({ file: full, markdown: await fs.readFile(full, 'utf8') });
      }
    }
  };
  await walk(root, 0);
  if (commands) found.notes.push(`Có ${commands} lệnh "/" (commands) – Văn Phòng AI chưa dùng loại này.`);
  if (agents) found.notes.push(`Có ${agents} agent con (agents) – chưa tự tạo phòng ban; bạn có thể tạo phòng tương ứng ở Sơ đồ tổ chức.`);
  return found;
}

/** Mã kết nối hợp lệ (2–31 ký tự, bắt đầu bằng chữ) và chưa ai dùng. */
async function uniqueKey(name: string): Promise<string> {
  const c = await getCollections();
  let base = slug(name).replace(/^[^a-z]+/, '').slice(0, 24).replace(/-+$/, '');
  if (base.length < 2) base = 'plugin-mcp';
  let key = base;
  for (let i = 2; await c.mcpConnections.findOne({ key }); i++) key = `${base}-${i}`;
  return key;
}

/**
 * Thêm máy chủ MCP của plugin thành kết nối dịch vụ (mới thêm: TẮT, mọi thao tác "Hỏi trước").
 * Cài lại cùng plugin → cập nhật lệnh / địa chỉ, giữ trạng thái bật và quyền bạn đã chỉnh.
 */
async function upsertPluginServer(
  serverName: string,
  input: { transport: 'stdio' | 'http'; command?: string; args?: string[]; url?: string; env?: Record<string, string>; headers?: Record<string, string> },
  pluginId: string,
): Promise<McpConnection | null> {
  const c = await getCollections();
  const name = `${serverName} (plugin)`;
  try {
    const prev = await c.mcpConnections.findOne({ pluginId, name });
    if (prev) return await saveConnection(prev._id, input);
    const conn = await saveConnection(null, { ...input, name, key: await uniqueKey(serverName), kind: 'custom', enabled: false, defaultPolicy: 'ask' });
    await c.mcpConnections.updateOne({ _id: conn._id }, { $set: { pluginId } });
    return conn;
  } catch {
    return null;
  }
}

/** Cấu hình máy chủ trong .mcp.json của plugin → thông số kết nối (${CLAUDE_PLUGIN_ROOT} = thư mục plugin). */
function serverInput(config: Record<string, unknown>, root: string) {
  const sub = (v: unknown) => String(v ?? '').replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, root.split(path.sep).join('/'));
  const map = (v: unknown) => Object.fromEntries(Object.entries((v ?? {}) as Record<string, unknown>).map(([k, x]) => [k, sub(x)]));
  if (typeof config.url === 'string') return { transport: 'http' as const, url: config.url, headers: map(config.headers), env: {} };
  return { transport: 'stdio' as const, command: sub(config.command), args: ((config.args ?? []) as unknown[]).map(sub), env: map(config.env), headers: {} };
}

/** Môi trường cho lệnh cài: bỏ biến chứa bí mật của server (chuỗi kết nối DB, khoá API…), cấm chạy script cài đặt. */
function installEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...CHILD_ENV, npm_config_ignore_scripts: 'true', GIT_TERMINAL_PROMPT: '0' };
  for (const k of Object.keys(process.env)) if (/(KEY|TOKEN|SECRET|PASSWORD|PASSWD|MONGODB|DATABASE_URL|CREDENTIAL)/i.test(k)) env[k] = undefined;
  return env;
}

/** Bước 2 – bạn đã xem và xác nhận: chạy đúng kế hoạch đã lập (không nhận lệnh mới từ client). */
export async function runExternal(planId: string, opts: { departments?: string[] } = {}): Promise<{ plugin: InstalledPlugin; log: string[] }> {
  const plan = plans.get(planId);
  plans.delete(planId);
  if (!plan || Date.now() - plan.createdAt > 15 * 60_000) throw new Error('Kế hoạch cài đã hết hạn – xem trước lại rồi xác nhận.');
  const c = await getCollections();
  // Cài lại cùng nguồn → cập nhật bản ghi cũ (kỹ năng thêm phiên bản, kết nối giữ trạng thái bật / quyền)
  const prevPlugin = await c.plugins.findOne({ 'source.type': plan.kind, 'source.locator': plan.locator });
  const pluginId = prevPlugin?._id ?? newId();
  const log: string[] = [];
  const skills: string[] = [];
  const connections: string[] = [];
  const notes: string[] = [...plan.warnings];
  let name = plan.name;
  let description = '';
  let version: string | null = null;
  const note = `Cài lại plugin ${plan.name}`;

  if (plan.kind === 'npx' && plan.npx) {
    const conn = await upsertPluginServer(plan.name, { transport: 'stdio', command: plan.npx.command, args: plan.npx.args, env: {}, headers: {} }, pluginId);
    if (!conn) throw new Error('Không thêm được kết nối dịch vụ cho lệnh npx này.');
    connections.push(conn._id);
    log.push(`Đã thêm kết nối dịch vụ "${conn.name}" (đang tắt) – bật và bấm "Tải thao tác" ở Kết nối dịch vụ.`);
  } else if (plan.kind === 'url') {
    const url = githubRaw(plan.locator);
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new LocalizedError('Không tải được {url} (HTTP {status}).', { url, status: res.status });
    const markdown = await res.text();
    if (markdown.length > 200_000) throw new Error('Tệp kỹ năng quá lớn (tối đa 200 KB).');
    const prevSkill = prevPlugin?.skills[0] ? await c.skills.findOne({ key: prevPlugin.skills[0] }) : null;
    const s = prevSkill
      ? await saveSkill({ _id: prevSkill._id, markdown, note })
      : await saveSkill({ markdown, source: { type: /github\.com|githubusercontent/.test(url) ? 'github' : 'url', locator: plan.locator } });
    skills.push(s.key);
    name = s.name;
    description = s.description;
    log.push(`${prevSkill ? 'Đã cập nhật' : 'Đã thêm'} kỹ năng "${s.name}".`);
  } else {
    if (!plan.dir) throw new Error('Kế hoạch thiếu thư mục cài.');
    await fs.mkdir(path.dirname(plan.dir), { recursive: true });
    if (plan.kind === 'github') await fs.rm(plan.dir, { recursive: true, force: true });
    if (plan.kind === 'npm') {
      // Dự án riêng cho thư mục cách ly – npm không đi ngược lên thư mục cha tìm package.json
      await fs.mkdir(plan.dir, { recursive: true });
      await fs.writeFile(path.join(plan.dir, 'package.json'), JSON.stringify({ name: 'vanphong-plugin-sandbox', private: true }, null, 2));
    }
    for (const step of plan.exec) {
      log.push(`$ ${show(path.basename(step.cmd).replace(/\.(cmd|exe)$/i, ''), step.args)}`);
      const r = await runProcess(step.cmd, step.args, { cwd: path.dirname(plan.dir), timeoutMs: 5 * 60_000, env: installEnv() });
      const out = `${r.stdout}\n${r.stderr}`.trim();
      if (out) log.push(out.slice(-1500));
      if (r.code !== 0) throw new LocalizedError('Lệnh lỗi (mã {code}): {detail}', { code: String(r.code), detail: (r.stderr || r.error || '').trim().slice(-600) });
    }
    let root = plan.dir;
    if (plan.kind === 'npm') root = path.join(plan.dir, 'node_modules', ...plan.locator.replace(/@[^/@]+$/, '').split('/'));
    if (plan.subPath) root = path.join(root, plan.subPath);
    const found = await scan(root);
    if (found.manifest?.name) name = found.manifest.name;
    description = found.manifest?.description ?? '';
    version = found.manifest?.version ?? null;
    const prevSkills = prevPlugin?.skills.length ? await c.skills.find({ key: { $in: prevPlugin.skills } }).toArray() : [];
    for (const s of found.skills) {
      const fm = parseFrontMatter(s.markdown);
      const prev = prevSkills.find((p) => p.name === fm.name);
      const saved = prev
        ? await saveSkill({ _id: prev._id, markdown: s.markdown, note })
        : await saveSkill({ markdown: s.markdown, source: { type: plan.kind === 'github' ? 'github' : 'path', locator: s.file }, name: fm.name, description: fm.description });
      skills.push(saved.key);
    }
    for (const m of found.mcp) {
      const conn = await upsertPluginServer(m.name, serverInput(m.config, root), pluginId);
      if (conn) connections.push(conn._id);
    }
    notes.push(...found.notes);
    log.push(`Tìm thấy ${found.skills.length} kỹ năng, ${found.mcp.length} máy chủ MCP.`);
    if (found.mcp.length) notes.push('Máy chủ MCP của plugin được thêm ở trạng thái TẮT, mọi thao tác "Hỏi trước" – xem lệnh chạy ở Kết nối dịch vụ rồi mới bật.');
    if (!found.skills.length && !found.mcp.length) notes.push('Không tìm thấy SKILL.md hay .mcp.json trong gói – gói này có thể không phải plugin cho agent.');
  }
  // Máy chủ MCP không còn trong bản mới → gỡ kết nối cũ của plugin
  if (prevPlugin) await c.mcpConnections.deleteMany({ _id: { $in: prevPlugin.connections.filter((id) => !connections.includes(id)) }, pluginId });
  const assigned = opts.departments?.length ? await assignSkills(skills, opts.departments) : [];
  const ts = now();
  const doc: InstalledPlugin = {
    _id: pluginId,
    name,
    description,
    version,
    source: { type: plan.kind, locator: plan.locator, command: plan.commands[0] ?? (plan.npx ? show('npx', plan.npx.args) : null) },
    dir: plan.dir,
    skills,
    connections,
    departments: Array.from(new Set([...(prevPlugin?.departments ?? []), ...assigned])),
    notes,
    installedAt: prevPlugin?.installedAt ?? ts,
    updatedAt: ts,
  };
  await c.plugins.replaceOne({ _id: pluginId }, doc, { upsert: true });
  await emit('plugin.updated', null, { id: pluginId });
  await logActivity({
    action: prevPlugin ? 'plugin.updated' : 'plugin.installed',
    entityType: 'plugin',
    entityId: pluginId,
    summary: `${prevPlugin ? 'Cài lại' : 'Cài'} plugin "${name}" từ ${plan.kind} (${skills.length} kỹ năng, ${connections.length} kết nối)`,
    details: { command: doc.source.command },
  });
  return { plugin: doc, log };
}

/** Gỡ plugin: xoá kết nối nó thêm, (tuỳ chọn) xoá kỹ năng nó thêm, bỏ gán khỏi phòng, xoá thư mục tải về. */
export async function uninstallPlugin(id: string, opts: { removeSkills?: boolean } = {}): Promise<void> {
  const c = await getCollections();
  const p = await c.plugins.findOne({ _id: id });
  if (!p) return;
  await c.mcpConnections.deleteMany({ _id: { $in: p.connections }, pluginId: { $in: [id, null] } });
  if (opts.removeSkills && p.skills.length) {
    // Kỹ năng còn được plugin khác dùng thì giữ lại
    const others = await c.plugins.find({ _id: { $ne: id }, skills: { $in: p.skills } }).toArray();
    const keep = new Set(others.flatMap((o) => o.skills));
    const remove = p.skills.filter((k) => !keep.has(k));
    if (remove.length) {
      await c.skills.deleteMany({ key: { $in: remove } });
      await c.departments.updateMany({}, { $pull: { skills: { $in: remove } } });
      await emit('skill.updated', null, {});
      await emit('department.updated', null, {});
    }
  }
  if (p.dir && p.dir.startsWith(path.join(appDataDir(), 'plugins'))) await fs.rm(p.dir, { recursive: true, force: true }).catch(() => undefined);
  await c.plugins.deleteOne({ _id: id });
  await emit('plugin.updated', null, { id, deleted: true });
  await emit('connection.updated', null, {});
  await logActivity({ action: 'plugin.uninstalled', entityType: 'plugin', entityId: id, summary: `Gỡ plugin "${p.name}"` });
}

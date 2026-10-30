// Duyệt thư mục máy tính (chọn dự án), xem tệp dự án, nhận diện thông tin dự án.
import fs from 'fs/promises';
import fss from 'fs';
import os from 'os';
import path from 'path';
import type { FsEntry, FsListing, ProjectInspection } from '../types';
import { IS_MAC, IS_WIN } from './platform';

const IGNORED_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.venv', 'venv', '__pycache__', 'target', '.turbo', '.cache']);

export async function listRoots(): Promise<{ name: string; path: string }[]> {
  const home = os.homedir();
  const roots: { name: string; path: string }[] = [{ name: 'Thư mục nhà', path: home }];
  for (const [name, sub] of [
    ['Desktop', 'Desktop'],
    ['Tài liệu', 'Documents'],
    ['Tải xuống', 'Downloads'],
  ] as const) {
    const p = path.join(home, sub);
    if (fss.existsSync(p)) roots.push({ name, path: p });
  }
  if (IS_WIN) {
    const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const checks = await Promise.all(
      letters.map(async (l) => {
        const p = `${l}:\\`;
        try {
          await fs.access(p);
          return p;
        } catch {
          return null;
        }
      }),
    );
    for (const p of checks) if (p) roots.push({ name: `Ổ ${p.slice(0, 2)}`, path: p });
  } else {
    roots.push({ name: 'Gốc (/)', path: '/' });
    for (const dir of IS_MAC ? ['/Volumes'] : ['/mnt', '/media']) {
      if (fss.existsSync(dir)) roots.push({ name: dir, path: dir });
    }
  }
  return roots;
}

export async function listDir(target: string | null, opts: { files?: boolean; hidden?: boolean } = {}): Promise<FsListing> {
  const roots = await listRoots();
  const base: Omit<FsListing, 'path' | 'parent' | 'entries'> = { roots, sep: path.sep, platform: process.platform };
  if (!target) return { ...base, path: null, parent: null, entries: [] };
  const abs = path.resolve(target);
  const dirents = await fs.readdir(abs, { withFileTypes: true });
  const entries: FsEntry[] = [];
  for (const d of dirents) {
    if (!opts.hidden && d.name.startsWith('.')) continue;
    if (IS_WIN && /^(\$|System Volume Information|pagefile|hiberfil|swapfile|DumpStack)/i.test(d.name)) continue;
    const full = path.join(abs, d.name);
    let isDir = d.isDirectory();
    if (d.isSymbolicLink()) {
      try {
        isDir = (await fs.stat(full)).isDirectory();
      } catch {
        continue;
      }
    }
    if (!isDir && !opts.files) continue;
    const entry: FsEntry = { name: d.name, path: full, type: isDir ? 'dir' : 'file' };
    if (!isDir) {
      try {
        const st = await fs.stat(full);
        entry.size = st.size;
        entry.modifiedAt = st.mtime.toISOString();
      } catch {
        /* bỏ qua */
      }
    }
    entries.push(entry);
  }
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'vi') : a.type === 'dir' ? -1 : 1));
  const parentPath = path.dirname(abs);
  return { ...base, path: abs, parent: parentPath === abs ? null : parentPath, entries };
}

/** Đảm bảo `rel` nằm trong `root`; trả về đường dẫn tuyệt đối. */
export function resolveInside(root: string, rel: string): string | null {
  const target = path.resolve(root, rel);
  const relative = path.relative(root, target);
  if (relative === '' ) return target;
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return target;
}

/** Đường dẫn thật: giải symlink / junction của phần đã tồn tại (tệp sắp tạo thì giải thư mục cha gần nhất). */
function realish(p: string): string {
  let cur = path.resolve(p);
  const tail: string[] = [];
  for (let i = 0; i < 64; i++) {
    try {
      return path.join(fss.realpathSync.native(cur), ...tail.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) break;
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
  return path.resolve(p);
}

/** target nằm trong root (so theo đường dẫn thật – symlink trỏ ra ngoài thì không tính là bên trong). */
export function isInside(root: string | null, target: string): boolean {
  if (!root) return false;
  const relative = path.relative(realish(root), realish(target));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export async function readTextFile(abs: string, maxBytes = 512 * 1024): Promise<{ content: string; truncated: boolean; binary: boolean; size: number }> {
  const st = await fs.stat(abs);
  const fh = await fs.open(abs, 'r');
  try {
    const len = Math.min(st.size, maxBytes);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, 0);
    const binary = buf.subarray(0, Math.min(len, 8000)).includes(0);
    return { content: binary ? '' : buf.toString('utf8'), truncated: st.size > maxBytes, binary, size: st.size };
  } finally {
    await fh.close();
  }
}

async function countFiles(root: string, limit = 5000): Promise<number> {
  let count = 0;
  const stack = [root];
  while (stack.length && count < limit) {
    const dir = stack.pop()!;
    let items: fss.Dirent[];
    try {
      items = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const it of items) {
      if (it.isDirectory()) {
        if (!IGNORED_DIRS.has(it.name) && !it.name.startsWith('.')) stack.push(path.join(dir, it.name));
      } else count++;
      if (count >= limit) break;
    }
  }
  return count;
}

export async function inspectProject(target: string): Promise<ProjectInspection> {
  const abs = path.resolve(target);
  const result: ProjectInspection = {
    path: abs,
    exists: false,
    isDirectory: false,
    name: path.basename(abs),
    description: '',
    stack: [],
    gitBranch: null,
    fileCount: 0,
    readme: null,
  };
  try {
    const st = await fs.stat(abs);
    result.exists = true;
    result.isDirectory = st.isDirectory();
  } catch {
    return result;
  }
  if (!result.isDirectory) return result;
  const read = async (f: string) => {
    try {
      return await fs.readFile(path.join(abs, f), 'utf8');
    } catch {
      return null;
    }
  };
  const pkg = await read('package.json');
  if (pkg) {
    try {
      const j = JSON.parse(pkg);
      if (j.name) result.name = j.name;
      if (j.description) result.description = j.description;
      const deps = { ...j.dependencies, ...j.devDependencies };
      const known: [string, string][] = [
        ['next', 'Next.js'],
        ['react', 'React'],
        ['vue', 'Vue'],
        ['svelte', 'Svelte'],
        ['@angular/core', 'Angular'],
        ['express', 'Express'],
        ['@nestjs/core', 'NestJS'],
        ['electron', 'Electron'],
        ['typescript', 'TypeScript'],
        ['tailwindcss', 'Tailwind CSS'],
        ['mongodb', 'MongoDB'],
        ['mongoose', 'Mongoose'],
        ['prisma', 'Prisma'],
        ['vite', 'Vite'],
      ];
      for (const [dep, label] of known) if (deps[dep]) result.stack.push(label);
      if (!result.stack.length) result.stack.push('Node.js');
    } catch {
      /* package.json lỗi */
    }
  }
  const markers: [string, string][] = [
    ['pyproject.toml', 'Python'],
    ['requirements.txt', 'Python'],
    ['Cargo.toml', 'Rust'],
    ['go.mod', 'Go'],
    ['composer.json', 'PHP'],
    ['pom.xml', 'Java (Maven)'],
    ['build.gradle', 'Java/Kotlin (Gradle)'],
    ['pubspec.yaml', 'Flutter/Dart'],
    ['Dockerfile', 'Docker'],
  ];
  for (const [f, label] of markers) {
    if (fss.existsSync(path.join(abs, f)) && !result.stack.includes(label)) result.stack.push(label);
  }
  try {
    const sln = (await fs.readdir(abs)).find((f) => f.endsWith('.sln') || f.endsWith('.csproj'));
    if (sln) result.stack.push('.NET');
  } catch {
    /* bỏ qua */
  }
  const readme = (await read('README.md')) ?? (await read('readme.md')) ?? (await read('README'));
  if (readme) {
    result.readme = readme.slice(0, 2000);
    if (!result.description) {
      const para = readme
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l && !l.startsWith('#') && !l.startsWith('!') && !l.startsWith('[') && l.length > 20);
      if (para) result.description = para.slice(0, 300);
    }
  }
  const head = await read('.git/HEAD');
  if (head) result.gitBranch = head.trim().replace('ref: refs/heads/', '');
  result.fileCount = await countFiles(abs);
  return result;
}

/** Cây thư mục rút gọn để đưa vào ngữ cảnh agent. */
export async function treeSummary(root: string, maxEntries = 120): Promise<string> {
  const lines: string[] = [];
  async function walk(dir: string, prefix: string, depth: number) {
    if (lines.length >= maxEntries || depth > 3) return;
    let items: fss.Dirent[];
    try {
      items = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    items.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
    for (const it of items) {
      if (lines.length >= maxEntries) {
        lines.push(`${prefix}…`);
        return;
      }
      if (it.name.startsWith('.') && it.name !== '.env.example') continue;
      if (it.isDirectory()) {
        if (IGNORED_DIRS.has(it.name)) {
          lines.push(`${prefix}${it.name}/ (bỏ qua)`);
          continue;
        }
        lines.push(`${prefix}${it.name}/`);
        await walk(path.join(dir, it.name), prefix + '  ', depth + 1);
      } else lines.push(`${prefix}${it.name}`);
    }
  }
  await walk(root, '', 0);
  return lines.join('\n');
}

export { IGNORED_DIRS };

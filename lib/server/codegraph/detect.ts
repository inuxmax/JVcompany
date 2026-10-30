// Bước 1 – tìm tệp cần phân tích: mã nguồn, tài liệu Markdown, SQL. Bỏ thư mục build / thư viện, tệp quá lớn,
// và các mẫu trong .gitignore / .graphifyignore (hỗ trợ dạng phổ biến: thư mục, *.đuôi, đường dẫn).
import fs from 'fs/promises';
import path from 'path';

export const LANGUAGE_BY_EXT: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.cs': 'csharp',
  '.php': 'php',
  '.rb': 'ruby',
  '.swift': 'swift',
  '.scala': 'scala',
  '.dart': 'dart',
  '.c': 'c',
  '.h': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
  '.lua': 'lua',
  '.vue': 'javascript',
  '.svelte': 'javascript',
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.sql': 'sql',
};

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage', '.venv', 'venv', 'env', '__pycache__', 'target',
  '.turbo', '.cache', '.idea', '.vscode', 'vendor', 'bin', 'obj', '.gradle', '.dart_tool', 'Pods', 'graphify-out', '.vanphong',
]);

export const MAX_FILES = 4000;
const MAX_BYTES = 400 * 1024;

export interface SourceFile {
  /** Đường dẫn tương đối (dấu /). */
  rel: string;
  abs: string;
  language: string;
  size: number;
  mtimeMs: number;
}

/** Mẫu loại trừ đơn giản từ .gitignore / .graphifyignore (không hỗ trợ "!" phủ định). */
function compileIgnore(lines: string[]): (rel: string, isDir: boolean) => boolean {
  const rules = lines
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('!'))
    .map((l) => {
      const dirOnly = l.endsWith('/');
      const anchored = l.startsWith('/');
      const body = l.replace(/^\/|\/$/g, '');
      const re = new RegExp(
        (anchored || body.includes('/') ? '^' : '(^|/)') +
          body
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*\/?/g, '\u0000')
            .replace(/\*/g, '[^/]*')
            .replace(/\?/g, '[^/]')
            .replace(/\u0000/g, '.*') +
          '($|/)',
      );
      return { re, dirOnly };
    });
  return (rel, isDir) => rules.some((r) => (!r.dirOnly || isDir) && r.re.test(rel));
}

async function readLines(file: string): Promise<string[]> {
  try {
    return (await fs.readFile(file, 'utf8')).split(/\r?\n/);
  } catch {
    return [];
  }
}

export async function collectFiles(root: string): Promise<{ files: SourceFile[]; skipped: number }> {
  const ignored = compileIgnore([...(await readLines(path.join(root, '.gitignore'))), ...(await readLines(path.join(root, '.graphifyignore')))]);
  const files: SourceFile[] = [];
  let skipped = 0;
  const stack = [''];
  while (stack.length) {
    const relDir = stack.pop()!;
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(path.join(root, relDir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || (e.name.startsWith('.') && e.name !== '.github') || ignored(rel, true)) continue;
        stack.push(rel);
        continue;
      }
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      const language = LANGUAGE_BY_EXT[ext];
      if (!language || e.name.endsWith('.d.ts') || /\.min\.(js|css)$/.test(e.name) || ignored(rel, false)) continue;
      const abs = path.join(root, rel);
      const st = await fs.stat(abs).catch(() => null);
      if (!st) continue;
      if (st.size > MAX_BYTES || files.length >= MAX_FILES) {
        skipped++;
        continue;
      }
      files.push({ rel, abs, language, size: st.size, mtimeMs: st.mtimeMs });
    }
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return { files, skipped };
}

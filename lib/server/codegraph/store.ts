// Lưu & cập nhật đồ thị của từng dự án: .vanphong/graphs/<projectId>/ (graph.json, report.md, cache.json).
// Cập nhật tăng dần: chỉ trích lại tệp đã đổi (theo thời điểm sửa + kích thước). Không ghi gì vào thư mục dự án.
import fs from 'fs/promises';
import path from 'path';
import type { CodeGraph, FileExtraction } from './types';
import { collectFiles } from './detect';
import { extractFile } from './extract';
import { buildGraph, reportMarkdown } from './build';
import { indexGraph, type GraphIndex } from './query';

const CACHE_VERSION = 1;
/** Trong khoảng này không quét lại thư mục (nhiều nhiệm vụ chạy liền nhau dùng chung kết quả). */
const RECHECK_MS = 60_000;

interface CacheFile {
  version: number;
  root: string;
  files: Record<string, { mtimeMs: number; size: number; ex: FileExtraction }>;
}

interface Entry {
  index: GraphIndex | null;
  checkedAt: number;
  building: Promise<GraphIndex | null> | null;
  error?: string | null;
}

const state = globalThis as unknown as { __vpGraphs?: Map<string, Entry> };
const entries = (state.__vpGraphs ??= new Map());

export function graphDir(projectId: string): string {
  return path.join(process.cwd(), '.vanphong', 'graphs', projectId.replace(/[^\w-]/g, '_'));
}

/** Đường dẫn graph.json (để agent CLI tra bằng scripts/vp-graph.cjs). */
export function graphFile(projectId: string): string {
  return path.join(graphDir(projectId), 'graph.json');
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Đồ thị đã có trên đĩa (không dựng lại). */
export async function loadGraph(projectId: string): Promise<GraphIndex | null> {
  const e = entries.get(projectId);
  if (e?.index) return e.index;
  const g = await readJson<CodeGraph>(graphFile(projectId));
  if (!g || g.schemaVersion !== 1) return null;
  const index = indexGraph(g);
  entries.set(projectId, { index, checkedAt: 0, building: null });
  return index;
}

export function graphState(projectId: string): { building: boolean; error: string | null } {
  const e = entries.get(projectId);
  return { building: Boolean(e?.building), error: e?.error ?? null };
}

const yieldLoop = () => new Promise<void>((r) => setImmediate(r));

async function rebuild(projectId: string, root: string): Promise<GraphIndex> {
  const t0 = Date.now();
  const dir = graphDir(projectId);
  await fs.mkdir(dir, { recursive: true });
  const cachePath = path.join(dir, 'cache.json');
  const old = await readJson<CacheFile>(cachePath);
  const cache: CacheFile = { version: CACHE_VERSION, root, files: {} };
  const reuse = old && old.version === CACHE_VERSION && old.root === root ? old.files : {};
  const { files, skipped } = await collectFiles(root);
  const extractions = new Map<string, FileExtraction>();
  let changed = !old || Object.keys(reuse).length !== files.length;
  let done = 0;
  for (const f of files) {
    const prev = reuse[f.rel];
    let ex: FileExtraction;
    if (prev && prev.mtimeMs === f.mtimeMs && prev.size === f.size) ex = prev.ex;
    else {
      changed = true;
      const text = await fs.readFile(f.abs, 'utf8').catch(() => '');
      ex = await extractFile(f, text);
      // Nhường vòng sự kiện để agent khác đang chạy không bị khựng
      if (++done % 25 === 0) await yieldLoop();
    }
    extractions.set(f.rel, ex);
    cache.files[f.rel] = { mtimeMs: f.mtimeMs, size: f.size, ex };
  }
  const existing = entries.get(projectId)?.index ?? (await loadGraph(projectId));
  if (!changed && existing && existing.graph.root === root) return existing;
  const { graph, index } = buildGraph(root, extractions, { buildMs: 0, skipped });
  graph.stats.buildMs = Date.now() - t0;
  await Promise.all([
    fs.writeFile(path.join(dir, 'graph.json'), JSON.stringify(graph)),
    fs.writeFile(path.join(dir, 'report.md'), reportMarkdown(index)),
    fs.writeFile(cachePath, JSON.stringify(cache)),
  ]);
  return index;
}

/**
 * Đồ thị mới nhất của dự án: dựng lần đầu, sau đó chỉ cập nhật tệp đã đổi. Các lời gọi cùng lúc dùng chung một lần dựng.
 * `force` = quét lại ngay (bỏ qua khoảng chờ 60 giây).
 */
export async function ensureGraph(projectId: string, root: string, opts: { force?: boolean } = {}): Promise<GraphIndex | null> {
  const e: Entry = entries.get(projectId) ?? { index: null, checkedAt: 0, building: null };
  entries.set(projectId, e);
  if (e.building) return e.building;
  if (!opts.force && e.index && Date.now() - e.checkedAt < RECHECK_MS) return e.index;
  const st = await fs.stat(root).catch(() => null);
  if (!st?.isDirectory()) return null;
  e.building = rebuild(projectId, root)
    .then((index) => {
      e.index = index;
      e.error = null;
      return index;
    })
    .catch((err: unknown) => {
      e.error = err instanceof Error ? err.message : String(err);
      console.error('[vanphong] Dựng bản đồ mã lỗi:', err);
      return e.index;
    })
    .finally(() => {
      e.checkedAt = Date.now();
      e.building = null;
    });
  return e.building;
}

/** Xoá bản đồ của dự án (vd khi đổi thư mục dự án). */
export async function dropGraph(projectId: string): Promise<void> {
  entries.delete(projectId);
  await fs.rm(graphDir(projectId), { recursive: true, force: true }).catch(() => undefined);
}

// Tìm đường trên lưới chiếm chỗ (A* 8 hướng + làm mượt bằng kiểm tra tầm nhìn).
import { FD, FW, X0, Z0, obstacles, type Rect } from './layout';

const CELL = 0.25;
const NX = Math.round(FW / CELL);
const NZ = Math.round(FD / CELL);
const INFLATE = 0.22; // bán kính thân người

export interface P2 {
  x: number;
  z: number;
}

class Grid {
  blocked: Uint8Array;
  constructor(rects: Rect[]) {
    this.blocked = new Uint8Array(NX * NZ);
    // Viền ngoài: tường sau / tường trái.
    for (let i = 0; i < NX; i++) for (let k = 0; k < 2; k++) this.blocked[k * NX + i] = 1;
    for (let j = 0; j < NZ; j++) for (let k = 0; k < 2; k++) this.blocked[j * NX + k] = 1;
    for (const r of rects) {
      const i0 = Math.max(0, Math.floor((r.x0 - INFLATE - X0) / CELL));
      const i1 = Math.min(NX - 1, Math.floor((r.x1 + INFLATE - X0) / CELL));
      const j0 = Math.max(0, Math.floor((r.z0 - INFLATE - Z0) / CELL));
      const j1 = Math.min(NZ - 1, Math.floor((r.z1 + INFLATE - Z0) / CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.blocked[j * NX + i] = 1;
    }
  }
  cell(p: P2): [number, number] {
    return [Math.min(NX - 1, Math.max(0, Math.floor((p.x - X0) / CELL))), Math.min(NZ - 1, Math.max(0, Math.floor((p.z - Z0) / CELL)))];
  }
  center(i: number, j: number): P2 {
    return { x: X0 + (i + 0.5) * CELL, z: Z0 + (j + 0.5) * CELL };
  }
  free(i: number, j: number) {
    return i >= 0 && j >= 0 && i < NX && j < NZ && !this.blocked[j * NX + i];
  }
  /** Ô trống gần nhất (vị trí đích có thể nằm sát đồ đạc). */
  nearestFree(i: number, j: number): [number, number] {
    if (this.free(i, j)) return [i, j];
    for (let r = 1; r < 12; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          if (this.free(i + di, j + dj)) return [i + di, j + dj];
        }
      }
    }
    return [i, j];
  }
  lineFree(a: P2, b: P2): boolean {
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(dist / (CELL * 0.5));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const [i, j] = this.cell({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      if (!this.free(i, j)) return false;
    }
    return true;
  }
}

let grid: Grid | null = null;
function getGrid() {
  return (grid ??= new Grid(obstacles()));
}

class Heap {
  items: number[] = [];
  score: Float32Array;
  constructor(score: Float32Array) {
    this.score = score;
  }
  push(n: number) {
    const a = this.items;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.score[a[p]] <= this.score[a[i]]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number | undefined {
    const a = this.items;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.score[a[l]] < this.score[a[m]]) m = l;
        if (r < a.length && this.score[a[r]] < this.score[a[m]]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.items.length;
  }
}

const DIRS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** Điểm đi được gần nhất (khi bấm chọn một điểm có thể trúng đồ đạc/tường). */
export function walkablePoint(p: P2): P2 {
  const g = getGrid();
  const [i, j] = g.cell(p);
  if (g.free(i, j)) return p;
  return g.center(...g.nearestFree(i, j));
}

/** Đường đi từ a tới b (gồm điểm b), đã làm mượt. Trả về [b] nếu không tìm được. */
export function findPath(a: P2, b: P2): P2[] {
  const g = getGrid();
  const [si, sj] = g.nearestFree(...g.cell(a));
  const [ti, tj] = g.nearestFree(...g.cell(b));
  const N = NX * NZ;
  const gScore = new Float32Array(N).fill(Infinity);
  const fScore = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const start = sj * NX + si;
  const goal = tj * NX + ti;
  const h = (i: number, j: number) => {
    const dx = Math.abs(i - ti);
    const dz = Math.abs(j - tj);
    return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz);
  };
  gScore[start] = 0;
  fScore[start] = h(si, sj);
  const open = new Heap(fScore);
  open.push(start);
  let found = false;
  let guard = 0;
  while (open.size && guard++ < 40000) {
    const cur = open.pop()!;
    if (cur === goal) {
      found = true;
      break;
    }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const ci = cur % NX;
    const cj = (cur - ci) / NX;
    for (const [di, dj, cost] of DIRS) {
      const ni = ci + di;
      const nj = cj + dj;
      if (!g.free(ni, nj)) continue;
      if (di && dj && (!g.free(ci + di, cj) || !g.free(ci, cj + dj))) continue; // không cắt góc
      const n = nj * NX + ni;
      if (closed[n]) continue;
      const tentative = gScore[cur] + cost;
      if (tentative < gScore[n]) {
        came[n] = cur;
        gScore[n] = tentative;
        fScore[n] = tentative + h(ni, nj);
        open.push(n);
      }
    }
  }
  if (!found) return [b];
  const cells: P2[] = [];
  for (let n = goal; n !== -1 && n !== start; n = came[n]) {
    const i = n % NX;
    cells.push(g.center(i, (n - i) / NX));
  }
  cells.reverse();
  cells.push(b);
  // Làm mượt: bỏ các điểm trung gian khi có thể đi thẳng.
  const out: P2[] = [];
  let anchor = a;
  let k = 0;
  while (k < cells.length) {
    let far = k;
    for (let m = cells.length - 1; m > k; m--) {
      if (g.lineFree(anchor, cells[m])) {
        far = m;
        break;
      }
    }
    out.push(cells[far]);
    anchor = cells[far];
    k = far + 1;
  }
  return out;
}

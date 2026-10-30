'use client';
// Bản đồ mã của dự án (giao diện lấy từ graph.html của Graphify): đồ thị bấm được – màu theo phân hệ, to nhỏ theo số
// liên kết; tìm kiếm, chi tiết nút (vị trí + kết nối EXTRACTED / INFERRED), hỏi đồ thị đúng như agent, báo cáo,
// và số token tiết kiệm so với đọc toàn bộ mã.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import useSWR, { mutate } from 'swr';
import clsx from 'clsx';
import { ArrowLeft, ArrowRight, Boxes, FileText, GitFork, Hammer, MessageSquareText, Network, Search, Sparkles, Waypoints } from 'lucide-react';
import type { Settings } from '@/lib/types';
import { api } from '@/lib/client/api';
import { compact, timeAgo } from '@/lib/client/format';
import { t } from '@/lib/i18n';
import { Badge, Button, Card, EmptyState, Input, Markdown, Segmented, Skeleton, Spinner, Switch, toast } from './ui';
import { CodeGraph3D, colorOf } from './code-graph-3d';
import { useDarkTheme } from './building/shared';

interface GNode {
  id: string;
  label: string;
  kind: string;
  file?: string;
  line?: number;
  community?: number;
  degree?: number;
}
interface GLink {
  source: string;
  target: string;
  relation: string;
  confidence: 'EXTRACTED' | 'INFERRED';
}
interface Community {
  id: number;
  label: string;
  size: number;
  top: string[];
}
interface GraphResp {
  available: boolean;
  built: boolean;
  building: boolean;
  error?: string | null;
  builtAt?: string;
  stats?: { files: number; nodes: number; edges: number; communities: number; extractedPct: number; corpusTokens: number; mapTokens: number; buildMs: number; skipped: number };
  communities?: Community[];
  gods?: string[];
  nodes?: GNode[];
  links?: GLink[];
  total?: { nodes: number; links: number };
  report?: string;
}
interface NodeDetail {
  node: GNode;
  neighbors: { id: string; label: string; kind: string; file?: string; line?: number; relation: string; confidence: 'EXTRACTED' | 'INFERRED'; dir: 'out' | 'in' }[];
}
interface QueryResp {
  text: string;
  start: string[];
  nodes: string[];
  tokens: number;
}

const where = (n: { file?: string; line?: number }) => (n.file ? `${n.file}${n.line ? `:${n.line}` : ''}` : '');

// ---------------- Đồ thị (canvas + bố cục lực) ----------------

interface Sim {
  ids: string[];
  index: Map<string, number>;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  r: Float32Array;
  comm: Int32Array;
  edges: Uint32Array;
  centers: Map<number, { x: number; y: number }>;
  labelled: Set<number>;
  pinned: Set<number>;
}

function makeSim(nodes: GNode[], links: GLink[]): Sim {
  const n = nodes.length;
  const index = new Map(nodes.map((nd, i) => [nd.id, i]));
  const comms = [...new Set(nodes.map((nd) => nd.community ?? -1))];
  const ring = 38 * Math.sqrt(comms.length + 1);
  const centers = new Map(comms.map((c, i) => [c, { x: Math.cos((i / comms.length) * Math.PI * 2) * ring, y: Math.sin((i / comms.length) * Math.PI * 2) * ring }]));
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const r = new Float32Array(n);
  const comm = new Int32Array(n);
  // Ngẫu nhiên có hạt giống: cùng dữ liệu → cùng bố cục
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  nodes.forEach((nd, i) => {
    const c = centers.get(nd.community ?? -1)!;
    x[i] = c.x + rnd() * 80;
    y[i] = c.y + rnd() * 80;
    r[i] = Math.min(14, 2.6 + Math.sqrt(nd.degree ?? 0) * 0.95);
    comm[i] = nd.community ?? -1;
  });
  const edgeList: number[] = [];
  for (const l of links) {
    const a = index.get(l.source);
    const b = index.get(l.target);
    if (a !== undefined && b !== undefined && a !== b) edgeList.push(a, b);
  }
  const labelled = new Set(
    [...nodes.keys()]
      .filter((i) => nodes[i].kind !== 'file' && nodes[i].kind !== 'doc')
      .sort((a, b) => (nodes[b].degree ?? 0) - (nodes[a].degree ?? 0))
      .slice(0, 28),
  );
  return { ids: nodes.map((nd) => nd.id), index, x, y, vx: new Float32Array(n), vy: new Float32Array(n), r, comm, edges: Uint32Array.from(edgeList), centers, labelled, pinned: new Set() };
}

/** Một bước mô phỏng lực: đẩy nhau, lò xo theo cạnh, hút nhẹ về tâm phân hệ. */
function tick(s: Sim, alpha: number) {
  const n = s.ids.length;
  const { x, y, vx, vy } = s;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = x[i] - x[j];
      const dy = y[i] - y[j];
      const d2 = dx * dx + dy * dy + 1;
      if (d2 > 40000) continue;
      const f = (600 * alpha) / d2;
      vx[i] += dx * f;
      vy[i] += dy * f;
      vx[j] -= dx * f;
      vy[j] -= dy * f;
    }
  }
  for (let e = 0; e < s.edges.length; e += 2) {
    const a = s.edges[e];
    const b = s.edges[e + 1];
    const dx = x[b] - x[a];
    const dy = y[b] - y[a];
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f = ((d - 28) / d) * 0.05 * alpha;
    vx[a] += dx * f;
    vy[a] += dy * f;
    vx[b] -= dx * f;
    vy[b] -= dy * f;
  }
  for (let i = 0; i < n; i++) {
    const c = s.centers.get(s.comm[i]);
    if (c) {
      vx[i] += (c.x - x[i]) * 0.025 * alpha;
      vy[i] += (c.y - y[i]) * 0.025 * alpha;
    }
    vx[i] -= x[i] * 0.006 * alpha;
    vy[i] -= y[i] * 0.006 * alpha;
    if (s.pinned.has(i)) {
      vx[i] = vy[i] = 0;
      continue;
    }
    vx[i] *= 0.6;
    vy[i] *= 0.6;
    // Giới hạn vận tốc: nút chồng nhau lúc đầu không bị bắn văng ra xa
    const sp = Math.hypot(vx[i], vy[i]);
    if (sp > 12) {
      vx[i] *= 12 / sp;
      vy[i] *= 12 / sp;
    }
    x[i] += vx[i];
    y[i] += vy[i];
  }
}

/** Mức phóng & vị trí để phần lõi đồ thị vừa khung (bỏ 5% nút lẻ ngoài cùng mỗi phía, chừa lề). */
function fitView(s: Sim, w: number, h: number): { x: number; y: number; k: number } {
  const n = s.ids.length;
  if (!n) return { x: 0, y: 0, k: 1 };
  const xs = Array.from(s.x).sort((a, b) => a - b);
  const ys = Array.from(s.y).sort((a, b) => a - b);
  const lo = Math.floor(n * 0.05);
  const hi = Math.max(lo, Math.ceil(n * 0.95) - 1);
  const [minX, maxX, minY, maxY] = [xs[lo], xs[hi], ys[lo], ys[hi]];
  const k = Math.min(2.5, (w - 60) / Math.max(1, maxX - minX), (h - 70) / Math.max(1, maxY - minY));
  return { x: -((minX + maxX) / 2) * k, y: -((minY + maxY) / 2) * k, k };
}

function GraphCanvas({
  nodes,
  links,
  selected,
  highlight,
  focusCommunity,
  focusId,
  onSelect,
}: {
  nodes: GNode[];
  links: GLink[];
  selected: string | null;
  highlight: Set<string>;
  focusCommunity: number | null;
  focusId: { id: string; at: number } | null;
  onSelect: (id: string | null) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const sim = useRef<Sim | null>(null);
  const view = useRef({ x: 0, y: 0, k: 0.9 });
  const alpha = useRef(1);
  const dirty = useRef(true);
  const hover = useRef(-1);
  const drag = useRef<{ mode: 'pan' | 'node'; i: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const live = useRef({ selected, highlight, focusCommunity, nodes, onSelect });
  const userMoved = useRef(false);
  const fitted = useRef(false);
  /** Cần căn khung ở khung hình kế tiếp (lúc đó mới biết chắc kích thước thật của khung). */
  const needFit = useRef(true);

  useEffect(() => {
    live.current = { selected, highlight, focusCommunity, nodes, onSelect };
    dirty.current = true;
  }, [selected, highlight, focusCommunity, nodes, onSelect]);

  // Dựng mô phỏng mới khi dữ liệu đổi; chạy trước vài chục bước để lần vẽ đầu đã gọn
  useEffect(() => {
    const s = makeSim(nodes, links);
    let a = 1;
    for (let i = 0; i < 160 && a > 0.04; i++, a *= 0.975) tick(s, a);
    sim.current = s;
    alpha.current = a;
    userMoved.current = false;
    fitted.current = false;
    needFit.current = true;
    dirty.current = true;
  }, [nodes, links]);

  // Đưa nút được chọn từ ô tìm kiếm vào giữa khung
  useEffect(() => {
    const s = sim.current;
    if (!focusId || !s) return;
    const i = s.index.get(focusId.id);
    if (i === undefined) return;
    const k = Math.max(view.current.k, 1.2);
    view.current = { x: -s.x[i] * k, y: -s.y[i] * k, k };
    dirty.current = true;
  }, [focusId]);

  useEffect(() => {
    const el = canvas.current;
    const box = wrap.current;
    if (!el || !box) return;
    const ctx = el.getContext('2d')!;
    let raf = 0;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      el.width = box.clientWidth * dpr;
      el.height = box.clientHeight * dpr;
      el.style.width = `${box.clientWidth}px`;
      el.style.height = `${box.clientHeight}px`;
      if (!userMoved.current) needFit.current = true;
      dirty.current = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(box);
    resize();

    const draw = () => {
      const s = sim.current;
      if (s && needFit.current && box.clientWidth > 50 && box.clientHeight > 50) {
        needFit.current = false;
        view.current = fitView(s, box.clientWidth, box.clientHeight);
        dirty.current = true;
      }      if (s && alpha.current > 0.02) {
        tick(s, alpha.current);
        alpha.current *= 0.985;
        dirty.current = true;
        // Mô phỏng vừa dừng hẳn → căn khung lần cuối theo bố cục đã ổn định
        if (alpha.current <= 0.02 && !fitted.current && !userMoved.current) {
          fitted.current = true;
          view.current = fitView(s, box.clientWidth, box.clientHeight);
        }
      }
      if (s && dirty.current) {
        dirty.current = false;
        const { selected: sel, highlight: hl, focusCommunity: fc, nodes: nds } = live.current;
        const css = getComputedStyle(document.documentElement);
        const fg = css.getPropertyValue('--fg').trim() || '#25211c';
        const bg = css.getPropertyValue('--surface-solid').trim() || '#fffdf8';
        const line = css.getPropertyValue('--line-strong').trim() || 'rgba(64,48,28,.22)';
        const accent = css.getPropertyValue('--accent').trim() || '#c4532a';
        const dpr = window.devicePixelRatio || 1;
        const w = el.width / dpr;
        const h = el.height / dpr;
        const { x: vx, y: vy, k } = view.current;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.translate(w / 2 + vx, h / 2 + vy);
        ctx.scale(k, k);
        const selI = sel ? (s.index.get(sel) ?? -1) : -1;
        const dim = (i: number) => (fc !== null && s.comm[i] !== fc) || (hl.size > 0 && !hl.has(s.ids[i]) && i !== selI);
        // Cạnh
        ctx.lineWidth = 0.7 / k;
        ctx.strokeStyle = line;
        ctx.beginPath();
        for (let e = 0; e < s.edges.length; e += 2) {
          const a = s.edges[e];
          const b = s.edges[e + 1];
          if (dim(a) && dim(b)) continue;
          ctx.moveTo(s.x[a], s.y[a]);
          ctx.lineTo(s.x[b], s.y[b]);
        }
        ctx.stroke();
        // Cạnh của nút đang chọn: đậm, màu nhấn
        if (selI >= 0) {
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1.6 / k;
          ctx.beginPath();
          for (let e = 0; e < s.edges.length; e += 2) {
            const a = s.edges[e];
            const b = s.edges[e + 1];
            if (a !== selI && b !== selI) continue;
            ctx.moveTo(s.x[a], s.y[a]);
            ctx.lineTo(s.x[b], s.y[b]);
          }
          ctx.stroke();
        }
        // Nút (bán kính tối thiểu ~2.2px trên màn hình để luôn thấy được khi thu nhỏ)
        const minR = 2.2 / k;
        for (let i = 0; i < s.ids.length; i++) {
          const rad = Math.max(s.r[i], minR);
          ctx.globalAlpha = dim(i) ? 0.15 : 1;
          ctx.fillStyle = colorOf(s.comm[i]);
          ctx.beginPath();
          if (nds[i]?.kind === 'file' || nds[i]?.kind === 'doc') ctx.rect(s.x[i] - rad * 0.8, s.y[i] - rad * 0.8, rad * 1.6, rad * 1.6);
          else ctx.arc(s.x[i], s.y[i], rad, 0, Math.PI * 2);
          ctx.fill();
          if (i === selI || i === hover.current) {
            ctx.lineWidth = 2 / k;
            ctx.strokeStyle = fg;
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
        // Nhãn: nút trung tâm (khi đủ gần), nút được chọn / rê chuột / tìm thấy
        ctx.font = `600 ${11 / k}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineJoin = 'round';
        const labels = new Set<number>();
        const topN = k >= 0.9 ? 28 : k >= 0.5 ? 16 : 8;
        [...s.labelled].slice(0, topN).forEach((i) => labels.add(i));
        if (selI >= 0) labels.add(selI);
        if (hover.current >= 0) labels.add(hover.current);
        if (hl.size && hl.size <= 40) hl.forEach((id) => {
          const i = s.index.get(id);
          if (i !== undefined) labels.add(i);
        });
        for (const i of labels) {
          if (dim(i) && i !== selI && i !== hover.current) continue;
          const text = nds[i]?.label ?? '';
          const short = text.length > 42 ? `…${text.slice(-41)}` : text;
          ctx.lineWidth = 3 / k;
          ctx.strokeStyle = bg;
          ctx.strokeText(short, s.x[i], s.y[i] - s.r[i] - 4 / k);
          ctx.fillStyle = fg;
          ctx.fillText(short, s.x[i], s.y[i] - s.r[i] - 4 / k);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const toWorld = (px: number, py: number) => {
      const { x, y, k } = view.current;
      return [(px - box.clientWidth / 2 - x) / k, (py - box.clientHeight / 2 - y) / k] as const;
    };
    const hit = (px: number, py: number) => {
      const s = sim.current;
      if (!s) return -1;
      const [wx, wy] = toWorld(px, py);
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < s.ids.length; i++) {
        const d = (s.x[i] - wx) ** 2 + (s.y[i] - wy) ** 2;
        const rr = (s.r[i] + 5 / view.current.k) ** 2;
        if (d < rr && d < bestD) {
          best = i;
          bestD = d;
        }
      }
      return best;
    };
    const pos = (e: PointerEvent | WheelEvent) => {
      const rect = el.getBoundingClientRect();
      return [e.clientX - rect.left, e.clientY - rect.top] as const;
    };
    const down = (e: PointerEvent) => {
      const [px, py] = pos(e);
      const i = hit(px, py);
      el.setPointerCapture(e.pointerId);
      drag.current = i >= 0 ? { mode: 'node', i, sx: px, sy: py, ox: 0, oy: 0, moved: false } : { mode: 'pan', i: -1, sx: px, sy: py, ox: view.current.x, oy: view.current.y, moved: false };
    };
    const move = (e: PointerEvent) => {
      const [px, py] = pos(e);
      const d = drag.current;
      const s = sim.current;
      if (!d) {
        const i = hit(px, py);
        if (i !== hover.current) {
          hover.current = i;
          el.style.cursor = i >= 0 ? 'pointer' : 'grab';
          dirty.current = true;
        }
        return;
      }
      if (Math.abs(px - d.sx) + Math.abs(py - d.sy) > 3) {
        d.moved = true;
        userMoved.current = true;
      }
      if (d.mode === 'pan') {
        view.current = { ...view.current, x: d.ox + px - d.sx, y: d.oy + py - d.sy };
      } else if (s) {
        const [wx, wy] = toWorld(px, py);
        s.x[d.i] = wx;
        s.y[d.i] = wy;
        s.pinned.add(d.i);
        alpha.current = Math.max(alpha.current, 0.15);
      }
      dirty.current = true;
    };
    const up = () => {
      const d = drag.current;
      drag.current = null;
      if (!d || d.moved) return;
      const s = sim.current;
      live.current.onSelect(d.mode === 'node' && s ? s.ids[d.i] : null);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      userMoved.current = true;
      const [px, py] = pos(e);
      const { x, y, k } = view.current;
      const nk = Math.min(5, Math.max(0.12, k * Math.exp(-e.deltaY * 0.0015)));
      const cx = px - box.clientWidth / 2;
      const cy = py - box.clientHeight / 2;
      view.current = { x: cx - ((cx - x) / k) * nk, y: cy - ((cy - y) / k) * nk, k: nk };
      dirty.current = true;
    };
    const fit = () => {
      if (sim.current) view.current = fitView(sim.current, box.clientWidth, box.clientHeight);
      dirty.current = true;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('dblclick', fit);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('dblclick', fit);
    };
  }, []);

  return (
    <div ref={wrap} className="relative h-full w-full touch-none">
      <canvas ref={canvas} className="block cursor-grab" />
    </div>
  );
}

// ---------------- Bảng bên phải ----------------

function ConfidenceBadge({ c }: { c: 'EXTRACTED' | 'INFERRED' }) {
  return (
    <Badge color={c === 'EXTRACTED' ? '#4F8A5B' : '#B8862B'} className="!px-1.5 !text-[10px]">
      {c === 'EXTRACTED' ? t('trực tiếp') : t('suy ra')}
    </Badge>
  );
}

function NodePanel({ projectId, nodeId, communities, onSelect }: { projectId: string; nodeId: string | null; communities: Community[]; onSelect: (id: string) => void }) {
  const { data, isLoading } = useSWR<NodeDetail>(nodeId ? `/api/projects/${projectId}/graph/query?node=${encodeURIComponent(nodeId)}` : null);
  if (!nodeId) return <p className="px-1 py-6 text-center text-[13px] text-muted">{t('Bấm một nút trên đồ thị hoặc tìm theo tên để xem chi tiết.')}</p>;
  if (isLoading || !data) return <Skeleton className="h-40" />;
  const n = data.node;
  const comm = communities.find((c) => c.id === n.community);
  const groups: [string, NodeDetail['neighbors']][] = [
    [t('Nó dùng / gọi tới'), data.neighbors.filter((x) => x.dir === 'out')],
    [t('Được dùng bởi'), data.neighbors.filter((x) => x.dir === 'in')],
  ];
  return (
    <div className="space-y-3">
      <div>
        <div className="font-display text-[17px] leading-tight font-semibold break-all">{n.label}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
          <Badge>{n.kind}</Badge>
          {comm && (
            <Badge color={colorOf(comm.id)}>
              C{comm.id} · {comm.label}
            </Badge>
          )}
          <span>{t('{n} liên kết', { n: n.degree ?? data.neighbors.length })}</span>
        </div>
        {n.file && <div className="mt-1.5 truncate rounded-lg bg-surface-2 px-2 py-1 font-mono text-[11.5px]">{where(n)}</div>}
      </div>
      {groups.map(([title, list]) =>
        list.length ? (
          <div key={title}>
            <div className="mb-1 text-[11.5px] font-semibold tracking-wide text-subtle uppercase">
              {title} ({list.length})
            </div>
            <div className="space-y-0.5">
              {list.slice(0, 60).map((nb) => (
                <button
                  key={`${nb.dir}-${nb.id}-${nb.relation}`}
                  type="button"
                  onClick={() => onSelect(nb.id)}
                  className="flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-[12.5px] hover:bg-surface-3"
                  title={where(nb)}
                >
                  {nb.dir === 'out' ? <ArrowRight className="size-3 shrink-0 text-subtle" /> : <ArrowLeft className="size-3 shrink-0 text-subtle" />}
                  <span className="min-w-0 flex-1 truncate">{nb.label}</span>
                  <span className="shrink-0 font-mono text-[10.5px] text-subtle">{nb.relation}</span>
                  <ConfidenceBadge c={nb.confidence} />
                </button>
              ))}
            </div>
          </div>
        ) : null,
      )}
    </div>
  );
}

function AskPanel({ projectId, onResult }: { projectId: string; onResult: (ids: string[]) => void }) {
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'bfs' | 'dfs'>('bfs');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<QueryResp | null>(null);
  const ask = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    try {
      const r = await api.get<QueryResp>(`/api/projects/${projectId}/graph/query?q=${encodeURIComponent(q)}&mode=${mode}`);
      setRes(r);
      onResult(r.nodes);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-muted">{t('Hỏi như agent hỏi: hệ thống tìm các nút khớp rồi lấy phần đồ thị xung quanh, cắt theo giới hạn token.')}</p>
      <form onSubmit={ask} className="space-y-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Vd: đăng nhập kết nối với cơ sở dữ liệu thế nào?')} />
        <div className="flex items-center justify-between gap-2">
          <Segmented<'bfs' | 'dfs'>
            value={mode}
            onChange={setMode}
            options={[
              { value: 'bfs', label: t('Rộng (BFS)') },
              { value: 'dfs', label: t('Sâu (DFS)') },
            ]}
          />
          <Button type="submit" size="sm" variant="primary" loading={busy} icon={<Search className="size-3.5" />}>
            {t('Hỏi')}
          </Button>
        </div>
      </form>
      {res && (
        <div>
          <div className="mb-1 flex items-center justify-between text-[11.5px] text-subtle">
            <span>{t('Agent sẽ nhận đoạn này')}</span>
            <span className="tabular-nums">{t('≈ {n} token', { n: res.tokens })}</span>
          </div>
          <pre className="max-h-[360px] overflow-auto rounded-xl bg-surface-2 p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">{res.text}</pre>
        </div>
      )}
    </div>
  );
}

// ---------------- Toàn bộ tab ----------------

type PanelTab = 'node' | 'ask' | 'communities' | 'report';

export function CodeGraphPanel({ projectId }: { projectId: string }) {
  const key = `/api/projects/${projectId}/graph`;
  const { data, isLoading } = useSWR<GraphResp>(key);
  const { data: settings } = useSWR<Settings>('/api/settings');
  const [building, setBuilding] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<Set<string>>(() => new Set());
  const [focusCommunity, setFocusCommunity] = useState<number | null>(null);
  const [focusId, setFocusId] = useState<{ id: string; at: number } | null>(null);
  const [tab, setTab] = useState<PanelTab>('node');
  const [mode, setMode] = useState<'3d' | '2d'>('3d');
  const dark = useDarkTheme();
  const [search, setSearch] = useState('');
  const nodes = useMemo(() => data?.nodes ?? [], [data?.nodes]);
  const links = useMemo(() => data?.links ?? [], [data?.links]);
  const matches = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s.length >= 2 ? nodes.filter((n) => n.label.toLowerCase().includes(s)) : [];
  }, [search, nodes]);
  const searchSet = useMemo(() => new Set(matches.map((n) => n.id)), [matches]);
  const enabled = settings?.codeGraph !== false;

  const build = async () => {
    setBuilding(true);
    try {
      const r = await api.post<{ stats: GraphResp['stats'] }>(key, { action: 'build' });
      await mutate(key);
      toast.success(t('Đã dựng bản đồ mã: {files} tệp, {nodes} nút', { files: r.stats?.files ?? 0, nodes: r.stats?.nodes ?? 0 }));
    } catch (e) {
      toast.error(e);
    } finally {
      setBuilding(false);
    }
  };
  const toggle = async (v: boolean) => {
    try {
      await api.patch('/api/settings', { codeGraph: v });
      await mutate('/api/settings');
    } catch (e) {
      toast.error(e);
    }
  };
  const select = (id: string | null) => {
    setSelected(id);
    if (id) setTab('node');
  };

  if (isLoading || !data) return <Skeleton className="h-[560px]" />;
  if (!data.available)
    return (
      <Card className="p-8">
        <EmptyState title={t('Dự án chưa gắn thư mục trên máy')} description={t('Bản đồ mã được dựng từ thư mục mã nguồn của dự án. Gắn thư mục ở Cài đặt dự án để dùng.')} />
      </Card>
    );
  if (!data.built)
    return (
      <Card className="p-8">
        <div className="mx-auto max-w-xl text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-accent/12 text-accent">
            <Network className="size-6" />
          </div>
          <h3 className="mt-4 font-display text-[22px] font-semibold">{t('Bản đồ mã – tiết kiệm token cho agent')}</h3>
          <p className="mt-2 text-[14px] leading-relaxed text-muted">
            {t('Phân tích mã nguồn ngay trên máy (không gọi AI) thành đồ thị tri thức: tệp, hàm, lớp và quan hệ gọi / import / kế thừa. Agent tra bản đồ để biết cần đọc đúng tệp nào thay vì đọc lan man cả thư mục.')}
          </p>
          {data.error && <p className="mt-2 text-[12.5px] text-danger">{data.error}</p>}
          <Button className="mt-5" variant="primary" onClick={build} loading={building || data.building} icon={<Hammer className="size-4" />}>
            {t('Dựng bản đồ mã')}
          </Button>
          <p className="mt-2 text-[12px] text-subtle">{t('Agent cũng tự dựng bản đồ ở lần chạy đầu tiên của dự án.')}</p>
        </div>
      </Card>
    );

  const s = data.stats!;
  const saved = s.corpusTokens > 0 ? Math.max(0, 1 - s.mapTokens / s.corpusTokens) : 0;
  const communities = data.communities ?? [];
  const truncated = (data.total?.nodes ?? 0) > nodes.length;
  const activeHighlight = searchSet.size ? searchSet : highlight;

  return (
    <div className="space-y-4">
      <Card className="grid grid-cols-2 gap-px overflow-hidden sm:grid-cols-3 xl:grid-cols-6">
        {[
          { label: t('Tệp'), value: compact(s.files), sub: s.skipped ? t('bỏ qua {n} tệp lớn', { n: s.skipped }) : t('đã phân tích') },
          { label: t('Nút'), value: compact(s.nodes), sub: t('hàm, lớp, tệp…') },
          { label: t('Cạnh'), value: compact(s.edges), sub: t('{p}% trực tiếp trong mã', { p: s.extractedPct }) },
          { label: t('Phân hệ'), value: String(s.communities), sub: t('chia tự động (Louvain)') },
          { label: t('Đọc toàn bộ mã'), value: `≈${compact(s.corpusTokens)}`, sub: t('token') },
          { label: t('Bản đồ cho agent'), value: `≈${compact(s.mapTokens)}`, sub: t('token · ít hơn {p}%', { p: (saved * 100).toFixed(saved > 0.99 ? 1 : 0) }) },
        ].map((x) => (
          <div key={x.label} className="bg-[var(--surface)] px-4 py-3">
            <div className="text-[11.5px] text-muted">{x.label}</div>
            <div className="font-display text-[20px] leading-7 font-semibold tabular-nums">{x.value}</div>
            <div className="truncate text-[11px] text-subtle">{x.sub}</div>
          </div>
        ))}
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches[0]) {
                select(matches[0].id);
                setFocusId({ id: matches[0].id, at: Date.now() });
              }
            }}
            placeholder={t('Tìm hàm, lớp, tệp… (Enter để tới)')}
            className="pl-9"
          />
        </div>
        {search.trim().length >= 2 && <span className="text-[12px] text-muted">{t('{n} kết quả', { n: matches.length })}</span>}
        <label className="flex items-center gap-2 text-[13px]">
          <Switch checked={enabled} onChange={toggle} label={t('Agent dùng bản đồ mã')} />
          {t('Agent dùng bản đồ mã')}
        </label>
        <span className="text-[12px] text-subtle">
          {data.building ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner className="size-3" /> {t('Đang cập nhật…')}
            </span>
          ) : (
            t('Dựng {time} · {ms} ms', { time: timeAgo(data.builtAt), ms: s.buildMs })
          )}
        </span>
        <Button size="sm" variant="outline" onClick={build} loading={building} icon={<Hammer className="size-3.5" />}>
          {t('Dựng lại')}
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="relative h-[620px] overflow-hidden">
          {mode === '3d' ? (
            <CodeGraph3D nodes={nodes} links={links} selected={selected} highlight={activeHighlight} focusCommunity={focusCommunity} focusId={focusId} dark={dark} onSelect={select} />
          ) : (
            <GraphCanvas nodes={nodes} links={links} selected={selected} highlight={activeHighlight} focusCommunity={focusCommunity} focusId={focusId} onSelect={select} />
          )}
          <div className="absolute top-3 left-3">
            <Segmented<'3d' | '2d'>
              value={mode}
              onChange={setMode}
              options={[
                { value: '3d', label: '3D' }, // i18n-ignore
                { value: '2d', label: '2D' }, // i18n-ignore
              ]}
            />
          </div>
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full bg-[var(--surface-solid)]/90 px-3 py-1.5 text-[11px] text-muted shadow-sm ring-1 ring-line">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block size-2 rounded-[2px] bg-current" /> {t('tệp')}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block size-2 rounded-full bg-current" /> {t('hàm / lớp…')}
            </span>
            <span>{mode === '3d' ? t('Kéo để xoay · cuộn để phóng to · chuột phải để dịch · bấm đúp để về giữa') : t('Kéo để di chuyển · cuộn để phóng to · bấm đúp để về giữa')}</span>
          </div>
          {truncated && (
            <div className="absolute top-3 right-3 rounded-full bg-[var(--surface-solid)]/90 px-3 py-1 text-[11px] text-muted shadow-sm ring-1 ring-line">
              {t('Hiện {shown}/{total} nút quan trọng nhất', { shown: nodes.length, total: data.total?.nodes ?? 0 })}
            </div>
          )}
        </Card>

        <Card className="flex h-[620px] flex-col overflow-hidden">
          <div className="border-b border-line p-2">
            <Segmented<PanelTab>
              value={tab}
              onChange={setTab}
              className="w-full [&>button]:flex-1 [&>button]:px-2"
              options={[
                { value: 'node', label: <Waypoints className="size-4" aria-label={t('Chi tiết')} /> },
                { value: 'ask', label: <MessageSquareText className="size-4" aria-label={t('Hỏi đồ thị')} /> },
                { value: 'communities', label: <Boxes className="size-4" aria-label={t('Phân hệ')} /> },
                { value: 'report', label: <FileText className="size-4" aria-label={t('Báo cáo')} /> },
              ]}
            />
            <div className="mt-1.5 px-1 text-[12px] font-medium text-muted">
              {tab === 'node' ? t('Chi tiết') : tab === 'ask' ? t('Hỏi đồ thị') : tab === 'communities' ? t('Phân hệ') : t('Báo cáo')}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {tab === 'node' && <NodePanel projectId={projectId} nodeId={selected} communities={communities} onSelect={(id) => (select(id), setFocusId({ id, at: Date.now() }))} />}
            {tab === 'ask' && <AskPanel projectId={projectId} onResult={(ids) => setHighlight(new Set(ids))} />}
            {tab === 'communities' && (
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => setFocusCommunity(null)}
                  className={clsx('flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[13px]', focusCommunity === null ? 'bg-surface-3 font-medium' : 'hover:bg-surface-3')}
                >
                  <GitFork className="size-4 text-subtle" /> {t('Tất cả phân hệ')}
                </button>
                {communities
                  .filter((c) => c.size > 1)
                  .map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setFocusCommunity(focusCommunity === c.id ? null : c.id)}
                      className={clsx('flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[13px]', focusCommunity === c.id ? 'bg-surface-3 font-medium' : 'hover:bg-surface-3')}
                    >
                      <span className="size-3 shrink-0 rounded-full" style={{ background: colorOf(c.id) }} />
                      <span className="min-w-0 flex-1 truncate">
                        C{c.id} · {c.label}
                      </span>
                      <span className="shrink-0 text-[11.5px] text-subtle tabular-nums">{c.size}</span>
                    </button>
                  ))}
              </div>
            )}
            {tab === 'report' && (
              <div className="text-[13px]">
                <div className="mb-2 flex items-center gap-1.5 text-[12px] text-muted">
                  <Sparkles className="size-3.5 text-accent" /> {t('Tóm tắt dựng tự động – không dùng AI')}
                </div>
                <Markdown>{data.report ?? ''}</Markdown>
              </div>
            )}
          </div>
        </Card>
      </div>
      {!enabled && <p className="text-[12.5px] text-warn">{t('Agent đang không dùng bản đồ mã – bật lại để tiết kiệm token.')}</p>}
    </div>
  );
}

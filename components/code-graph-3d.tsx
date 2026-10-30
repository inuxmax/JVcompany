'use client';
// Bản đồ mã dạng 3D (three.js): mỗi phân hệ là một cụm trong không gian, nút là khối cầu (tệp là khối vuông) tô màu theo
// phân hệ, cạnh mang màu hai đầu. Kéo để xoay quanh, cuộn để phóng to, chuột phải để dịch; tự xoay chậm cho tới khi bạn chạm.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef, type RefObject } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

export interface GraphNode3D {
  id: string;
  label: string;
  kind: string;
  community?: number;
  degree?: number;
}
export interface GraphLink3D {
  source: string;
  target: string;
}

/** Màu phân hệ: tông đất ấm (không tím / neon). */
export const PALETTE = ['#C4532A', '#4F8A5B', '#B8862B', '#4F7A9A', '#9C5B3E', '#6B8E5A', '#A3743B', '#3E6E8E', '#B5654A', '#5C7F67', '#8B6F47', '#2F6F6A', '#7A5C61', '#557A95', '#9A7B4F', '#6E8B3D'];
export const colorOf = (c?: number) => (c === undefined || c < 0 ? '#9A9083' : PALETTE[c % PALETTE.length]);

const isFile = (n: GraphNode3D) => n.kind === 'file' || n.kind === 'doc';
/** Số nhãn chữ tối đa trên cảnh (gắn sẵn cố định). */
const LABEL_SLOTS = 24;
const radiusOf = (n: GraphNode3D) => Math.min(4, 1 + Math.sqrt(n.degree ?? 0) * 0.3);

interface Layout {
  pos: Float32Array;
  index: Map<string, number>;
  /** Bán kính phần lõi (96% nút) theo mặt ngang và theo chiều đứng – để đặt camera vừa khung. */
  rXZ: number;
  rY: number;
  radius: number;
}

/** Bố cục lực 3D: tâm phân hệ rải trên mặt cầu hơi dẹt (phân hệ lớn quanh "xích đạo" vì khung hình rộng ngang), nút đẩy
 *  nhau, cạnh trong cùng phân hệ là lò xo chặt, cạnh giữa hai phân hệ chỉ kéo nhẹ để các cụm không dính thành một búi. */
function layout3d(nodes: GraphNode3D[], links: GraphLink3D[]): Layout {
  const n = nodes.length;
  const index = new Map(nodes.map((nd, i) => [nd.id, i]));
  const sizes = new Map<number, number>();
  nodes.forEach((nd) => sizes.set(nd.community ?? -1, (sizes.get(nd.community ?? -1) ?? 0) + 1));
  const comms = [...sizes.keys()].sort((a, b) => sizes.get(b)! - sizes.get(a)!);
  const m = comms.length;
  const R = 34 * Math.cbrt(m + 1);
  const pts = Array.from({ length: m }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / m;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * 2.399963; // góc vàng
    return [Math.cos(th) * r, y, Math.sin(th) * r];
  }).sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]));
  const centers = new Map(comms.map((c, i) => [c, [pts[i][0] * R, pts[i][1] * R * 0.6, pts[i][2] * R]] as const));
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const pos = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  nodes.forEach((nd, i) => {
    const c = centers.get(nd.community ?? -1)!;
    pos[i * 3] = c[0] + rnd() * 14;
    pos[i * 3 + 1] = c[1] + rnd() * 14;
    pos[i * 3 + 2] = c[2] + rnd() * 14;
  });
  const edges: number[] = [];
  const sameComm: boolean[] = [];
  for (const l of links) {
    const a = index.get(l.source);
    const b = index.get(l.target);
    if (a === undefined || b === undefined || a === b) continue;
    edges.push(a, b);
    sameComm.push((nodes[a].community ?? -1) === (nodes[b].community ?? -1));
  }
  let alpha = 1;
  for (let it = 0; it < 170 && alpha > 0.03; it++, alpha *= 0.975) {
    for (let i = 0; i < n; i++) {
      const ix = i * 3;
      for (let j = i + 1; j < n; j++) {
        const jx = j * 3;
        const dx = pos[ix] - pos[jx];
        const dy = pos[ix + 1] - pos[jx + 1];
        const dz = pos[ix + 2] - pos[jx + 2];
        const d2 = dx * dx + dy * dy + dz * dz + 1;
        if (d2 > 3600) continue;
        const f = (110 * alpha) / d2;
        vel[ix] += dx * f;
        vel[ix + 1] += dy * f;
        vel[ix + 2] += dz * f;
        vel[jx] -= dx * f;
        vel[jx + 1] -= dy * f;
        vel[jx + 2] -= dz * f;
      }
    }
    for (let e = 0; e < edges.length; e += 2) {
      const a = edges[e] * 3;
      const b = edges[e + 1] * 3;
      const dx = pos[b] - pos[a];
      const dy = pos[b + 1] - pos[a + 1];
      const dz = pos[b + 2] - pos[a + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const same = sameComm[e / 2];
      const f = ((d - (same ? 6 : 10)) / d) * (same ? 0.06 : 0.005) * alpha;
      vel[a] += dx * f;
      vel[a + 1] += dy * f;
      vel[a + 2] += dz * f;
      vel[b] -= dx * f;
      vel[b + 1] -= dy * f;
      vel[b + 2] -= dz * f;
    }
    for (let i = 0; i < n; i++) {
      const ix = i * 3;
      const c = centers.get(nodes[i].community ?? -1)!;
      for (let k = 0; k < 3; k++) {
        vel[ix + k] += (c[k] - pos[ix + k]) * 0.05 * alpha - pos[ix + k] * 0.004 * alpha;
        vel[ix + k] *= 0.6;
      }
      const sp = Math.hypot(vel[ix], vel[ix + 1], vel[ix + 2]);
      if (sp > 4) for (let k = 0; k < 3; k++) vel[ix + k] *= 4 / sp;
      for (let k = 0; k < 3; k++) pos[ix + k] += vel[ix + k];
    }
  }
  // Đưa tâm về gốc toạ độ, đo bán kính phần lõi (bỏ 4% nút lạc ra xa)
  const cen = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) cen[k] += pos[i * 3 + k] / Math.max(1, n);
  const dXZ: number[] = [];
  const dY: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) pos[i * 3 + k] -= cen[k];
    dXZ.push(Math.hypot(pos[i * 3], pos[i * 3 + 2]));
    dY.push(Math.abs(pos[i * 3 + 1]));
  }
  const pct = (a: number[]) => a.sort((x, y) => x - y)[Math.floor(a.length * 0.96)] ?? 30;
  const rXZ = Math.max(20, pct(dXZ));
  const rY = Math.max(14, pct(dY));
  return { pos, index, rXZ, rY, radius: Math.max(rXZ, rY) };
}

/** Vệt sáng tròn (quầng của nút trung tâm). */
function haloTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

type Controls = ComponentRef<typeof OrbitControls>;

interface SceneProps {
  nodes: GraphNode3D[];
  links: GraphLink3D[];
  layout: Layout;
  selected: string | null;
  highlight: Set<string>;
  focusCommunity: number | null;
  focusId: { id: string; at: number } | null;
  fitKey: number;
  dark: boolean;
  /** Các ô nhãn (DOM thường đè lên canvas, gắn sẵn trong CodeGraph3D). */
  labelEls: RefObject<(HTMLSpanElement | null)[]>;
  onSelect: (id: string | null) => void;
}

function Scene({ nodes, links, layout, selected, highlight, focusCommunity, focusId, fitKey, dark, labelEls, onSelect }: SceneProps) {
  const { camera, size } = useThree();
  const controls = useRef<Controls | null>(null);
  const fog = useRef<THREE.Fog>(null);
  const spheres = useRef<THREE.InstancedMesh>(null);
  const cubes = useRef<THREE.InstancedMesh>(null);
  const edgeGeo = useRef<THREE.BufferGeometry>(null);
  const [hovered, setHovered] = useState<number>(-1);
  const halo = useMemo(() => haloTexture(), []);
  const { pos, index, radius, rXZ, rY } = layout;
  const sphereIdx = useMemo(() => nodes.map((n, i) => (isFile(n) ? -1 : i)).filter((i) => i >= 0), [nodes]);
  const cubeIdx = useMemo(() => nodes.map((n, i) => (isFile(n) ? i : -1)).filter((i) => i >= 0), [nodes]);
  const selI = selected ? (index.get(selected) ?? -1) : -1;
  const bg = useMemo(() => new THREE.Color(dark ? '#191613' : '#f4efe6'), [dark]);

  /** Nút bị làm mờ: ngoài phân hệ đang lọc, hoặc không nằm trong kết quả tìm / hỏi. */
  const dimmed = useMemo(() => {
    const out = new Uint8Array(nodes.length);
    nodes.forEach((n, i) => {
      if ((focusCommunity !== null && (n.community ?? -1) !== focusCommunity) || (highlight.size > 0 && !highlight.has(n.id) && i !== selI)) out[i] = 1;
    });
    return out;
  }, [nodes, focusCommunity, highlight, selI]);

  // Vị trí, kích thước, màu từng nút (instanced: hàng trăm nút chỉ 2 lần vẽ)
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    for (const [mesh, list, cube] of [
      [spheres.current, sphereIdx, false],
      [cubes.current, cubeIdx, true],
    ] as const) {
      if (!mesh) continue;
      list.forEach((ni, k) => {
        const r = radiusOf(nodes[ni]) * (cube ? 0.85 : 1) * (ni === selI ? 1.5 : 1);
        m.compose(new THREE.Vector3(pos[ni * 3], pos[ni * 3 + 1], pos[ni * 3 + 2]), q, new THREE.Vector3(r, r, r));
        mesh.setMatrixAt(k, m);
        c.set(colorOf(nodes[ni].community));
        if (dimmed[ni]) c.lerp(bg, 0.82);
        else if (ni === hovered || ni === selI) c.offsetHSL(0, 0.05, 0.12);
        mesh.setColorAt(k, c);
      });
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [nodes, pos, sphereIdx, cubeIdx, dimmed, hovered, selI, bg]);

  // Cạnh: mỗi đầu mang màu phân hệ của nút. Cạnh nối hai phân hệ khác nhau nhạt hẳn (để thấy rõ từng cụm),
  // nền sáng thì pha thêm màu giấy cho cạnh khỏi thành búi chỉ sẫm; cạnh của nút bị làm mờ thì gần như tan vào nền.
  const edgeData = useMemo(() => {
    const p: number[] = [];
    const col: number[] = [];
    const ca = new THREE.Color();
    const cb = new THREE.Color();
    for (const l of links) {
      const a = index.get(l.source);
      const b = index.get(l.target);
      if (a === undefined || b === undefined) continue;
      p.push(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
      ca.set(colorOf(nodes[a].community));
      cb.set(colorOf(nodes[b].community));
      const same = (nodes[a].community ?? -1) === (nodes[b].community ?? -1);
      const fade = dimmed[a] || dimmed[b] ? 0.92 : same ? (dark ? 0 : 0.25) : dark ? 0.6 : 0.62;
      ca.lerp(bg, fade);
      cb.lerp(bg, fade);
      col.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b);
    }
    return { positions: new Float32Array(p), colors: new Float32Array(col) };
  }, [links, index, pos, nodes, dimmed, bg, dark]);
  useLayoutEffect(() => {
    const g = edgeGeo.current;
    if (!g) return;
    g.setAttribute('position', new THREE.BufferAttribute(edgeData.positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(edgeData.colors, 3));
    g.computeBoundingSphere();
  }, [edgeData]);

  // Cạnh của nút đang chọn: đậm, màu nhấn
  const selectedEdges = useMemo(() => {
    if (selI < 0) return null;
    const p: number[] = [];
    for (const l of links) {
      const a = index.get(l.source);
      const b = index.get(l.target);
      if (a === undefined || b === undefined || (a !== selI && b !== selI)) continue;
      p.push(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p), 3));
    return g;
  }, [selI, links, index, pos]);

  // Nút trung tâm (bậc cao nhất) có quầng sáng & nhãn
  const gods = useMemo(
    () =>
      [...nodes.keys()]
        .filter((i) => !isFile(nodes[i]))
        .sort((a, b) => (nodes[b].degree ?? 0) - (nodes[a].degree ?? 0))
        .slice(0, 14),
    [nodes],
  );
  // Nhãn: nút đang chọn, đang rê chuột, kết quả tìm / hỏi, rồi nút trung tâm – tối đa LABEL_SLOTS nhãn
  const labelled = useMemo(() => {
    const s = new Set<number>();
    if (selI >= 0) s.add(selI);
    if (hovered >= 0) s.add(hovered);
    if (highlight.size && highlight.size <= 30)
      highlight.forEach((id) => {
        const i = index.get(id);
        if (i !== undefined) s.add(i);
      });
    gods.slice(0, 12).forEach((i) => s.add(i));
    return [...s].filter((i) => !dimmed[i] || i === selI || i === hovered).slice(0, LABEL_SLOTS);
  }, [gods, selI, hovered, highlight, index, dimmed]);
  // Ghi chữ & màu thẳng vào ô nhãn; ô thừa thì ẩn. Ô đầu (đang chọn / rê chuột) nằm trên cùng.
  useLayoutEffect(() => {
    labelEls.current.forEach((el, slot) => {
      if (!el) return;
      const i = labelled[slot];
      if (i === undefined) {
        el.style.display = 'none';
        return;
      }
      const sel = i === selI;
      el.textContent = nodes[i].label.length > 40 ? `…${nodes[i].label.slice(-39)}` : nodes[i].label;
      el.style.display = 'block';
      el.style.zIndex = String(LABEL_SLOTS - slot);
      el.style.background = sel ? '#E07A4F' : dark ? 'rgba(28,24,20,0.82)' : 'rgba(255,253,248,0.9)';
      el.style.color = sel ? '#fff' : dark ? '#f2e8da' : '#2a231c';
    });
  }, [labelEls, labelled, nodes, selI, dark]);

  // Camera: vừa khung khi dữ liệu đổi / bấm đúp / đổi cỡ khung; bay tới nút khi chọn từ tìm kiếm
  const fly = useRef<{ target: THREE.Vector3; cam: THREE.Vector3; t: number } | null>(null);
  const aspect = size.width / Math.max(1, size.height);
  useEffect(() => {
    // Nhìn hơi chếch xuống (~11°): chiều đứng trên màn hình gồm cả chiều cao khối lẫn một phần chiều sâu
    const halfV = ((camera as THREE.PerspectiveCamera).fov * Math.PI) / 360;
    const halfH = Math.atan(Math.tan(halfV) * aspect);
    const dist = Math.max((rY * 0.98 + rXZ * 0.2) / Math.sin(halfV), rXZ / Math.sin(halfH)) * 1.14;
    fly.current = { target: new THREE.Vector3(0, 0, 0), cam: new THREE.Vector3(dist * 0.17, dist * 0.2, dist * 0.965), t: 0 };
    // Vừa khung lại → tự xoay chậm trở lại
    if (controls.current) controls.current.autoRotate = true;
  }, [rXZ, rY, aspect, camera, fitKey]);
  useEffect(() => {
    if (!focusId) return;
    const i = index.get(focusId.id);
    if (i === undefined) return;
    const target = new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    const dir = camera.position.clone().sub(controls.current?.target ?? new THREE.Vector3()).normalize();
    fly.current = { target, cam: target.clone().add(dir.multiplyScalar(Math.max(45, radius * 0.5))), t: 0 };
    if (controls.current) controls.current.autoRotate = false;
  }, [focusId, index, pos, camera, radius]);
  // Nhãn bám theo nút mỗi khung hình; chồng lên nhau thì ẩn bớt: ưu tiên nút đang chọn / rê chuột, rồi theo thứ tự quan trọng
  const tick = useRef(0);
  const probe = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    const f = fly.current;
    const c = controls.current;
    if (f && c) {
      f.t = Math.min(1, f.t + dt / 0.9);
      const k = 1 - Math.pow(1 - f.t, 3);
      c.target.lerp(f.target, k);
      camera.position.lerp(f.cam, k);
      c.update();
      if (f.t >= 1) fly.current = null;
    }
    // Sương mù đi theo camera: nửa sau của khối nhạt dần → có chiều sâu, đỡ rối
    if (fog.current && c) {
      const d = camera.position.distanceTo(c.target);
      fog.current.near = Math.max(1, d - radius * 0.25);
      fog.current.far = d + radius * 2.3;
    }
    const check = tick.current++ % 4 === 0;
    const boxes: number[][] = [];
    labelled.forEach((i, slot) => {
      const el = labelEls.current[slot];
      if (!el) return;
      probe.set(pos[i * 3], pos[i * 3 + 1] + radiusOf(nodes[i]) + 1.6, pos[i * 3 + 2]).project(camera);
      const x = (probe.x * 0.5 + 0.5) * size.width;
      const y = (-probe.y * 0.5 + 0.5) * size.height;
      el.style.transform = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0) translate(-50%,-50%)`;
      if (!check) return;
      const w = (el.offsetWidth || 80) / 2 + 4;
      const h = (el.offsetHeight || 20) / 2 + 2;
      const box = [x - w, y - h, x + w, y + h];
      const must = i === selI || i === hovered;
      const show = probe.z < 1 && (must || !boxes.some((b) => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3]));
      if (show) boxes.push(box);
      el.style.opacity = show ? '1' : '0';
    });
  });

  const pick = (list: number[]) => (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.instanceId === undefined ? -1 : (list[e.instanceId] ?? -1));
  const hoverHandlers = (list: number[]) => ({
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      const i = pick(list)(e);
      if (i !== hovered) setHovered(i);
      document.body.style.cursor = 'pointer';
    },
    onPointerOut: () => {
      setHovered(-1);
      document.body.style.cursor = '';
    },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      const i = pick(list)(e);
      if (i >= 0) onSelect(nodes[i].id);
    },
  });

  return (
    <>
      <fog ref={fog} attach="fog" args={[bg, radius * 2.2, radius * 5]} />
      <ambientLight intensity={dark ? 0.75 : 0.85} />
      <hemisphereLight args={[dark ? '#fff1dc' : '#fffaf0', dark ? '#2a241e' : '#d9cdb8', dark ? 0.9 : 1.1]} />
      <directionalLight position={[60, 90, 120]} intensity={dark ? 1.1 : 1.4} />
      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        autoRotate
        autoRotateSpeed={0.55}
        rotateSpeed={0.6}
        zoomSpeed={0.9}
        minDistance={8}
        maxDistance={radius * 8}
        // Bạn chạm vào là dừng tự xoay
        onStart={() => {
          if (controls.current) controls.current.autoRotate = false;
        }}
      />
      <lineSegments frustumCulled={false}>
        <bufferGeometry ref={edgeGeo} />
        <lineBasicMaterial vertexColors transparent opacity={dark ? 0.2 : 0.3} depthWrite={false} blending={dark ? THREE.AdditiveBlending : THREE.NormalBlending} />
      </lineSegments>
      {selectedEdges && (
        <lineSegments geometry={selectedEdges} frustumCulled={false}>
          <lineBasicMaterial color="#E07A4F" transparent opacity={0.95} depthWrite={false} />
        </lineSegments>
      )}
      <instancedMesh ref={spheres} args={[undefined, undefined, Math.max(1, sphereIdx.length)]} {...hoverHandlers(sphereIdx)}>
        <sphereGeometry args={[1, 18, 14]} />
        <meshStandardMaterial roughness={0.38} metalness={0.05} emissive={dark ? '#ffffff' : '#000000'} emissiveIntensity={dark ? 0.08 : 0} />
      </instancedMesh>
      <instancedMesh ref={cubes} args={[undefined, undefined, Math.max(1, cubeIdx.length)]} {...hoverHandlers(cubeIdx)}>
        <boxGeometry args={[1.4, 1.4, 1.4]} />
        <meshStandardMaterial roughness={0.5} metalness={0.05} emissive={dark ? '#ffffff' : '#000000'} emissiveIntensity={dark ? 0.06 : 0} />
      </instancedMesh>
      {/* Quầng sáng của nút trung tâm */}
      {gods.map((i) =>
        dimmed[i] ? null : (
          <sprite key={nodes[i].id} position={[pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]} scale={radiusOf(nodes[i]) * 6}>
            <spriteMaterial map={halo} color={colorOf(nodes[i].community)} transparent opacity={dark ? 0.55 : 0.35} depthWrite={false} blending={dark ? THREE.AdditiveBlending : THREE.NormalBlending} />
          </sprite>
        ),
      )}
    </>
  );
}

export function CodeGraph3D({
  nodes,
  links,
  selected,
  highlight,
  focusCommunity,
  focusId,
  dark,
  onSelect,
}: {
  nodes: GraphNode3D[];
  links: GraphLink3D[];
  selected: string | null;
  highlight: Set<string>;
  focusCommunity: number | null;
  focusId: { id: string; at: number } | null;
  dark: boolean;
  onSelect: (id: string | null) => void;
}) {
  // Bố cục tính một lần cho mỗi bộ dữ liệu (vài trăm ms với ~800 nút)
  const layout = useMemo(() => layout3d(nodes, links), [nodes, links]);
  const [fitKey, setFitKey] = useState(0);
  const labelEls = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => () => {
    document.body.style.cursor = '';
  }, []);
  return (
    <div
      className="relative h-full w-full"
      onDoubleClick={() => setFitKey((k) => k + 1)}
      style={{
        background: dark ? 'radial-gradient(ellipse at 50% 45%, #2a241e 0%, #191613 70%)' : 'radial-gradient(ellipse at 50% 45%, #fffdf8 0%, #f1ebe0 75%)',
      }}
    >
      <Canvas dpr={[1, 1.75]} camera={{ fov: 45, near: 0.5, far: 20000, position: [0, 80, 260] }} gl={{ antialias: true, alpha: true }} onPointerMissed={() => onSelect(null)}>
        <Scene
          nodes={nodes}
          links={links}
          layout={layout}
          selected={selected}
          highlight={highlight}
          focusCommunity={focusCommunity}
          focusId={focusId}
          fitKey={fitKey}
          dark={dark}
          labelEls={labelEls}
          onSelect={onSelect}
        />
      </Canvas>
      {/* Bộ nhãn cố định: DOM thường đè lên canvas, Scene chỉ đổi chữ & vị trí. Không dùng <Html> của drei: mỗi nhãn là
          một gốc React riêng, bị gỡ đồng bộ khi tắt cảnh 3D → React báo "synchronously unmount a root while rendering". */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {Array.from({ length: LABEL_SLOTS }, (_, slot) => (
          <span
            key={slot}
            ref={(el) => {
              labelEls.current[slot] = el;
            }}
            className="absolute top-0 left-0 hidden max-w-[220px] truncate rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap shadow-sm ring-1 ring-black/10 transition-opacity duration-200"
          />
        ))}
      </div>
    </div>
  );
}

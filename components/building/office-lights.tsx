'use client';
// Ánh sáng ngày / đêm của cảnh 3D.
// - SceneLights: trời, môi trường, mặt trời – đổi giao diện thì chuyển dần từ ngày sang đêm (không bật/tắt đột ngột).
// - OfficeLights: đèn thả trần dạng thanh trên từng khu. Ban ngày: đèn tắt (chỉ là nội thất). Ban đêm: đèn bật lần lượt
//   từ trái sang phải (nhấp nháy nhẹ lúc mới bật) – thanh phát sáng, quầng sáng, vùng sáng trên sàn và vài đèn điểm
//   (không đổ bóng). Đèn điểm luôn được gắn (cường độ 0 ban ngày) để đổi giao diện không phải biên dịch lại shader.
import { memo, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BILLIARDS, DEPT_SLOTS, MEETING, PANTRY, RECEPTION, WALL_H, ZONES } from './layout';
import type { Theme } from './props';
import { useReducedMotion } from './shared';

/** Thời gian chuyển ngày ↔ đêm (giây). */
const BLEND_SECONDS = 1.1;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (v: number) => v * v * (3 - 2 * v);

/** Mức "đêm" 0 → 1, chuyển dần khi đổi giao diện; lần đầu hiện cảnh thì nhận ngay giá trị đúng. */
export function useNightLevel(dark: boolean): MutableRefObject<number> {
  const level = useRef(dark ? 1 : 0);
  const reduced = useReducedMotion();
  useFrame((_, dt) => {
    const target = dark ? 1 : 0;
    const diff = target - level.current;
    if (reduced || Math.abs(diff) < 0.001) level.current = target;
    else level.current += Math.sign(diff) * Math.min(Math.abs(diff), Math.min(dt, 0.1) / BLEND_SECONDS);
  });
  return level;
}

const DAY = { sky: new THREE.Color('#fffaf0'), ground: new THREE.Color('#cfc4b0'), hemi: 1.2, ambient: 0.35, sun: 2.0, sunColor: new THREE.Color('#fff3e2') };
const NIGHT = { sky: new THREE.Color('#7d6d5b'), ground: new THREE.Color('#2a241e'), hemi: 1.25, ambient: 0.42, sun: 1.05, sunColor: new THREE.Color('#c9d4f0') };
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Ánh sáng chung của cảnh (trời, môi trường, mặt trời có bóng đổ). */
export function SceneLights({ dark }: { dark: boolean }) {
  const hemi = useRef<THREE.HemisphereLight>(null);
  const ambient = useRef<THREE.AmbientLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const level = useNightLevel(dark);
  const start = dark ? NIGHT : DAY;
  useFrame(() => {
    const k = smooth(level.current);
    if (hemi.current) {
      hemi.current.color.lerpColors(DAY.sky, NIGHT.sky, k);
      hemi.current.groundColor.lerpColors(DAY.ground, NIGHT.ground, k);
      hemi.current.intensity = lerp(DAY.hemi, NIGHT.hemi, k);
    }
    if (ambient.current) ambient.current.intensity = lerp(DAY.ambient, NIGHT.ambient, k);
    if (sun.current) {
      sun.current.intensity = lerp(DAY.sun, NIGHT.sun, k);
      sun.current.color.lerpColors(DAY.sunColor, NIGHT.sunColor, k);
    }
  });
  return (
    <>
      <hemisphereLight ref={hemi} args={[start.sky, start.ground, start.hemi]} />
      <ambientLight ref={ambient} intensity={start.ambient} />
      <directionalLight
        ref={sun}
        castShadow
        position={[18, 30, 22]}
        intensity={start.sun}
        color={start.sunColor}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-34}
        shadow-camera-right={34}
        shadow-camera-top={34}
        shadow-camera-bottom={-34}
        shadow-camera-far={120}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />
    </>
  );
}

interface Fixture {
  x: number;
  z: number;
  /** Chiều dài thanh đèn (m). */
  len: number;
  /** Xoay quanh trục đứng (0 = dọc theo trục x). */
  rot?: number;
}

const mid = (a: number, b: number) => (a + b) / 2;

/** Vị trí đèn thả trần: mỗi khu phòng ban, bàn họp, lễ tân, sảnh thang máy, pantry, bi-da, khu nghỉ. */
const FIXTURES: Fixture[] = [
  ...DEPT_SLOTS.map((r, i) => ({ x: mid(r.x0, r.x1), z: mid(r.z0, r.z1) - 0.4, len: i === 0 ? 2.0 : 3.0 })),
  { x: MEETING.table.x, z: MEETING.table.z, len: 3.4 },
  { x: RECEPTION.counter.x, z: mid(RECEPTION.counter.z, RECEPTION.table.z), len: 2.4 },
  { x: mid(ZONES.lobby.x0, ZONES.lobby.x1), z: mid(ZONES.lobby.z0, ZONES.lobby.z1), len: 2.4, rot: Math.PI / 2 },
  { x: PANTRY.counter.x - 0.9, z: PANTRY.counter.z, len: 2.2, rot: Math.PI / 2 },
  { x: BILLIARDS.table.x, z: BILLIARDS.table.z, len: 2.0 },
  { x: 4.0, z: mid(ZONES.chill.z0, ZONES.chill.z1), len: 2.6 },
];

/** Thứ tự bật đèn: quét từ sảnh thang máy (trái) sang phải → độ trễ 0…0.55 của mức đêm. */
const DELAYS: number[] = (() => {
  const order = FIXTURES.map((f, i) => ({ i, x: f.x })).sort((a, b) => a.x - b.x);
  const out = new Array<number>(FIXTURES.length);
  order.forEach((o, rank) => (out[o.i] = (rank / Math.max(1, order.length - 1)) * 0.55));
  return out;
})();

/** Đèn điểm thật: lưới 3 × 2 phủ cả tầng, đặt cao để ánh sáng loang đều. */
const POINT_LIGHTS: [number, number][] = [
  [-9.5, -5.2],
  [0.5, -5.2],
  [10.5, -5.2],
  [-9.5, 5.0],
  [0.5, 4.2],
  [10.5, 5.0],
];

const LAMP_Y = WALL_H - 0.38;
const WARM = '#FFD9A3';
const BAR_GLOW = 2.6;
const HALO_OPACITY = 0.55;
const POOL_OPACITY = 0.28;
const POINT_INTENSITY = 34;

/** Vệt sáng tròn mờ dần (dùng cho quầng đèn và vùng sáng trên sàn). */
function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function OfficeLightsImpl({ t }: { t: Theme }) {
  const glow = useMemo(() => glowTexture(), []);
  const level = useNightLevel(t.dark);
  const bars = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const halos = useRef<(THREE.Mesh | null)[]>([]);
  const pools = useRef<(THREE.Mesh | null)[]>([]);
  const points = useRef<(THREE.PointLight | null)[]>([]);
  const lastLevel = useRef(-1);
  useFrame(({ clock }) => {
    const night = level.current;
    // Đứng yên (ngày hoặc đêm đã bật xong) → không cần cập nhật
    if (night === lastLevel.current && (night === 0 || night === 1)) return;
    lastLevel.current = night;
    const time = clock.elapsedTime;
    FIXTURES.forEach((_, i) => {
      let on = clamp01((night - DELAYS[i]) / 0.3);
      // Nhấp nháy nhẹ như đèn tuýp lúc mới bật
      if (on > 0 && on < 1 && Math.sin(time * 38 + i * 1.7) < -0.35) on *= 0.25;
      const bar = bars.current[i];
      if (bar) bar.emissiveIntensity = BAR_GLOW * on;
      for (const [list, opacity] of [
        [halos.current, HALO_OPACITY],
        [pools.current, POOL_OPACITY],
      ] as const) {
        const mesh = list[i];
        if (!mesh) continue;
        mesh.visible = on > 0.001;
        (mesh.material as THREE.MeshBasicMaterial).opacity = opacity * on;
      }
    });
    const lit = smooth(clamp01((night - 0.15) / 0.7));
    for (const p of points.current) if (p) p.intensity = POINT_INTENSITY * lit;
  });
  const startOn = t.dark ? 1 : 0;
  return (
    <group>
      {FIXTURES.map((f, i) => (
        <group key={i} position={[f.x, 0, f.z]} rotation={[0, f.rot ?? 0, 0]}>
          {/* Dây treo */}
          {[-f.len / 2 + 0.2, f.len / 2 - 0.2].map((dx) => (
            <mesh key={dx} position={[dx, (LAMP_Y + WALL_H) / 2, 0]}>
              <cylinderGeometry args={[0.008, 0.008, WALL_H - LAMP_Y, 4]} />
              <meshBasicMaterial color={t.frame} />
            </mesh>
          ))}
          {/* Thanh đèn */}
          <mesh position={[0, LAMP_Y, 0]}>
            <boxGeometry args={[f.len, 0.05, 0.16]} />
            <meshStandardMaterial
              ref={(m) => {
                bars.current[i] = m;
              }}
              color={t.wallTrim}
              emissive="#FFF1DA"
              emissiveIntensity={BAR_GLOW * startOn}
              roughness={0.6}
              toneMapped={false}
            />
          </mesh>
          {/* Quầng sáng quanh thanh đèn */}
          <mesh
            ref={(m) => {
              halos.current[i] = m;
            }}
            visible={startOn > 0}
            position={[0, LAMP_Y + 0.03, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            renderOrder={1}
          >
            <planeGeometry args={[f.len + 1.4, 1.3]} />
            <meshBasicMaterial map={glow} color={WARM} transparent opacity={HALO_OPACITY * startOn} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
          </mesh>
          {/* Vùng sáng hắt xuống sàn */}
          <mesh
            ref={(m) => {
              pools.current[i] = m;
            }}
            visible={startOn > 0}
            position={[0, 0.006, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            renderOrder={1}
          >
            <planeGeometry args={[f.len + 3.6, 4.2]} />
            <meshBasicMaterial map={glow} color={WARM} transparent opacity={POOL_OPACITY * startOn} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
        </group>
      ))}
      {POINT_LIGHTS.map(([x, z], i) => (
        <pointLight
          key={`${x}:${z}`}
          ref={(l) => {
            points.current[i] = l;
          }}
          position={[x, 4.4, z]}
          color={WARM}
          intensity={POINT_INTENSITY * startOn}
          distance={16}
          decay={2}
        />
      ))}
    </group>
  );
}

/** Không phụ thuộc dữ liệu nhiệm vụ → chỉ vẽ lại khi đổi giao diện sáng/tối. */
export const OfficeLights = memo(OfficeLightsImpl);

// ---------------- Cảnh toà nhà (nhìn từ ngoài) ----------------

let sharedGlow: THREE.CanvasTexture | null = null;
/** Một vệt sáng dùng chung cho mọi tầng (khỏi tạo lại texture). */
const glowTex = () => (sharedGlow ??= glowTexture());

/** Đèn trần mỗi tầng: 3 × 3 thanh. */
const LEVEL_BARS: [number, number][] = [-9, 0, 9].flatMap((x) => [-4.5, 0.5, 5.5].map((z) => [x, z] as [number, number]));
/** Tầng đang làm dự án sáng rõ, tầng trống chỉ bật đèn đêm, sảnh sáng vừa. */
const LEVEL_MODE = {
  busy: { bar: 2.6, pool: 0.24, point: 40 },
  lobby: { bar: 2.2, pool: 0.2, point: 30 },
  idle: { bar: 1.5, pool: 0.13, point: 18 },
} as const;

function LevelLightsImpl({ ceiling, mode, t }: { ceiling: number; mode: keyof typeof LEVEL_MODE; t: Theme }) {
  const glow = glowTex();
  const level = useNightLevel(t.dark);
  const target = LEVEL_MODE[mode];
  const bars = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const pool = useRef<THREE.Mesh>(null);
  const point = useRef<THREE.PointLight>(null);
  const last = useRef('');
  useFrame(() => {
    const k = smooth(level.current);
    const key = `${k.toFixed(3)}|${mode}`;
    if (key === last.current) return;
    last.current = key;
    for (const m of bars.current) if (m) m.emissiveIntensity = target.bar * k;
    if (pool.current) {
      pool.current.visible = k > 0.001;
      (pool.current.material as THREE.MeshBasicMaterial).opacity = target.pool * k;
    }
    if (point.current) point.current.intensity = target.point * k;
  });
  const start = t.dark ? 1 : 0;
  return (
    <group>
      {LEVEL_BARS.map(([x, z], i) => (
        <mesh key={i} position={[x, ceiling, z]}>
          <boxGeometry args={[5, 0.06, 0.18]} />
          <meshStandardMaterial
            ref={(m) => {
              bars.current[i] = m;
            }}
            color={t.wallTrim}
            emissive="#FFF1DA"
            emissiveIntensity={target.bar * start}
            toneMapped={false}
          />
        </mesh>
      ))}
      <mesh ref={pool} visible={start > 0} position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
        <planeGeometry args={[30, 19]} />
        <meshBasicMaterial map={glow} color={WARM} transparent opacity={target.pool * start} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <pointLight ref={point} position={[0, ceiling - 0.4, 1]} color={WARM} intensity={target.point * start} distance={24} decay={2} />
    </group>
  );
}

/** Đèn của một tầng trong cảnh toà nhà (đặt trong nhóm của tầng để nâng lên cùng tầng). */
export const LevelLights = memo(LevelLightsImpl);

function GroundGlowImpl({ t }: { t: Theme }) {
  const glow = glowTex();
  const level = useNightLevel(t.dark);
  const mesh = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const k = smooth(level.current);
    if (!mesh.current) return;
    mesh.current.visible = k > 0.001;
    (mesh.current.material as THREE.MeshBasicMaterial).opacity = 0.42 * k;
  });
  return (
    <mesh ref={mesh} visible={t.dark} position={[0, -0.34, 1]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
      <planeGeometry args={[68, 52]} />
      <meshBasicMaterial map={glow} color={WARM} transparent opacity={t.dark ? 0.42 : 0} blending={THREE.AdditiveBlending} depthWrite={false} />
    </mesh>
  );
}

/** Ánh đèn hắt ra mặt đất quanh chân toà nhà ban đêm. */
export const GroundGlow = memo(GroundGlowImpl);

'use client';
// Cảnh toàn toà nhà: tầng trệt (sảnh + phòng CEO) và 5 tầng làm việc, thang máy kính chạy theo lịch của CEO tổng.
import { useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { FloorView } from '@/lib/types';
import { t } from '@/lib/i18n';
import { BILLIARDS, ELEVATOR, FD, FW, MEETING, RECEPTION, X0, Z0, assignSlots, workstation } from './layout';
import { Box, Plant, type Theme } from './props';
import { ceoPlan } from './sim';
import { floorTexture, signTexture } from './textures';
import { GroundGlow, LevelLights } from './office-lights';
import type { DeptWithTasks } from './shared';

export const LEVEL_H = 4.4;
export const LEVELS = 6; // trệt + 5 tầng
/** Khi vào một tầng, các tầng phía trên nâng lên chừng này để mở tầng đó ra. */
const LIFT = 8.5;

/** Chuyến thang máy của bạn (CEO) trong cảnh toà nhà. */
export interface TowerRide {
  from: number;
  to: number;
  ms: number;
}

const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

export interface TowerLabel {
  el: HTMLDivElement;
}

function Pawn({ x, z, color, glow }: { x: number; z: number; color: string; glow?: boolean }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.55, 0]} castShadow>
        <capsuleGeometry args={[0.22, 0.5, 4, 10]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      <mesh position={[0, 1.15, 0]} castShadow>
        <sphereGeometry args={[0.2, 14, 12]} />
        <meshStandardMaterial color="#E8C29E" roughness={0.6} />
      </mesh>
      {glow && (
        <mesh position={[0, 1.65, 0]}>
          <sphereGeometry args={[0.12, 10, 10]} />
          <meshStandardMaterial color="#E0B44A" emissive="#E0B44A" emissiveIntensity={2} />
        </mesh>
      )}
    </group>
  );
}

function Level({
  level,
  floor,
  departments,
  t,
  onPick,
  highlight,
  setHover,
}: {
  level: number;
  floor: FloorView | null;
  departments: DeptWithTasks[];
  t: Theme;
  onPick: (n: number) => void;
  /** 0 = thường, 1 = rê chuột, 2 = đang vào tầng này. */
  highlight: 0 | 1 | 2;
  setHover: (n: number | null) => void;
}) {
  const tex = useMemo(() => floorTexture(t.dark, FW, FD), [t.dark]);
  const enabled = departments.filter((d) => d.enabled);
  const slots = useMemo(() => assignSlots(enabled.map((d) => d._id)), [enabled]);
  const projectId = floor?.project?._id ?? null;
  const busy = Boolean(projectId);
  return (
    <group position={[0, level * LEVEL_H, 0]}>
      <Box size={[FW + 0.4, 0.34, FD + 0.4]} position={[0, -0.17, 0]} color={t.slab} receive />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]} receiveShadow>
        <planeGeometry args={[FW, FD]} />
        <meshStandardMaterial
          map={tex}
          roughness={0.6}
          emissive="#E0B44A"
          // Ban đêm: sàn ánh vàng ấm như đèn trong nhà (tầng đang làm sáng nhất, sảnh vừa, tầng trống nhẹ)
          emissiveIntensity={(t.dark ? (busy ? 0.3 : level === 0 ? 0.2 : 0.1) : busy ? 0.05 : 0) + [0, 0.07, 0.22][highlight]}
        />
      </mesh>
      {/* Ban đêm: đèn trần, vùng sáng trên sàn, đèn chiếu – tầng đang làm sáng rõ, tầng trống chỉ bật đèn đêm */}
      <LevelLights ceiling={LEVEL_H - 0.55} mode={level === 0 ? 'lobby' : busy ? 'busy' : 'idle'} t={t} />
      {/* Viền sáng quanh tầng đang vào */}
      {highlight === 2 &&
        [
          [FW + 0.5, 0, FD / 2 + 0.22],
          [FW + 0.5, 0, -FD / 2 - 0.22],
        ]
          .map(([w, x, z], i) => (
            <mesh key={`h${i}`} position={[x, 0.02, z]}>
              <boxGeometry args={[w, 0.07, 0.07]} />
              <meshStandardMaterial color="#E0B44A" emissive="#E0B44A" emissiveIntensity={2.4} />
            </mesh>
          ))
          .concat(
            [-FW / 2 - 0.22, FW / 2 + 0.22].map((x, i) => (
              <mesh key={`v${i}`} position={[x, 0.02, 0]}>
                <boxGeometry args={[0.07, 0.07, FD + 0.5]} />
                <meshStandardMaterial color="#E0B44A" emissive="#E0B44A" emissiveIntensity={2.4} />
              </mesh>
            )),
          )}
      {/* Tường sau kính + tường trái */}
      <mesh position={[0, LEVEL_H / 2 - 0.2, Z0 - 0.06]}>
        <boxGeometry args={[FW, LEVEL_H - 0.4, 0.05]} />
        <meshStandardMaterial
          color={t.window}
          transparent
          opacity={0.35}
          depthWrite={false}
          emissive="#FFD9A3"
          emissiveIntensity={t.dark ? (busy || level === 0 ? 0.4 : 0.18) : 0}
        />
      </mesh>
      <Box size={[0.24, LEVEL_H - 0.35, FD + 0.2]} position={[X0 - 0.12, (LEVEL_H - 0.35) / 2, 0]} color={t.wall} receive />
      {/* Mặt kính phía trước (nhìn xuyên vào trong) */}
      {Array.from({ length: 11 }).map((_, i) => (
        <Box key={i} size={[0.1, LEVEL_H - 0.35, 0.1]} position={[X0 + i * 3, (LEVEL_H - 0.35) / 2, FD / 2 + 0.15]} color={t.frame} cast={false} />
      ))}
      <Box size={[FW + 0.3, 0.12, 0.14]} position={[0, LEVEL_H - 0.4, FD / 2 + 0.15]} color={t.frame} cast={false} />

      {level === 0 ? (
        <group>
          {/* Tầng trệt: sảnh lễ tân + phòng CEO + cửa chính */}
          <Box size={[RECEPTION.counter.w * 1.4, 1.05, 0.8]} position={[-8, 0.52, 2]} color={t.paper} />
          <Box size={[6, 2.6, 0.2]} position={[-8, 1.3, 0.6]} color={t.woodDark} />
          <Box size={[2.6, 0.45, 0.85]} position={[-12, 0.22, 6]} color="#3F8A93" />
          <Box size={[2.6, 0.45, 0.85]} position={[-4, 0.22, 6]} color="#C9952F" />
          {/* Phòng CEO (kính) */}
          <mesh position={[8, 1.3, -4.5]}>
            <boxGeometry args={[9, 2.6, 7]} />
            <meshStandardMaterial color={t.glass} transparent opacity={0.22} depthWrite={false} />
          </mesh>
          <Box size={[2.8, 0.8, 1.1]} position={[8, 0.4, -5]} color={t.wood} />
          <Box size={[3.2, 0.06, 2.0]} position={[0, 0.02, 7.5]} color="#C4532A" cast={false} />
          {[
            [-13.5, 8],
            [13.5, 8],
            [13.5, -8],
            [-3, -8],
          ].map(([x, z], i) => (
            <Plant key={i} x={x} z={z} s={1.2} t={t} />
          ))}
        </group>
      ) : (
        <group>
          {/* Khu phòng ban giản lược */}
          {enabled.map((d) => {
            const slot = slots.get(d._id);
            if (slot === undefined) return null;
            const ws = workstation(slot);
            const tasks = d.activeTasks.filter((x) => x.projectId === projectId);
            const working = tasks.some((x) => x.status === 'running');
            return (
              <group key={d._id}>
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(ws.rect.x0 + ws.rect.x1) / 2, 0.01, (ws.rect.z0 + ws.rect.z1) / 2]}>
                  <planeGeometry args={[ws.rect.x1 - ws.rect.x0 - 0.3, ws.rect.z1 - ws.rect.z0 - 0.3]} />
                  <meshStandardMaterial color={d.color} transparent opacity={working ? 0.35 : 0.14} depthWrite={false} />
                </mesh>
                {ws.desks.map((k, i) => (
                  <Box key={i} size={[k.w, 0.75, k.d]} position={[k.x, 0.375, k.z]} color={t.deskTop} />
                ))}
                <Pawn x={ws.seat.x} z={ws.seat.z} color={d.color} glow={working} />
              </group>
            );
          })}
          <Box size={[MEETING.table.w, 0.75, MEETING.table.d]} position={[MEETING.table.x, 0.375, MEETING.table.z]} color={t.wood} />
          <Box size={[BILLIARDS.table.w, 0.85, BILLIARDS.table.d]} position={[BILLIARDS.table.x, 0.42, BILLIARDS.table.z]} color={t.felt} />
          <Box size={[RECEPTION.counter.w, 1.05, RECEPTION.counter.d]} position={[RECEPTION.counter.x, 0.52, RECEPTION.counter.z]} color={t.paper} />
          <Plant x={14.3} z={9} s={1.1} t={t} />
          <Plant x={-14.3} z={-8.9} s={1.1} t={t} />
        </group>
      )}
      {/* Vùng bấm chọn tầng */}
      <mesh
        position={[0, LEVEL_H / 2, 0]}
        onClick={(e) => {
          e.stopPropagation();
          if (level > 0) onPick(level);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          if (level > 0) setHover(level);
        }}
        onPointerOut={() => setHover(null)}
      >
        <boxGeometry args={[FW, LEVEL_H, FD]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function TowerScene({
  floors,
  departments,
  theme,
  labels,
  hover,
  setHover,
  onPick,
  focus = null,
  ride = null,
  companyName,
}: {
  /** Tên công ty trên bảng hiệu nóc toà nhà. */
  companyName?: string;
  floors: FloorView[];
  departments: DeptWithTasks[];
  theme: Theme;
  labels: MutableRefObject<Map<string, TowerLabel>>;
  hover: number | null;
  setHover: (n: number | null) => void;
  onPick: (n: number) => void;
  /** Tầng đang được vào: sáng viền, các tầng trên nâng lên. */
  focus?: number | null;
  /** Bạn đang đi thang máy giữa các tầng. */
  ride?: TowerRide | null;
}) {
  const cab = useRef<THREE.Group>(null);
  const ceo = useRef<THREE.Group>(null);
  const me = useRef<THREE.Group>(null);
  const lifts = useRef(new Map<number, THREE.Group>());
  const rideClock = useRef({ key: '', t0: 0 });
  const sign = useMemo(
    // i18n-ignore – tên thương hiệu trên bảng hiệu giữ nguyên
    () => signTexture((companyName || 'Văn Phòng AI').toUpperCase(), t('Toà nhà AI Agent · 5 tầng làm việc'), theme.dark),
    [theme.dark, companyName],
  );
  const shaftX = X0 - 1.45;
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ camera, size }, delta) => {
    const now = Date.now();
    const dt = Math.min(0.1, delta);
    const plan = ceoPlan(
      now,
      floors.map((f) => ({
        number: f.number,
        busy: Boolean(f.project),
        assignedAt: f.assignedAt,
      })),
    );
    // Các tầng phía trên tầng đang vào nâng lên (mái cũng vậy)
    for (const [lv, g] of lifts.current) {
      const want = focus !== null && lv > focus ? LIFT : 0;
      g.position.y += (want - g.position.y) * Math.min(1, dt * 3.2);
    }
    // Cabin: chở bạn khi bạn đi thang máy, còn lại chạy theo lịch của CEO tổng
    let riding = false;
    let level = plan.traveling ? plan.from + (plan.to - plan.from) * easeInOut(plan.progress) : plan.floor;
    if (ride) {
      const key = `${ride.from}-${ride.to}`;
      const wall = performance.now();
      if (rideClock.current.key !== key) rideClock.current = { key, t0: wall };
      const p = Math.min(1, (wall - rideClock.current.t0) / ride.ms);
      level = ride.from + (ride.to - ride.from) * easeInOut(p);
      riding = true;
    }
    if (cab.current) {
      const y = level * LEVEL_H;
      // Đi theo bạn thì bám chính xác; theo CEO tổng thì trượt mượt (tránh nhảy cóc khi đổi lịch)
      cab.current.position.y = riding ? y : cab.current.position.y + (y - cab.current.position.y) * Math.min(1, dt * 2.5);
    }
    if (me.current) {
      if (riding && cab.current) me.current.position.set(shaftX, cab.current.position.y, ELEVATOR.door.z);
      else me.current.position.set(shaftX + 2.2, 0, ELEVATOR.door.z + 1.2);
    }
    if (ceo.current) {
      if (riding) {
        ceo.current.position.set(8, 0, -5.9);
      } else if (plan.traveling) {
        ceo.current.position.set(shaftX, level * LEVEL_H, ELEVATOR.door.z);
      } else if (plan.floor === 0) {
        ceo.current.position.set(8, 0, -5.9);
      } else {
        ceo.current.position.set(MEETING.presenter.x, plan.floor * LEVEL_H, MEETING.presenter.z - 1.2);
      }
    }
    // Nhãn từng tầng
    for (let lv = 0; lv < LEVELS; lv++) {
      const label = labels.current.get(`level-${lv}`);
      if (!label) continue;
      tmp.set(FW / 2 + 0.5, lv * LEVEL_H + LEVEL_H * 0.55, FD / 2).project(camera);
      const x = (tmp.x * 0.5 + 0.5) * size.width;
      const y = (-tmp.y * 0.5 + 0.5) * size.height;
      label.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(0, -50%)`;
    }
  });

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.36, 0]} receiveShadow>
        <planeGeometry args={[FW + 40, FD + 40]} />
        <meshStandardMaterial color={theme.grass} roughness={1} />
      </mesh>
      <GroundGlow t={theme} />
      {Array.from({ length: LEVELS }).map((_, lv) => (
        <group
          key={lv}
          ref={(g) => {
            if (g) lifts.current.set(lv, g);
            else lifts.current.delete(lv);
          }}
        >
          <Level
            level={lv}
            floor={lv === 0 ? null : (floors.find((f) => f.number === lv) ?? null)}
            departments={departments}
            t={theme}
            onPick={onPick}
            highlight={focus === lv ? 2 : hover === lv ? 1 : 0}
            setHover={setHover}
          />
        </group>
      ))}
      {/* Mái + bảng hiệu */}
      <group
        ref={(g) => {
          if (g) lifts.current.set(LEVELS, g);
          else lifts.current.delete(LEVELS);
        }}
      >
        <group position={[0, LEVELS * LEVEL_H, 0]}>
          <Box size={[FW + 0.6, 0.4, FD + 0.6]} position={[0, -0.2, 0]} color={theme.slab} receive />
          <Box size={[10, 4, 0.3]} position={[0, 2.0, FD / 2 - 0.2]} color={theme.ink} />
          <mesh position={[0, 2.0, FD / 2 - 0.04]}>
            <planeGeometry args={[9.6, 3.6]} />
            <meshStandardMaterial map={sign} emissive="#ffffff" emissiveMap={sign} emissiveIntensity={theme.dark ? 0.85 : 0} />
          </mesh>
          {[
            [-12, -6],
            [12, -6],
            [-12, 6],
            [12, 4],
          ].map(([x, z], i) => (
            <Plant key={i} x={x} z={z} s={1.3} t={theme} />
          ))}
        </group>
      </group>
      {/* Trục thang máy kính + cabin */}
      <mesh position={[shaftX, (LEVELS * LEVEL_H) / 2, ELEVATOR.door.z]}>
        <boxGeometry args={[2.4, LEVELS * LEVEL_H, 2.6]} />
        <meshStandardMaterial color={theme.glass} transparent opacity={0.25} depthWrite={false} />
      </mesh>
      {[-1.2, 1.2].map((dx) =>
        [-1.3, 1.3].map((dz) => (
          <Box key={`${dx}${dz}`} size={[0.1, LEVELS * LEVEL_H, 0.1]} position={[shaftX + dx, (LEVELS * LEVEL_H) / 2, ELEVATOR.door.z + dz]} color={theme.frame} />
        )),
      )}
      <group ref={cab}>
        <Box size={[2.0, 2.6, 2.2]} position={[shaftX, 1.3, ELEVATOR.door.z]} color={theme.dark ? '#5a554f' : '#d6d2cc'} metalness={0.5} roughness={0.3} />
        <mesh position={[shaftX + 1.01, 2.4, ELEVATOR.door.z]}>
          <boxGeometry args={[0.02, 0.2, 1.6]} />
          <meshStandardMaterial color="#E0B44A" emissive="#E0B44A" emissiveIntensity={1.5} />
        </mesh>
      </group>
      {/* CEO tổng */}
      <group ref={ceo}>
        <Pawn x={0} z={0} color="#25211C" glow />
      </group>
      {/* Bạn (CEO) */}
      <group ref={me}>
        <Pawn x={0} z={0} color="#2F4A5C" glow />
      </group>
    </group>
  );
}

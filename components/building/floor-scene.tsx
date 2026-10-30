'use client';
// Cảnh chi tiết một tầng: kiến trúc, nội thất, nhân viên tự đi lại theo trạng thái công việc thật.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { FloorView, TaskStatus, Workflow } from '@/lib/types';
import { findPhase } from '@/lib/catalog';
import { getLocale, localize, t, tc } from '@/lib/i18n';
import {
  BEANBAGS,
  BILLIARDS,
  ELEVATOR,
  FD,
  FLOOR_SIGNS,
  FOOSBALL,
  FW,
  GLASS_WALLS,
  LOW_PARTITIONS,
  MEETING,
  ME_SPOTS,
  PANTRY,
  PLANTS,
  RECEPTION,
  SOFA,
  WALL_H,
  X0,
  Z0,
  assignSlots,
  workstation,
  type Spot,
} from './layout';
import { walkablePoint } from './nav';
import {
  BeanBag,
  BilliardTable,
  Box,
  CoffeeCounter,
  Desk,
  ElevatorDoor,
  FloorPlaque,
  Foosball,
  GlassWall,
  MeetingTable,
  MossWall,
  OfficeChair,
  Plant,
  PresentationScreen,
  ReceptionDesk,
  Sofa,
  type Theme,
} from './props';
import { Person, animateRig, lookFor, type Rig } from './person';
import { FloorSim, ceoPlan, type Activity, type AgentDef, type Intent } from './sim';
import { ACTIVITY_DOT, ACTIVITY_TEXT, shortTitle, type DeptWithTasks } from './shared';

/** Màu chấm trạng thái trên nhãn khi phòng không hoạt động bình thường. */
const DEPT_STATE_DOT: Record<string, string> = { paused: '#9A9083', pending_approval: '#C9952F', error: '#C4483F', terminated: '#5a554f' };
import { floorOwnership } from './ownership';
import { floorTexture } from './textures';
import { OfficeLights } from './office-lights';

export interface LabelHandle {
  el: HTMLDivElement;
  dot: HTMLElement | null;
  status: HTMLElement | null;
  /** Dòng thời gian thực: AI đang viết gì / vừa làm gì. */
  live?: HTMLElement | null;
  lastActivity?: string;
  lastStatus?: string;
  lastLive?: string;
}

/** Việc AI đang làm theo từng phòng (nhận trực tiếp từ server). */
export type LiveFeed = Map<string, { projectId: string; text: string | null; textAt: number; tool: string | null; toolAt: number }>;

/** Một dòng ngắn cho người đọc từ chữ AI đang viết hoặc thao tác vừa làm. */
function liveLine(feed: { text: string | null; textAt: number; tool: string | null; toolAt: number }, now: number): string {
  const clean = (s: string) => s.replace(/[#>*_`]/g, '').replace(/\s+/g, ' ').trim();
  const fresh = (at: number) => now - at < 45_000;
  const text = feed.text && fresh(feed.textAt) ? clean(feed.text.split('\n').filter((l) => l.trim()).pop() ?? '') : '';
  const tool = feed.tool && fresh(feed.toolAt) ? clean(feed.tool) : '';
  // Cái nào mới hơn thì hiện
  if (text && (!tool || feed.textAt >= feed.toolAt)) return `💬 ${text}`;
  if (tool) return `🔧 ${tool}`;
  return '';
}

export type LabelRefs = MutableRefObject<Map<string, LabelHandle>>;

export interface FloorAgentInfo {
  id: string;
  name: string;
  color: string;
  deptId?: string;
  role: AgentDef['role'];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Những chỗ bạn (CEO) có thể bấm để tới dùng: ghế họp, sofa, ghế lười, bi-da, bi-lắc, cà phê, màn hình họp. */
const ME_PLACES: { spot: Spot; plan: Activity }[] = [
  ...MEETING.seats.map((spot) => ({ spot, plan: 'meeting' as Activity })),
  ...SOFA.seats.map((spot) => ({ spot, plan: 'sofa' as Activity })),
  ...BEANBAGS.map((spot) => ({ spot, plan: 'beanbag' as Activity })),
  ...BILLIARDS.spots.map((spot) => ({ spot, plan: 'billiards' as Activity })),
  ...FOOSBALL.spots.map((spot) => ({ spot, plan: 'foosball' as Activity })),
  ...PANTRY.spots.map((spot) => ({ spot, plan: 'coffee' as Activity })),
  { spot: ME_SPOTS.present, plan: 'present' },
];
/** Bấm cách một chỗ trong khoảng này thì tới dùng chỗ đó. */
const PLACE_RADIUS = 1.1;
/** Cách nói trạng thái việc ngắn gọn cho dòng "đang làm gì" dưới tên nhân viên. */
const DOING: Partial<Record<TaskStatus, string>> = localize({
  running: 'Đang làm',
  queued: 'Sắp làm',
  waiting_children: 'Chờ các phòng báo cáo',
  waiting_approval: 'Chờ bạn duyệt',
  waiting_human: 'Chờ bạn trả lời',
  waiting_limit: 'Chờ hạn mức AI',
  waiting_deps: 'Chờ bàn giao',
});

/** Chữ vẽ trong cảnh (dịch lúc đọc; trong Environment/Workstations, `t` là bảng màu Theme). */
const SCENE_TEXT = localize({ screen: 'Kế hoạch dự án' });

/** Thời gian bạn đứng giao việc ở phòng họp (khớp với trang Toà nhà). */
const PRESENT_MS = 25_000;

/** Đổi con trỏ chuột trên khung 3D (tách hàm để không gán thẳng lên giá trị lấy từ hook). */
function setCursor(el: HTMLElement, cursor: string) {
  el.style.cursor = cursor;
}
/** Nảy nhẹ khi xuất hiện. */
const easeOutBack = (x: number) => {
  const c1 = 1.70158;
  return x <= 0 ? 0 : 1 + (c1 + 1) * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

/** Danh sách nhân vật của một tầng (dùng cho cả lớp nhãn phía ngoài canvas). */
/** Phòng ngồi chung khu với phòng gần chuyên môn nhất (bàn thứ hai trong khu). */
const SHARE_DESK_WITH: Record<string, string> = { tester: 'qa', bugfix: 'dev' };

export function floorAgents(floor: FloorView, departments: DeptWithTasks[]): (AgentDef & FloorAgentInfo)[] {
  const enabled = departments.filter((d) => d.enabled && d.status !== 'terminated');
  const slots = assignSlots(enabled.map((d) => d._id));
  // Hết khu riêng (hơn 8 phòng): ngồi bàn thứ hai của khu khác; hết cả bàn thì làm việc ở sofa/ghế lười.
  const shared = new Map<string, number>();
  const used = new Set<number>();
  const extras = enabled.filter((d) => !slots.has(d._id)).sort((a, b) => Number(!SHARE_DESK_WITH[a._id]) - Number(!SHARE_DESK_WITH[b._id]));
  for (const d of extras) {
    const host = SHARE_DESK_WITH[d._id] ? slots.get(SHARE_DESK_WITH[d._id]) : undefined;
    const pick = [host, ...[...slots.values()].sort((x, y) => x - y)].find((s) => s !== undefined && s !== 0 && !used.has(s));
    if (pick !== undefined) {
      shared.set(d._id, pick);
      used.add(pick);
    }
  }
  const out: (AgentDef & FloorAgentInfo)[] = [];
  enabled.forEach((d, i) => {
    const slot = slots.get(d._id) ?? shared.get(d._id);
    const sub = !slots.has(d._id) && shared.has(d._id);
    const director = d._id === 'director';
    out.push({
      id: d._id,
      role: director ? 'director' : 'staff',
      deptId: d._id,
      slot,
      sub,
      // Tiếng Việt viết thường tên tầng giữa câu ("Giám đốc tầng 1"); ngôn ngữ khác giữ nguyên bản dịch.
      name: director ? t('Giám đốc {floor}', { floor: getLocale() === 'vi' ? floor.name.toLowerCase() : t(floor.name) }) : shortTitle(d),
      color: d.color,
      seed: floor.number * 31 + i * 7 + 3,
      deptStatus: d.status,
      pauseReason: d.pauseReason ?? null,
    });
  });
  out.push({ id: '__reception', role: 'reception', name: t('Lễ tân'), color: '#8A7DAE', seed: floor.number * 13 + 1 });
  out.push({ id: '__ceo', role: 'ceo', name: t('CEO tổng'), color: '#25211C', seed: 99 });
  out.push({ id: '__me', role: 'me', name: t('Bạn · CEO'), color: '#2F4A5C', seed: 7 });
  return out;
}

function EnvironmentImpl({
  t,
  floorLabel,
  elevatorOpen,
  callLit,
  companyName,
}: {
  t: Theme;
  floorLabel: string;
  companyName?: string;
  elevatorOpen: MutableRefObject<number>;
  callLit: MutableRefObject<boolean>;
}) {
  const tex = useMemo(() => floorTexture(t.dark, FW, FD), [t.dark]);
  const doorGroup = useRef<THREE.Group>(null);
  const callMat = useRef<THREE.MeshStandardMaterial>(null);
  // Mở/đóng cửa thang máy mượt
  const openRef = useRef(0);
  useFrame((_, dt) => {
    openRef.current += (elevatorOpen.current - openRef.current) * Math.min(1, dt * 4);
    const g = doorGroup.current;
    if (!g) return;
    const half = ELEVATOR.door.w / 2;
    const [l, r] = [g.getObjectByName('doorL'), g.getObjectByName('doorR')];
    if (l) l.position.x = -half / 2 - openRef.current * half * 0.95;
    if (r) r.position.x = half / 2 + openRef.current * half * 0.95;
    if (callMat.current) callMat.current.emissiveIntensity = callLit.current ? 2.2 : 0.15;
  });
  return (
    <group>
      {/* Mặt đất bên ngoài + sàn tầng */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.36, 0]} receiveShadow>
        <planeGeometry args={[FW + 30, FD + 30]} />
        <meshStandardMaterial color={t.grass} roughness={1} />
      </mesh>
      <Box size={[FW + 0.4, 0.34, FD + 0.4]} position={[0, -0.17, 0]} color={t.slab} receive />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} receiveShadow>
        <planeGeometry args={[FW, FD]} />
        <meshStandardMaterial map={tex} roughness={0.55} />
      </mesh>

      {/* Tường sau: kính lớn có khung, nhìn ra cây xanh */}
      <Box size={[FW + 0.2, 0.5, 0.2]} position={[0, 0.25, Z0 - 0.1]} color={t.wall} receive />
      <Box size={[FW + 0.2, 0.25, 0.2]} position={[0, WALL_H - 0.125, Z0 - 0.1]} color={t.wall} />
      <mesh position={[0, 0.5 + (WALL_H - 0.75) / 2, Z0 - 0.08]}>
        <boxGeometry args={[FW, WALL_H - 0.75, 0.04]} />
        <meshStandardMaterial color={t.window} transparent opacity={t.dark ? 0.35 : 0.3} roughness={0.05} depthWrite={false} />
      </mesh>
      {Array.from({ length: 11 }).map((_, i) => (
        <Box key={i} size={[0.08, WALL_H, 0.12]} position={[X0 + i * 3, WALL_H / 2, Z0 - 0.06]} color={t.frame} cast={false} />
      ))}
      {/* Tường trái (đặc) + cửa thang máy + tường cây */}
      <Box size={[0.24, WALL_H, FD + 0.2]} position={[X0 - 0.12, WALL_H / 2, 0]} color={t.wall} receive />
      <group position={[X0 + 0.02, 0, 0]}>
        <group ref={doorGroup}>
          <ElevatorDoorAnimated z={ELEVATOR.door.z} w={ELEVATOR.door.w} t={t} floorLabel={floorLabel} />
        </group>
      </group>
      {/* Bảng nút gọi thang máy */}
      <group position={[ELEVATOR.button.x, ELEVATOR.button.y, ELEVATOR.button.z]}>
        <Box size={[0.04, 0.42, 0.22]} position={[0.02, 0, 0]} color={t.dark ? '#5a554f' : '#cfc9c0'} metalness={0.5} roughness={0.3} cast={false} />
        <mesh position={[0.05, 0.06, 0]}>
          <sphereGeometry args={[0.045, 12, 10]} />
          <meshStandardMaterial ref={callMat} color="#E0B44A" emissive="#E0B44A" emissiveIntensity={0.15} />
        </mesh>
        <mesh position={[0.05, -0.08, 0]}>
          <sphereGeometry args={[0.045, 12, 10]} />
          <meshStandardMaterial color={t.dark ? '#8a847b' : '#a7a097'} />
        </mesh>
      </group>
      <MossWall x={-12.1} z={Z0 + 0.06} w={4.2} h={2.0} t={t} />

      {/* Cây ngoài trời phía sau */}
      {Array.from({ length: 9 }).map((_, i) => (
        <group key={i} position={[X0 + 2 + i * 3.4, -0.36, Z0 - 2.4 - (i % 2) * 1.3]}>
          <mesh position={[0, 1.0, 0]} castShadow>
            <cylinderGeometry args={[0.12, 0.16, 2, 6]} />
            <meshStandardMaterial color="#6b4a2f" />
          </mesh>
          <mesh position={[0, 2.6, 0]} castShadow>
            <icosahedronGeometry args={[1.15 + (i % 3) * 0.2, 0]} />
            <meshStandardMaterial color={t.leaf[i % 3]} flatShading />
          </mesh>
        </group>
      ))}

      {/* Vách kính & vách thấp */}
      {GLASS_WALLS.map((w, i) => (
        <GlassWall key={`g${i}`} {...w} t={t} />
      ))}
      {LOW_PARTITIONS.map((w, i) => (
        <GlassWall key={`p${i}`} {...w} h={1.15} t={t} />
      ))}

      {/* Phòng họp */}
      <MeetingTable {...MEETING.table} t={t} />
      {MEETING.seats.map((s) => (
        <OfficeChair key={s.id} x={s.x} z={s.z} facing={s.facing} t={t} />
      ))}
      <PresentationScreen x={MEETING.screen.x} z={MEETING.screen.z} title={SCENE_TEXT.screen} />

      {/* Khu nghỉ: bi-da, bi-lắc, ghế lười, sofa */}
      <BilliardTable {...BILLIARDS.table} t={t} />
      <Foosball {...FOOSBALL.table} t={t} />
      {BEANBAGS.map((b) => (
        <BeanBag key={b.id} x={b.x} z={b.z} color={b.color} />
      ))}
      <Sofa {...SOFA.sofa} facing={Math.PI} t={t} color={t.dark ? '#4a5560' : '#7d8a94'} />
      <Box size={[SOFA.table.w, 0.42, SOFA.table.d]} position={[SOFA.table.x, 0.21, SOFA.table.z]} color={t.wood} />
      <CoffeeCounter {...PANTRY.counter} t={t} />

      {/* Sảnh lễ tân – tên thương hiệu "Văn Phòng AI" giữ nguyên (i18n-ignore) */}
      <ReceptionDesk wall={RECEPTION.wall} counter={RECEPTION.counter} t={t} title={(companyName || 'Văn Phòng AI').toUpperCase()} />
      {RECEPTION.sofas.map((s, i) => (
        <Sofa key={i} x={s.x} z={s.z} w={s.w} d={s.d} facing={s.facing} t={t} color={i ? '#C9952F' : '#3F8A93'} />
      ))}
      <mesh position={[RECEPTION.table.x, 0.22, RECEPTION.table.z]} castShadow>
        <cylinderGeometry args={[RECEPTION.table.r, RECEPTION.table.r, 0.44, 24]} />
        <meshStandardMaterial color={t.paper} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[RECEPTION.table.x, 0.006, RECEPTION.table.z]} receiveShadow>
        <circleGeometry args={[2.1, 40]} />
        <meshStandardMaterial color={t.dark ? '#35302a' : '#ddd5c6'} />
      </mesh>

      {/* Phòng giám đốc: kệ sách */}
      <group position={[-8.3, 0, -9.0]}>
        <Box size={[1.4, 1.8, 0.38]} position={[0, 0.9, 0]} color={t.wood} />
        {Array.from({ length: 8 }).map((_, i) => (
          <Box key={i} size={[0.1, 0.3, 0.26]} position={[-0.55 + i * 0.15, 1.25 - (i % 2) * 0.5, 0.05]} color={['#C4532A', '#4A86BD', '#5C9A68', '#E0B44A'][i % 4]} cast={false} />
        ))}
      </group>

      {PLANTS.map((p, i) => (
        <Plant key={i} {...p} t={t} />
      ))}
      {FLOOR_SIGNS.map((s) => (
        <FloorPlaque key={s.text} x={s.x} z={s.z} w={s.w} text={s.text} />
      ))}
    </group>
  );
}

// Phần tĩnh của cảnh: chỉ vẽ lại khi đầu vào thật sự đổi (không vẽ lại mỗi lần dữ liệu nhiệm vụ cập nhật).
const Environment = memo(EnvironmentImpl);

/** Cửa thang máy: hai cánh (doorL/doorR) được Environment mở/đóng theo CEO. */
function ElevatorDoorAnimated({ z, w, t, floorLabel }: { z: number; w: number; t: Theme; floorLabel: string }) {
  return <ElevatorDoor z={z} w={w} open={0} t={t} floorLabel={floorLabel} />;
}

function WorkstationsImpl({ agents, names, t, workingRef }: { agents: AgentDef[]; names: Map<string, string>; t: Theme; workingRef: Set<string> }) {
  const short = (id?: string) => (id ? (names.get(id) ?? '') : '');
  return (
    <group>
      {agents
        .filter((a) => a.slot !== undefined && !a.sub)
        .map((a) => {
          const ws = workstation(a.slot!);
          // Phòng ngồi bàn thứ hai của khu này (nếu có)
          const mate = agents.find((x) => x.sub && x.slot === a.slot);
          const slotLabel = `P.${String(a.slot! + 1).padStart(2, '0')}`;
          return (
            <group key={a.id}>
              {ws.desks.map((d, i) => (
                <Desk
                  key={i}
                  {...d}
                  t={t}
                  working={i === 0 ? workingRef.has(a.id) : Boolean(mate && workingRef.has(mate.id))}
                  color={i === 1 && mate ? mate.color : a.color}
                  laptop={i === 1}
                />
              ))}
              <OfficeChair x={ws.seat.x} z={ws.seat.z} facing={ws.seat.facing} t={t} color={a.slot === 0 ? '#5a3b2a' : undefined} />
              {ws.desks[1] && <OfficeChair x={ws.desks[1].x} z={ws.seat.z} facing={0} t={t} />}
              <FloorPlaque
                x={ws.plaque.x}
                z={ws.plaque.z}
                w={3.4}
                text={slotLabel}
                sub={mate ? `${short(a.deptId)} · ${short(mate.deptId)}` : short(a.deptId)}
                color="#E0B44A"
              />
            </group>
          );
        })}
    </group>
  );
}

const Workstations = memo(WorkstationsImpl);

export function FloorScene({
  floor,
  floors,
  departments,
  workflows,
  theme,
  labels,
  liveFeed,
  onSelect,
  leaving = false,
  onDeparted,
  presentUntil = 0,
  intro = true,
  companyName,
}: {
  /** Tên công ty trên bảng hiệu lễ tân. */
  companyName?: string;
  floor: FloorView;
  floors: FloorView[];
  departments: DeptWithTasks[];
  workflows: Workflow[];
  theme: Theme;
  labels: LabelRefs;
  /** Việc AI đang làm theo thời gian thực (theo phòng). */
  liveFeed?: MutableRefObject<LiveFeed>;
  onSelect: (agentId: string) => void;
  /** CEO (bạn) ra bấm thang máy để rời tầng. */
  leaving?: boolean;
  /** Gọi một lần khi bạn đã vào thang máy và cửa đã đóng. */
  onDeparted?: () => void;
  /** Bạn đang giao việc: đứng ở phòng họp tới thời điểm này. */
  presentUntil?: number;
  /** Hiệu ứng khi vào tầng (bạn bước ra thang máy, bàn ghế nâng lên, nhân viên lần lượt xuất hiện). */
  intro?: boolean;
}) {
  // Chỉ dựng lại danh sách nhân vật khi tầng / phòng ban thay đổi – không theo mỗi lần nhiệm vụ cập nhật
  const floorKey = `${floor._id}|${floor.number}|${floor.name}`;
  const deptShape = departments.map((d) => `${d._id}|${d.enabled}|${d.name}|${d.title}|${d.color}|${d.icon}|${d.status ?? ''}|${d.pauseReason ?? ''}`).join(';');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const agents = useMemo(() => floorAgents(floor, departments), [floorKey, deptShape]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const deptNames = useMemo(() => new Map(departments.map((d) => [d._id, t(d.name).replace(/^Phòng /, '')])), [deptShape]);
  // Bộ mô phỏng chỉ tạo lại khi đổi tầng hoặc đổi danh sách nhân viên (không reset mỗi lần dữ liệu cập nhật).
  const simKey = `${floor._id}:${agents.map((a) => a.id).join('|')}`;
  const [sim, setSim] = useState(() => ({ key: simKey, sim: new FloorSim(agents, floor.number * 101, intro) }));
  if (sim.key !== simKey) setSim({ key: simKey, sim: new FloorSim(agents, floor.number * 101) });
  const rigs = useRef(new Map<string, Rig>());
  const roots = useRef(new Map<string, THREE.Group>());
  const elevatorOpen = useRef(0);
  const ceoDoor = useRef(0);
  const callLit = useRef(false);
  const build = useRef<THREE.Group>(null);
  const introState = useRef({ t0: -1, done: !intro });
  const departed = useRef(false);
  // Bạn (CEO) đi theo chuột: chỗ bấm gần nhất + vòng đánh dấu
  const meGoto = useRef<{ spot: Spot; plan: Activity; claim: boolean; at: number } | null>(null);
  const targetRing = useRef<THREE.Mesh>(null);
  const hoverRing = useRef<THREE.Mesh>(null);
  const gl = useThree((s) => s.gl);
  const projectId = floor.project?._id ?? null;
  // Việc hiện ở tầng này: việc của dự án trên tầng + (nếu tầng này nhận) việc không thuộc tầng nào
  // (chat trực tiếp với phòng, heartbeat / lịch định kỳ, dự án đã xong được nhắn tiếp).
  const { owns, hostsFloating } = useMemo(() => floorOwnership(floor, floors, departments), [floor, floors, departments]);

  // Phòng nào đang có nhiệm vụ chạy (để bật màn hình) – giữ nguyên tập hợp khi danh sách không đổi
  const workingKey = departments
    .filter((d) => d.activeTasks.some((t) => owns(t.projectId) && t.status === 'running'))
    .map((d) => d._id)
    .sort()
    .join(',');
  const working = useMemo(() => new Set(workingKey ? workingKey.split(',') : []), [workingKey]);

  // Việc từng nhân viên đang làm trên tầng này (hiện ngay dưới tên)
  const doing = useMemo(() => {
    const m = new Map<string, string>();
    if (!projectId && !hostsFloating) return m;
    // Giám đốc đang xem xét/chia việc (chế độ giao cho giám đốc) → các phòng chưa có việc đang chờ phân việc
    const planning =
      Boolean(projectId) &&
      departments.some((d) => d.activeTasks.some((t) => t.projectId === projectId && t.kind === 'phase' && t.round === 0 && (t.status === 'running' || t.status === 'queued')));
    for (const a of agents) {
      if (!a.deptId) continue;
      const tasks = departments.find((d) => d._id === a.deptId)?.activeTasks.filter((t) => owns(t.projectId)) ?? [];
      const task = tasks.find((x) => x.status === 'running') ?? tasks[0];
      if (task) m.set(a.id, `${DOING[task.status] ?? t('Đang làm')}: ${task.title}`);
      else if (planning && floor.project?.workflowId === 'director' && a.role === 'staff') m.set(a.id, t('Chờ giám đốc phân việc'));
    }
    return m;
  }, [agents, departments, projectId, hostsFloating, owns, floor.project?.workflowId]);

  const slotOf = useMemo(() => new Map(agents.filter((a) => a.deptId && a.slot !== undefined).map((a) => [a.deptId!, a.slot!])), [agents]);

  /** Tính ý định cho mọi nhân vật từ dữ liệu thật. */
  const computeIntents = useCallback(
    (now: number) => {
      const tasksOf = (deptId: string) => departments.find((d) => d._id === deptId)?.activeTasks.filter((t) => owns(t.projectId)) ?? [];
      // Họp khởi động giai đoạn: nhiệm vụ chủ trì vừa được tạo trong 45 giây.
      const phaseTask = projectId
        ? departments.flatMap((d) => d.activeTasks).find((t) => t.projectId === projectId && t.kind === 'phase' && now - new Date(t.createdAt).getTime() < 45_000)
        : undefined;
      // Chế độ giao cho giám đốc: chỉ họp khi giám đốc đã chia việc (không gọi cả tầng ngay từ đầu).
      const directorMode = floor.project?.workflowId === 'director';
      const phase = directorMode ? undefined : findPhase(workflows, floor.project?.currentPhase);
      const fresh = (createdAt: string) => now - new Date(createdAt).getTime() < 60_000;
      // Giám đốc vừa nhận yêu cầu và đang xem xét/chia việc → gọi các phòng vào phòng họp
      const dispatchTask = directorMode
        ? departments
            .flatMap((d) => d.activeTasks)
            .find((t) => t.projectId === projectId && t.kind === 'phase' && t.round === 0 && (t.status === 'running' || t.status === 'queued'))
        : undefined;
      // Họp chỉ khoảng 1 phút đầu; sau đó các phòng về bàn chờ giám đốc phân việc.
      const dispatchMeeting = Boolean(dispatchTask && fresh(dispatchTask.createdAt));
      const kickoff = new Set<string>(phaseTask && phase ? [...phase.departments, phase.lead] : []);
      let anyMeeting = kickoff.size > 0;
      const intents = new Map<string, Intent>();
      for (const a of agents) {
        if (a.role === 'reception') {
          intents.set(a.id, { kind: 'reception' });
          continue;
        }
        if (a.role === 'ceo') {
          const plan = ceoPlan(
            now,
            floors.map((f) => ({ number: f.number, busy: Boolean(f.project), assignedAt: f.assignedAt })),
          );
          const here = plan.floor === floor.number && !plan.traveling && now < plan.leaveAt;
          intents.set(a.id, here ? { kind: 'visit', leaveAt: plan.leaveAt } : { kind: 'away' });
          const arriving = here && now - plan.arrivedAt < 3500;
          const goingAway = here && plan.leaveAt - now < 4500;
          ceoDoor.current = arriving || goingAway ? 1 : 0;
          continue;
        }
        if (a.role === 'me') {
          const age = introState.current.t0 < 0 ? 0 : performance.now() / 1000 - introState.current.t0;
          const goto = meGoto.current;
          // Việc mới nhất thắng: vừa giao việc thì lên phòng họp, vừa bấm chuột thì đi tới chỗ bấm.
          const presenting = presentUntil > now && !(goto && goto.at > presentUntil - PRESENT_MS);
          let intent: Intent;
          if (leaving) intent = { kind: 'me', mode: 'leave' };
          else if (intro && age < 0.7) intent = { kind: 'me', mode: 'hold' };
          else if (presenting) intent = { kind: 'me', mode: 'present' };
          else if (goto) intent = { kind: 'me', mode: 'goto', spot: goto.spot, plan: goto.plan, claim: goto.claim };
          else intent = { kind: 'me', mode: 'home' };
          intents.set(a.id, intent);
          continue;
        }
        if (a.role === 'director') continue;
        const tasks = tasksOf(a.deptId!);
        const has = (...s: string[]) => tasks.some((t) => s.includes(t.status));
        let intent: Intent;
        if (kickoff.has(a.deptId!) && !has('running')) intent = { kind: 'meeting' };
        else if (dispatchTask && !tasks.length) intent = dispatchMeeting ? { kind: 'meeting' } : { kind: 'standby' };
        else if (has('running')) intent = { kind: 'work' };
        // Vừa được giao việc → vào phòng họp nghe giao việc ~1 phút, rồi về bàn (làm ngay hoặc chờ bàn giao)
        else if (tasks.some((t) => (t.status === 'queued' || t.status === 'waiting_deps') && fresh(t.createdAt))) intent = { kind: 'meeting' };
        else if (has('queued', 'waiting_limit')) intent = { kind: 'standby' };
        else if (has('waiting_approval', 'waiting_human')) intent = { kind: 'alert' };
        else if (has('waiting_children')) {
          const kids = departments
            .filter((d) => d.activeTasks.some((t) => owns(t.projectId) && t.assignedBy === a.deptId))
            .map((d) => slotOf.get(d._id))
            .filter((s): s is number => s !== undefined);
          intent = { kind: 'patrol', targets: kids };
        } else if (has('waiting_deps')) intent = { kind: 'standby' };
        else intent = { kind: 'idle', calm: !projectId && !hostsFloating };
        if (intent.kind === 'meeting') anyMeeting = true;
        intents.set(a.id, intent);
      }
      // Giám đốc tầng: chủ trì họp khi có người được giao việc; còn lại làm việc / đi kiểm tra / nghỉ.
      const director = agents.find((a) => a.role === 'director');
      if (director) {
        const tasks = tasksOf(director.deptId!);
        const has = (...s: string[]) => tasks.some((t) => s.includes(t.status));
        let intent: Intent;
        if (anyMeeting) intent = { kind: 'present' };
        else if (has('running')) intent = { kind: 'work' };
        else if (has('waiting_approval', 'waiting_human')) intent = { kind: 'alert' };
        else if (projectId) {
          const busy = agents.filter((a) => a.slot !== undefined && a.role === 'staff' && intents.get(a.id)?.kind === 'work').map((a) => a.slot!);
          intent = busy.length ? { kind: 'patrol', targets: busy } : { kind: 'idle', calm: false };
        } else intent = { kind: 'idle', calm: true };
        intents.set(director.id, intent);
      }
      for (const [id, intent] of intents) sim.sim.setIntent(id, intent);
    },
    [agents, departments, floor, floors, projectId, owns, hostsFloating, slotOf, workflows, sim, leaving, presentUntil, intro],
  );

  const lastIntent = useRef(0);
  useEffect(() => {
    lastIntent.current = 0;
  }, [computeIntents]);

  // Bàn của từng nhân viên: bấm vào thì bạn tới đứng nói chuyện.
  const places = useMemo(
    () => [
      ...ME_PLACES,
      ...agents
        .filter((a) => a.slot !== undefined && a.role !== 'me')
        .map((a) => {
          const v = workstation(a.slot!).visit;
          return { spot: { ...v, id: `${v.id}-me` }, plan: 'chat' as Activity };
        }),
    ],
    [agents],
  );

  /** Bấm xuống sàn: bạn (CEO) đi tới đó; bấm gần ghế/bàn bi-da/quầy cà phê… thì tới dùng chỗ đó. */
  const onFloorClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6 || leaving) return; // kéo chuột để xoay camera thì bỏ qua
    const me = sim.sim.agents.get('__me');
    if (!me?.visible) return;
    e.stopPropagation();
    const p = { x: e.point.x, z: e.point.z };
    let best: (typeof places)[number] | null = null;
    let bestD = PLACE_RADIUS;
    for (const pl of places) {
      const d = Math.hypot(pl.spot.x - p.x, pl.spot.z - p.z);
      if (d < bestD && sim.sim.isFree(pl.spot.id, '__me')) {
        best = pl;
        bestD = d;
      }
    }
    if (best) meGoto.current = { spot: best.spot, plan: best.plan, claim: true, at: Date.now() };
    else {
      const w = walkablePoint(p);
      const spot: Spot = { id: 'me-goto', x: w.x, z: w.z, facing: Math.atan2(w.x - me.x, w.z - me.z), pose: 'stand' };
      meGoto.current = { spot, plan: 'boss', claim: false, at: Date.now() };
    }
    lastIntent.current = 0; // tính lại ý định ngay khung hình sau
  };
  const onFloorMove = (e: ThreeEvent<PointerEvent>) => {
    const ring = hoverRing.current;
    if (!ring) return;
    ring.visible = !leaving;
    ring.position.set(e.point.x, 0.03, e.point.z);
    setCursor(gl.domElement, leaving ? '' : 'pointer');
  };
  const onFloorOut = () => {
    if (hoverRing.current) hoverRing.current.visible = false;
    setCursor(gl.domElement, '');
  };

  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock, camera, size }, delta) => {
    const now = Date.now();
    // Cho phép bước lớn để nhân vật vẫn đi đúng tốc độ khi máy chậm/tab bị hạn chế khung hình.
    const dt = Math.min(0.25, delta);
    if (now - lastIntent.current > 500) {
      lastIntent.current = now;
      computeIntents(now);
    }
    sim.sim.update(dt, now);
    const time = clock.elapsedTime;
    // Cửa thang máy: mở khi CEO tổng hoặc bạn cần.
    elevatorOpen.current = Math.max(ceoDoor.current, sim.sim.meDoor);
    callLit.current = sim.sim.callLit;
    // Vòng đích: hiện khi bạn đang đi tới chỗ vừa bấm
    const me = sim.sim.agents.get('__me');
    const goal = meGoto.current;
    if (targetRing.current) {
      const show = Boolean(goal && me?.visible && !leaving && me.dest?.id.startsWith(goal.spot.id) && !me.arrived);
      targetRing.current.visible = show;
      if (show && goal) {
        targetRing.current.position.set(goal.spot.x, 0.035, goal.spot.z);
        targetRing.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 6) * 0.12);
      }
    }
    if (leaving && !departed.current && sim.sim.meInLiftAt && now - sim.sim.meInLiftAt > 750) {
      departed.current = true;
      onDeparted?.();
    }
    // Hiệu ứng vào tầng: bàn ghế nâng lên, nhân viên lần lượt xuất hiện.
    const it = introState.current;
    const wall = performance.now() / 1000;
    if (it.t0 < 0) it.t0 = wall;
    const age = wall - it.t0;
    if (!it.done) {
      if (build.current) build.current.scale.y = Math.max(0.001, easeOutBack(clamp01((age - 0.35) / 0.7)));
      if (age > 0.6 + agents.length * 0.07 + 0.5) {
        it.done = true;
        if (build.current) build.current.scale.y = 1;
        for (const g of roots.current.values()) g.scale.setScalar(1);
      }
    }
    let order = 0;
    for (const a of sim.sim.agents.values()) {
      const root = roots.current.get(a.def.id);
      const rig = rigs.current.get(a.def.id);
      if (root) {
        root.visible = a.visible;
        root.position.set(a.x, 0, a.z);
        root.rotation.y = a.heading;
        if (!it.done && a.def.role !== 'me') root.scale.setScalar(Math.max(0.001, easeOutBack(clamp01((age - 0.6 - order * 0.07) / 0.4))));
        order++;
      }
      if (rig && a.visible) {
        const walking = a.path.length > 0;
        animateRig(rig, walking ? 'walk' : a.pose, time, dt, a.def.seed, a.dest?.seatY);
      }
      // Nhãn tên: chiếu toạ độ đầu nhân vật ra màn hình
      const label = labels.current.get(a.def.id);
      if (label) {
        if (!a.visible) {
          label.el.style.display = 'none';
          continue;
        }
        label.el.style.display = '';
        const seated = a.pose === 'type' || a.pose === 'sit' || a.pose === 'lounge';
        if (!it.done && a.def.role !== 'me' && age < 0.6 + order * 0.07) {
          label.el.style.display = 'none';
          continue;
        }
        tmp.set(a.x, seated ? 1.75 : 2.15, a.z).project(camera);
        const x = (tmp.x * 0.5 + 0.5) * size.width;
        const y = (-tmp.y * 0.5 + 0.5) * size.height;
        label.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
        label.el.style.zIndex = String(Math.round((1 - tmp.z) * 100000));
        const act = a.path.length ? 'walk' : a.activity;
        const deptState = a.def.deptStatus && a.def.deptStatus !== 'active' ? a.def.deptStatus : null;
        const dotKey = deptState ? `dept:${deptState}` : act;
        if (label.lastActivity !== dotKey) {
          label.lastActivity = dotKey;
          if (label.dot) label.dot.style.background = deptState ? DEPT_STATE_DOT[deptState] : ACTIVITY_DOT[act];
          label.el.dataset.activity = act;
        }
        // Dòng dưới tên: trạng thái phòng (tạm dừng, chờ duyệt, lỗi) → việc đang làm (nếu có) → hoạt động hiện tại
        const waitingPlan = doing.get(a.def.id) === t('Chờ giám đốc phân việc');
        const work = (waitingPlan && (act === 'meeting' || act === 'walk') ? ACTIVITY_TEXT[act] : doing.get(a.def.id)) ?? ACTIVITY_TEXT[act];
        const status =
          deptState === 'paused'
            ? `${tc('status', 'Tạm dừng')}${a.def.pauseReason ? ` – ${a.def.pauseReason}` : ''}`
            : deptState === 'pending_approval'
              ? t('Chờ duyệt tuyển')
              : deptState === 'error'
                ? `${t('Lỗi – cần xem')}${doing.has(a.def.id) ? ` · ${work}` : ''}`
                : work;
        if (label.status) label.status.dataset.state = deptState ?? '';
        if (label.status && label.lastStatus !== status) {
          label.lastStatus = status;
          label.status.textContent = status;
          label.status.title = status;
          label.status.dataset.busy = doing.has(a.def.id) ? '1' : '';
        }
        // Nhân viên đang làm việc: hiện trực tiếp AI đang viết gì / vừa làm gì
        if (label.live) {
          const feed = a.def.deptId ? liveFeed?.current.get(a.def.deptId) : undefined;
          const line = feed && owns(feed.projectId) && doing.has(a.def.id) ? liveLine(feed, now) : '';
          if (label.lastLive !== line) {
            label.lastLive = line;
            label.live.textContent = line;
            label.live.title = line;
            label.live.style.display = line ? '' : 'none';
          }
        }
      }
    }
  });

  return (
    <group>
      <Environment t={theme} floorLabel={t(floor.name).toUpperCase()} elevatorOpen={elevatorOpen} callLit={callLit} companyName={companyName} />
      <OfficeLights t={theme} />
      <group ref={build} scale={[1, intro ? 0.001 : 1, 1]}>
        <Workstations agents={agents} names={deptNames} t={theme} workingRef={working} />
      </group>
      {agents.map((a) => (
        <AgentBody key={a.id} def={a} rigs={rigs} roots={roots} onSelect={onSelect} />
      ))}
      {/* Mặt bấm trong suốt phủ sàn: bấm để bạn (CEO) đi tới */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} onClick={onFloorClick} onPointerMove={onFloorMove} onPointerOut={onFloorOut}>
        <planeGeometry args={[FW, FD]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh ref={hoverRing} rotation={[-Math.PI / 2, 0, 0]} visible={false} renderOrder={2}>
        <ringGeometry args={[0.22, 0.3, 32]} />
        <meshBasicMaterial color="#C4532A" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <mesh ref={targetRing} rotation={[-Math.PI / 2, 0, 0]} visible={false} renderOrder={2}>
        <ringGeometry args={[0.3, 0.42, 36]} />
        <meshBasicMaterial color="#C4532A" transparent opacity={0.9} depthWrite={false} />
      </mesh>
    </group>
  );
}

function AgentBodyImpl({
  def,
  rigs,
  roots,
  onSelect,
}: {
  def: AgentDef;
  rigs: MutableRefObject<Map<string, Rig>>;
  roots: MutableRefObject<Map<string, THREE.Group>>;
  onSelect: (id: string) => void;
}) {
  const group = useRef<THREE.Group | null>(null);
  const dim = def.deptStatus === 'paused' || def.deptStatus === 'pending_approval';
  const look = useMemo(
    () =>
      lookFor(
        def.seed,
        def.color,
        def.role === 'ceo'
          ? { suit: true, tie: '#C4532A', hairStyle: 0, hair: '#8A8682' }
          : def.role === 'me'
            ? { suit: true, tie: '#E0B44A', hairStyle: 1, hair: '#2b211b' }
            : def.role === 'director'
              ? { tie: '#25211C' }
              : undefined,
      ),
    [def.seed, def.color, def.role],
  );
  // Mỗi nhân vật có vật liệu riêng → làm mờ trực tiếp (không ảnh hưởng nhân vật khác)
  useEffect(() => {
    group.current?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        m.transparent = dim;
        m.opacity = dim ? 0.38 : 1;
        m.depthWrite = !dim;
        m.needsUpdate = true;
      }
    });
  }, [dim, look]);
  return (
    <group
      ref={(g) => {
        group.current = g;
        if (g) roots.current.set(def.id, g);
        else roots.current.delete(def.id);
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(def.id);
      }}
    >
      <Person look={look} id={def.id} registry={rigs} />
    </group>
  );
}

const AgentBody = memo(AgentBodyImpl);

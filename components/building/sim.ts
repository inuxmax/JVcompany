// Mô phỏng hành vi nhân vật trên một tầng: đi lại theo đường A*, làm việc, họp, nghỉ ngơi, chơi bi-da…
// Ý định (intent) lấy từ dữ liệu thật (nhiệm vụ của phòng ban); phần còn lại do bộ mô phỏng tự quyết.
import type { DepartmentStatus } from '@/lib/types';
import {
  BEANBAGS,
  BILLIARDS,
  ELEVATOR,
  FOOSBALL,
  MEETING,
  ME_SPOTS,
  PANTRY,
  RECEPTION,
  SOFA,
  workstation,
  type Pose,
  type Spot,
} from './layout';
import { findPath, walkablePoint, type P2 } from './nav';

/** `me` = bạn (CEO do người dùng điều khiển): đi thang máy giữa các tầng, giao việc. */
export type Role = 'staff' | 'director' | 'reception' | 'ceo' | 'me';

export interface AgentDef {
  id: string;
  role: Role;
  deptId?: string;
  slot?: number;
  /** Ngồi bàn thứ hai của khu (phòng ngồi chung khu với phòng khác). */
  sub?: boolean;
  name: string;
  color: string;
  seed: number;
  /** Trạng thái phòng ban: tạm dừng / chờ duyệt tuyển → nhân vật mờ đi; lỗi → dấu "!" trên nhãn. */
  deptStatus?: DepartmentStatus;
  pauseReason?: string | null;
}

export type Intent =
  | { kind: 'work' }
  | { kind: 'meeting' }
  | { kind: 'present' }
  | { kind: 'alert' }
  | { kind: 'patrol'; targets: number[] }
  | { kind: 'idle'; calm?: boolean }
  /** Ngồi tại bàn chờ phòng trước bàn giao. */
  | { kind: 'standby' }
  | { kind: 'reception' }
  | { kind: 'visit'; leaveAt: number }
  | { kind: 'away' }
  /** CEO (bạn): đứng chờ trong thang máy / về sảnh quan sát / giao việc ở phòng họp / ra bấm thang máy rời tầng. */
  | { kind: 'me'; mode: 'hold' | 'home' | 'present' | 'leave' }
  /** CEO (bạn) đi tới chỗ bạn bấm chuột; `claim` = giữ chỗ (ghế, bàn bi-da…) để nhân viên khác không dùng. */
  | { kind: 'me'; mode: 'goto'; spot: Spot; plan: Activity; claim: boolean };

export type Activity =
  | 'walk'
  | 'work'
  | 'meeting'
  | 'present'
  | 'alert'
  | 'patrol'
  | 'desk'
  | 'coffee'
  | 'beanbag'
  | 'sofa'
  | 'billiards'
  | 'foosball'
  | 'chat'
  | 'reception'
  | 'away'
  | 'boss'
  | 'press'
  | 'lift';

export interface AgentState {
  def: AgentDef;
  x: number;
  z: number;
  heading: number;
  path: P2[];
  dest: Spot | null;
  arrived: boolean;
  activity: Activity;
  /** Hoạt động sẽ làm khi tới nơi. */
  plan: Activity;
  pose: Pose;
  until: number;
  intentKey: string;
  visible: boolean;
  patrolIdx: number;
  /** Hệ số tốc độ (bạn vội ra thang máy: đi nhanh hơn nếu đang ở xa). */
  speed?: number;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SPEED = 1.35;

/** Độ dài quãng đường còn lại của một nhân vật. */
function pathLength(a: Pick<AgentState, 'x' | 'z' | 'path'>): number {
  let len = 0;
  let px = a.x;
  let pz = a.z;
  for (const p of a.path) {
    len += Math.hypot(p.x - px, p.z - pz);
    px = p.x;
    pz = p.z;
  }
  return len;
}
const CEO_SPOT: Spot = { id: 'meet-ceo', x: 13.9, z: -8.35, facing: -Math.PI / 2, pose: 'talk' };

export class FloorSim {
  agents = new Map<string, AgentState>();
  /** CEO (bạn) cần cửa thang máy mở (1) hay đóng (0). */
  meDoor = 0;
  /** Thời điểm CEO (bạn) đã vào hẳn trong thang máy (0 = chưa). */
  meInLiftAt = 0;
  /** Đèn nút gọi thang máy đang sáng. */
  callLit = false;
  private occupied = new Map<string, string>(); // spotId -> agentId
  private intents = new Map<string, Intent>();
  private rand: () => number;

  /** `meArrives`: CEO (bạn) bắt đầu trong thang máy rồi bước ra (vừa đi thang máy tới tầng này). */
  constructor(defs: AgentDef[], seed = 7, meArrives = false) {
    this.rand = rng(seed);
    defs.forEach((def, i) => {
      // Xuất phát: nhân viên ở bàn mình, lễ tân ở quầy, CEO ở thang máy, bạn ở sảnh (hoặc trong thang máy).
      const start = def.role === 'me' ? (meArrives ? ELEVATOR.inside : ME_SPOTS.home) : (this.homeSpot(def) ?? ELEVATOR.exit);
      const jitter = def.role === 'ceo' ? 0 : (i % 3) * 0.01;
      this.agents.set(def.id, {
        def,
        x: start.x + jitter,
        z: start.z,
        heading: start.facing,
        path: [],
        dest: null,
        arrived: false,
        activity: 'desk',
        plan: 'desk',
        pose: 'stand',
        until: 0,
        intentKey: '',
        visible: def.role !== 'ceo',
        patrolIdx: 0,
      });
    });
  }

  private homeSpot(def: AgentDef): Spot | null {
    if (def.role === 'reception') return RECEPTION.receptionist;
    if (def.slot !== undefined) {
      const ws = workstation(def.slot);
      return { ...(def.sub ? ws.subSeat : ws.seat), pose: 'sit' };
    }
    // Phòng ban không còn khu bàn riêng: ngồi tạm ở sofa/ghế lười.
    if (def.role === 'staff') return [...SOFA.seats, ...BEANBAGS][def.seed % (SOFA.seats.length + BEANBAGS.length)];
    return null;
  }

  private mySeat(a: AgentState): Spot | null {
    if (a.def.slot === undefined) return null;
    const ws = workstation(a.def.slot);
    return a.def.sub ? ws.subSeat : ws.seat;
  }

  private myStand(a: AgentState): Spot | null {
    if (a.def.slot === undefined) return null;
    const ws = workstation(a.def.slot);
    return a.def.sub ? ws.subStand : ws.stand;
  }

  setIntent(id: string, intent: Intent) {
    this.intents.set(id, intent);
  }

  /** Chỗ còn trống (hoặc đang do `who` giữ). */
  isFree(spotId: string, who: string): boolean {
    const o = this.occupied.get(spotId);
    return !o || o === who;
  }

  private release(a: AgentState) {
    for (const [spot, who] of this.occupied) if (who === a.def.id) this.occupied.delete(spot);
  }

  private claim(a: AgentState, spot: Spot): boolean {
    const who = this.occupied.get(spot.id);
    if (who && who !== a.def.id) return false;
    this.release(a);
    this.occupied.set(spot.id, a.def.id);
    return true;
  }

  private goTo(a: AgentState, spot: Spot, plan: Activity) {
    a.dest = spot;
    a.plan = plan;
    a.arrived = false;
    a.path = findPath({ x: a.x, z: a.z }, { x: spot.x, z: spot.z });
    a.activity = 'walk';
  }

  private freeSpot(spots: Spot[]): Spot | null {
    const free = spots.filter((s) => !this.occupied.has(s.id));
    return free.length ? free[Math.floor(this.rand() * free.length)] : null;
  }

  /** Chọn hoạt động thư giãn khi rảnh. */
  private leisure(a: AgentState, now: number, calm: boolean) {
    const r = this.rand();
    const seat = this.mySeat(a);
    const dur = (calm ? 25 : 15) + this.rand() * 25;
    a.until = now + dur * 1000;
    const pick = (spots: Spot[], plan: Activity) => {
      const s = this.freeSpot(spots);
      if (s && this.claim(a, s)) {
        this.goTo(a, s, plan);
        return true;
      }
      return false;
    };
    if (r < 0.3 && seat) {
      this.claim(a, seat);
      return this.goTo(a, { ...seat, pose: 'sit' }, 'desk');
    }
    if (r < 0.48 && pick(BILLIARDS.spots, 'billiards')) return;
    if (r < 0.6 && pick(FOOSBALL.spots, 'foosball')) return;
    if (r < 0.74 && pick(PANTRY.spots, 'coffee')) return;
    if (r < 0.86 && pick(BEANBAGS, 'beanbag')) return;
    if (r < 0.93 && pick(SOFA.seats, 'sofa')) return;
    // Ghé bàn đồng nghiệp
    const others = [...this.agents.values()].filter((o) => o !== a && o.def.slot !== undefined && o.def.slot !== a.def.slot);
    if (others.length) {
      const o = others[Math.floor(this.rand() * others.length)];
      const v = workstation(o.def.slot!).visit;
      const spot = { ...v, id: `${v.id}-${a.def.id}` };
      this.claim(a, spot);
      return this.goTo(a, spot, 'chat');
    }
    if (seat) {
      this.claim(a, seat);
      this.goTo(a, { ...seat, pose: 'sit' }, 'desk');
    }
  }

  private applyIntent(a: AgentState, intent: Intent, now: number) {
    const seat = this.mySeat(a);
    const stand = this.myStand(a);
    switch (intent.kind) {
      case 'away':
        a.visible = false;
        a.activity = 'away';
        this.release(a);
        return;
      case 'work':
        if (seat) {
          this.claim(a, seat);
          this.goTo(a, seat, 'work');
        } else {
          // Không có khu bàn riêng: mở laptop ở sofa/ghế lười còn trống.
          const s = this.freeSpot([...SOFA.seats, ...BEANBAGS]);
          if (s && this.claim(a, s)) this.goTo(a, { ...s, pose: 'type' }, 'work');
        }
        return;
      case 'alert':
        if (stand) {
          this.claim(a, stand);
          this.goTo(a, stand, 'alert');
        }
        return;
      case 'present':
        this.claim(a, MEETING.presenter);
        this.goTo(a, MEETING.presenter, 'present');
        return;
      case 'meeting': {
        const spots = [...MEETING.seats, ...MEETING.standing];
        const seat = spots.find((s) => this.occupied.get(s.id) === a.def.id) ?? this.freeSpot(MEETING.seats) ?? this.freeSpot(MEETING.standing);
        if (seat && this.claim(a, seat)) this.goTo(a, seat, 'meeting');
        else if (seat) this.goTo(a, { ...seat, pose: 'sit' }, 'desk');
        return;
      }
      case 'standby':
        if (seat) {
          this.claim(a, seat);
          this.goTo(a, { ...seat, pose: 'sit' }, 'desk');
        } else this.leisure(a, now, true);
        return;
      case 'reception':
        this.claim(a, RECEPTION.receptionist);
        this.goTo(a, RECEPTION.receptionist, 'reception');
        return;
      case 'visit': {
        // CEO: bước ra từ thang máy, dự họp hoặc đi một vòng các bàn.
        a.visible = true;
        this.goTo(a, CEO_SPOT, 'present');
        return;
      }
      case 'patrol': {
        a.patrolIdx = 0;
        this.nextPatrol(a, intent.targets, now);
        return;
      }
      case 'me':
        a.speed = 1;
        if (intent.mode !== 'hold') this.release(a);
        if (intent.mode === 'goto') {
          if (!intent.claim || this.claim(a, intent.spot)) this.goTo(a, intent.spot, intent.plan);
          else {
            // Chỗ vừa có người: đứng cạnh thay vì đè lên.
            const w = walkablePoint(intent.spot);
            this.goTo(a, { ...intent.spot, ...w, id: `${intent.spot.id}-near`, pose: 'stand' }, 'boss');
          }
          // Đi nhanh hơn khi bấm xa để không phải chờ lâu.
          a.speed = Math.min(2.2, Math.max(1.3, pathLength(a) / (6 * SPEED)));
        } else if (intent.mode === 'home') this.goTo(a, ME_SPOTS.home, 'boss');
        else if (intent.mode === 'present') this.goTo(a, ME_SPOTS.present, 'present');
        else if (intent.mode === 'leave') {
          // Vội ra bấm nút gọi thang máy.
          a.until = 0;
          this.goTo(a, ELEVATOR.call, 'press');
          // Tới nút gọi trong khoảng 2,5 giây dù đang ở đâu trên tầng.
          a.speed = Math.min(6, Math.max(1.6, pathLength(a) / (2.5 * SPEED)));
        }
        return;
      case 'idle':
        this.leisure(a, now, Boolean(intent.calm));
        return;
    }
  }

  private nextPatrol(a: AgentState, targets: number[], now: number) {
    if (!targets.length) return this.leisure(a, now, true);
    const slot = targets[a.patrolIdx % targets.length];
    a.patrolIdx++;
    const v = workstation(slot).visit;
    const spot = { ...v, id: `${v.id}-${a.def.id}` };
    this.claim(a, spot);
    a.until = now + 7000;
    this.goTo(a, spot, 'patrol');
  }

  /** Cập nhật mỗi khung hình. */
  update(dt: number, now: number) {
    for (const a of this.agents.values()) {
      const intent = this.intents.get(a.def.id) ?? { kind: 'idle' };
      const key =
        intent.kind + (intent.kind === 'patrol' ? intent.targets.join(',') : intent.kind === 'visit' ? String(intent.leaveAt) : intent.kind === 'me' ? intent.mode + (intent.mode === 'goto' ? `${intent.spot.id}@${intent.spot.x.toFixed(2)},${intent.spot.z.toFixed(2)}` : '') : '');
      if (key !== a.intentKey) {
        a.intentKey = key;
        if (a.def.role === 'ceo' && intent.kind === 'visit' && !a.visible) {
          // CEO xuất hiện tại cửa thang máy.
          a.x = ELEVATOR.exit.x;
          a.z = ELEVATOR.exit.z;
          a.heading = ELEVATOR.exit.facing;
        }
        this.applyIntent(a, intent, now);
      } else if (a.arrived && a.until && now > a.until) {
        if (intent.kind === 'idle') this.leisure(a, now, Boolean(intent.calm));
        else if (intent.kind === 'patrol') this.nextPatrol(a, intent.targets, now);
      } else if (a.def.role === 'ceo' && intent.kind === 'visit' && now > intent.leaveAt - 7000 && a.plan !== 'away') {
        // Sắp rời tầng: quay lại thang máy.
        this.release(a);
        this.goTo(a, ELEVATOR.exit, 'away');
      }

      if (a.def.role === 'me') this.updateMe(a, now);
      if (!a.visible) continue;
      // Di chuyển theo đường đi
      if (a.path.length) {
        const p = a.path[0];
        const dx = p.x - a.x;
        const dz = p.z - a.z;
        const d = Math.hypot(dx, dz);
        const step = SPEED * (a.speed ?? 1) * dt;
        if (d <= step) {
          a.x = p.x;
          a.z = p.z;
          a.path.shift();
        } else {
          a.x += (dx / d) * step;
          a.z += (dz / d) * step;
        }
        const want = Math.atan2(dx, dz);
        let diff = want - a.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        a.heading += diff * Math.min(1, dt * 10);
        a.activity = 'walk';
        a.pose = 'stand';
      } else if (a.dest && !a.arrived) {
        a.arrived = true;
        a.x = a.dest.x;
        a.z = a.dest.z;
        a.activity = a.plan;
        if (a.plan === 'away') {
          a.visible = false;
          continue;
        }
      }
      if (a.arrived && a.dest) {
        let diff = a.dest.facing - a.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        a.heading += diff * Math.min(1, dt * 6);
        a.pose =
          a.plan === 'work' ? 'type' : a.plan === 'desk' ? 'sit' : a.plan === 'chat' || a.plan === 'patrol' ? 'talk' : a.plan === 'lift' ? 'stand' : a.dest.pose;
      }
    }
  }

  /** CEO (bạn): bước ra khỏi thang máy khi tới tầng; khi rời tầng thì bấm nút → cửa mở → bước vào → cửa đóng. */
  private updateMe(a: AgentState, now: number) {
    const lift = ELEVATOR.inside;
    // Cửa mở khi bạn còn ở trong/sát thang máy lúc vừa tới tầng.
    if (a.plan !== 'press' && a.plan !== 'lift') this.meDoor = a.x < ELEVATOR.exit.x + 0.5 ? 1 : 0;
    this.callLit = a.plan === 'press' || a.plan === 'lift';
    if (a.plan === 'press' && a.arrived) {
      if (!a.until) a.until = now + 650; // giữ tay bấm nút
      else if (now > a.until) {
        this.meDoor = 1;
        if (now > a.until + 700) {
          // Cửa đã mở: bước thẳng vào cabin rồi quay mặt ra.
          a.path = [
            { x: ELEVATOR.exit.x, z: ELEVATOR.exit.z },
            { x: lift.x, z: lift.z },
          ];
          a.dest = lift;
          a.plan = 'lift';
          a.arrived = false;
          a.until = 0;
        }
      }
    } else if (a.plan === 'lift' && a.arrived) {
      if (!a.until) a.until = now + 350;
      else if (now > a.until) {
        this.meDoor = 0;
        if (!this.meInLiftAt) this.meInLiftAt = now;
      }
    }
  }
}

// ---------------- CEO tổng: lịch đi các tầng (dùng chung cho cảnh toà nhà & cảnh tầng) ----------------

export interface CeoFloorInfo {
  number: number;
  busy: boolean;
  assignedAt: string | null;
}

export interface CeoState {
  floor: number; // 0 = tầng trệt
  traveling: boolean;
  from: number;
  to: number;
  /** 0..1 khi đang đi thang máy. */
  progress: number;
  arrivedAt: number;
  leaveAt: number;
}

const STOP_MS = 45_000;
const TRAVEL_MS = 7_000;
const PRIORITY_MS = 90_000;

/** Lịch xác định theo đồng hồ: ưu tiên tầng vừa nhận dự án, sau đó lần lượt ghé các tầng đang bận. */
export function ceoPlan(now: number, floors: CeoFloorInfo[]): CeoState {
  const recent = floors
    .filter((f) => f.busy && f.assignedAt && now - new Date(f.assignedAt).getTime() < PRIORITY_MS)
    .sort((a, b) => new Date(b.assignedAt!).getTime() - new Date(a.assignedAt!).getTime())[0];
  if (recent) {
    const start = new Date(recent.assignedAt!).getTime();
    const t = now - start;
    if (t < TRAVEL_MS) return { floor: recent.number, traveling: true, from: 0, to: recent.number, progress: t / TRAVEL_MS, arrivedAt: start + TRAVEL_MS, leaveAt: start + PRIORITY_MS };
    return { floor: recent.number, traveling: false, from: 0, to: recent.number, progress: 1, arrivedAt: start + TRAVEL_MS, leaveAt: start + PRIORITY_MS };
  }
  const stops = [0, ...floors.filter((f) => f.busy).map((f) => f.number)];
  const idx = Math.floor(now / STOP_MS);
  const stop = stops[idx % stops.length];
  const prev = stops[(idx - 1 + stops.length) % stops.length];
  const t = now % STOP_MS;
  const slotStart = now - t;
  if (t < TRAVEL_MS && prev !== stop) {
    return { floor: stop, traveling: true, from: prev, to: stop, progress: t / TRAVEL_MS, arrivedAt: slotStart + TRAVEL_MS, leaveAt: slotStart + STOP_MS };
  }
  return { floor: stop, traveling: false, from: prev, to: stop, progress: 1, arrivedAt: slotStart + (prev !== stop ? TRAVEL_MS : 0), leaveAt: slotStart + STOP_MS };
}

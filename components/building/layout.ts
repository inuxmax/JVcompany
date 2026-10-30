// Mặt bằng một tầng làm việc (đơn vị: mét). Trục x sang phải, trục z hướng về phía người xem.
// Tường sau ở z = -FD/2, tường trái ở x = -FW/2; mặt trước và bên phải để mở (nhìn cắt).
import { localize } from '@/lib/i18n';

export const FW = 30;
export const FD = 19;
export const WALL_H = 3.2;
export const X0 = -FW / 2;
export const Z0 = -FD / 2;

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export type Pose = 'stand' | 'sit' | 'type' | 'present' | 'billiards' | 'foosball' | 'drink' | 'lounge' | 'talk' | 'press';

/** Một vị trí đứng/ngồi có hướng mặt (radian, 0 = nhìn về +z). */
export interface Spot {
  id: string;
  x: number;
  z: number;
  facing: number;
  pose: Pose;
  /** Độ cao mông khi ngồi. */
  seatY?: number;
}

const R = (x0: number, z0: number, x1: number, z1: number): Rect => ({ x0, z0, x1, z1 });
const cx = (r: Rect) => (r.x0 + r.x1) / 2;
const cz = (r: Rect) => (r.z0 + r.z1) / 2;
const FACE_FRONT = 0; // nhìn về +z
const FACE_BACK = Math.PI;
const FACE_RIGHT = Math.PI / 2; // nhìn về +x
const FACE_LEFT = -Math.PI / 2;

// Hàng & cột của mặt bằng
const ROW_BACK = { z0: -9.3, z1: -4.6 };
const ROW_MID = { z0: -3.0, z1: 1.7 };
const ROW_FRONT = { z0: 3.2, z1: 9.3 };
const COL_A = { x0: -9.2, x1: -4.0 };
const COL_B = { x0: -3.8, x1: 1.4 };
const COL_C = { x0: 1.6, x1: 6.8 };
const COL_D = { x0: 7.0, x1: 12.2 };

export const ZONES = {
  office: R(COL_A.x0, ROW_BACK.z0, COL_A.x1, ROW_BACK.z1),
  meeting: R(7.0, ROW_BACK.z0, 14.8, ROW_BACK.z1),
  pantry: R(12.4, ROW_MID.z0, 14.8, ROW_MID.z1),
  reception: R(-14.8, ROW_FRONT.z0, -7.0, ROW_FRONT.z1),
  lobby: R(-14.8, ROW_BACK.z0, -9.4, ROW_MID.z1),
  chill: R(-1.4, ROW_FRONT.z0, 14.8, ROW_FRONT.z1),
};

/** 8 khu phòng ban. Slot 0 là phòng kính của giám đốc tầng. */
export const DEPT_SLOTS: Rect[] = [
  ZONES.office,
  R(COL_B.x0, ROW_BACK.z0, COL_B.x1, ROW_BACK.z1),
  R(COL_C.x0, ROW_BACK.z0, COL_C.x1, ROW_BACK.z1),
  R(COL_A.x0, ROW_MID.z0, COL_A.x1, ROW_MID.z1),
  R(COL_B.x0, ROW_MID.z0, COL_B.x1, ROW_MID.z1),
  R(COL_C.x0, ROW_MID.z0, COL_C.x1, ROW_MID.z1),
  R(COL_D.x0, ROW_MID.z0, COL_D.x1, ROW_MID.z1),
  R(-6.8, ROW_FRONT.z0, -1.6, ROW_FRONT.z1),
];

/** Thứ tự ưu tiên xếp phòng ban vào khu (phòng ban khác lấp các khu còn trống). */
export const DEPT_ORDER = ['director', 'management', 'meeting', 'studio', 'dev', 'engineering', 'coordination', 'qa'];

export function assignSlots(deptIds: string[]): Map<string, number> {
  const out = new Map<string, number>();
  const used = new Set<number>();
  for (const id of DEPT_ORDER) {
    if (!deptIds.includes(id)) continue;
    const slot = DEPT_ORDER.indexOf(id);
    out.set(id, slot);
    used.add(slot);
  }
  let next = 1;
  for (const id of deptIds) {
    if (out.has(id)) continue;
    while (used.has(next) && next < DEPT_SLOTS.length) next++;
    if (next >= DEPT_SLOTS.length) break;
    out.set(id, next);
    used.add(next);
  }
  return out;
}

export interface Workstation {
  slot: number;
  rect: Rect;
  /** Bàn chính (agent) và bàn phụ. */
  desks: { x: number; z: number; w: number; d: number }[];
  seat: Spot;
  /** Chỗ đứng cạnh bàn (khi cần bạn phê duyệt…). */
  stand: Spot;
  /** Bàn thứ hai trong khu – cho phòng ngồi chung (vd Test cạnh QA, Fix Bug cạnh Dev). */
  subSeat: Spot;
  subStand: Spot;
  /** Chỗ khách đứng nói chuyện (đồng nghiệp ghé thăm / giám đốc kiểm tra). */
  visit: Spot;
  plaque: { x: number; z: number };
}

export function workstation(slot: number): Workstation {
  const rect = DEPT_SLOTS[slot];
  const x = cx(rect);
  const z = cz(rect);
  if (slot === 0) {
    // Phòng giám đốc: một bàn lớn
    return {
      slot,
      rect,
      desks: [{ x, z: z - 0.3, w: 2.2, d: 0.9 }],
      seat: { id: `seat-${slot}`, x, z: z - 1.2, facing: FACE_FRONT, pose: 'type', seatY: 0.48 },
      stand: { id: `stand-${slot}`, x: x + 1.5, z: z - 1.1, facing: FACE_FRONT, pose: 'stand' },
      subSeat: { id: `seat-${slot}`, x, z: z - 1.2, facing: FACE_FRONT, pose: 'type', seatY: 0.48 },
      subStand: { id: `stand-${slot}`, x: x + 1.5, z: z - 1.1, facing: FACE_FRONT, pose: 'stand' },
      visit: { id: `visit-${slot}`, x, z: z + 0.7, facing: FACE_BACK, pose: 'talk' },
      plaque: { x, z: rect.z1 + 0.55 },
    };
  }
  return {
    slot,
    rect,
    desks: [
      { x: x - 1.25, z: z - 0.5, w: 1.6, d: 0.8 },
      { x: x + 1.25, z: z - 0.5, w: 1.6, d: 0.8 },
    ],
    seat: { id: `seat-${slot}`, x: x - 1.25, z: z - 1.3, facing: FACE_FRONT, pose: 'type', seatY: 0.48 },
    stand: { id: `stand-${slot}`, x: x - 2.35, z: z - 1.1, facing: FACE_FRONT, pose: 'stand' },
    subSeat: { id: `seat-${slot}-b`, x: x + 1.25, z: z - 1.3, facing: FACE_FRONT, pose: 'type', seatY: 0.48 },
    subStand: { id: `stand-${slot}-b`, x: x + 2.35, z: z - 1.1, facing: FACE_FRONT, pose: 'stand' },
    visit: { id: `visit-${slot}`, x: x - 1.25, z: z + 0.45, facing: FACE_BACK, pose: 'talk' },
    plaque: { x, z: z + 1.55 },
  };
}

// ---------------- Phòng họp ----------------

export const MEETING = (() => {
  const r = ZONES.meeting;
  const tx = 11.2;
  const tz = cz(r);
  const xs = [9.5, 10.6, 11.7, 12.8];
  const seats: Spot[] = [
    ...xs.map((x, i) => ({ id: `meet-b${i}`, x, z: tz - 1.2, facing: FACE_FRONT, pose: 'sit' as Pose, seatY: 0.48 })),
    ...xs.map((x, i) => ({ id: `meet-f${i}`, x, z: tz + 1.2, facing: FACE_BACK, pose: 'sit' as Pose, seatY: 0.48 })),
  ];
  return {
    table: { x: tx, z: tz, w: 4.4, d: 1.5 },
    seats,
    presenter: { id: 'meet-head', x: 13.95, z: tz, facing: FACE_LEFT, pose: 'present' } as Spot,
    /** Chỗ đứng thêm cuối bàn khi đông người dự họp. */
    standing: [
      { id: 'meet-s0', x: 8.15, z: tz - 0.7, facing: FACE_RIGHT, pose: 'stand' } as Spot,
      { id: 'meet-s1', x: 8.15, z: tz + 0.7, facing: FACE_RIGHT, pose: 'stand' } as Spot,
    ],
    screen: { x: 14.55, z: tz },
    door: { x: 8.2, z: r.z1 },
  };
})();

// ---------------- Khu nghỉ ----------------

export const BILLIARDS = {
  table: { x: 10.4, z: 6.4, w: 2.6, d: 1.45 },
  spots: [
    { id: 'pool-a', x: 8.55, z: 6.4, facing: FACE_RIGHT, pose: 'billiards' } as Spot,
    { id: 'pool-b', x: 12.25, z: 6.75, facing: FACE_LEFT, pose: 'billiards' } as Spot,
    { id: 'pool-c', x: 11.0, z: 7.85, facing: FACE_BACK, pose: 'stand' } as Spot,
  ],
};

export const FOOSBALL = {
  table: { x: 4.6, z: 7.3, w: 0.8, d: 1.4 },
  spots: [
    { id: 'foos-a', x: 3.85, z: 7.3, facing: FACE_RIGHT, pose: 'foosball' } as Spot,
    { id: 'foos-b', x: 5.35, z: 7.3, facing: FACE_LEFT, pose: 'foosball' } as Spot,
  ],
};

export const BEANBAGS: (Spot & { color: string })[] = [
  { id: 'bean-0', x: 0.1, z: 4.9, facing: 0.6, pose: 'lounge', seatY: 0.28, color: '#4A86BD' },
  { id: 'bean-1', x: 1.6, z: 5.9, facing: 0.2, pose: 'lounge', seatY: 0.28, color: '#C4483F' },
  { id: 'bean-2', x: -0.3, z: 7.1, facing: 1.2, pose: 'lounge', seatY: 0.28, color: '#E0B44A' },
  { id: 'bean-3', x: 1.4, z: 8.3, facing: 2.2, pose: 'lounge', seatY: 0.28, color: '#5C9A68' },
  { id: 'bean-4', x: 2.6, z: 7.0, facing: -1.4, pose: 'lounge', seatY: 0.28, color: '#F4EEE3' },
];

export const SOFA = {
  sofa: { x: 7.4, z: 8.85, w: 2.4, d: 0.85 },
  table: { x: 7.4, z: 7.75, w: 1.2, d: 0.6 },
  seats: [
    { id: 'sofa-0', x: 6.85, z: 8.6, facing: FACE_BACK, pose: 'sit', seatY: 0.45 } as Spot,
    { id: 'sofa-1', x: 7.95, z: 8.6, facing: FACE_BACK, pose: 'sit', seatY: 0.45 } as Spot,
  ],
};

export const PANTRY = {
  counter: { x: 14.45, z: -0.65, w: 0.6, d: 4.0 },
  spots: [
    { id: 'coffee-0', x: 13.55, z: -1.9, facing: FACE_RIGHT, pose: 'drink' } as Spot,
    { id: 'coffee-1', x: 13.55, z: -0.5, facing: FACE_RIGHT, pose: 'drink' } as Spot,
    { id: 'coffee-2', x: 13.55, z: 0.9, facing: FACE_RIGHT, pose: 'drink' } as Spot,
  ],
};

// ---------------- Sảnh lễ tân & thang máy ----------------

export const RECEPTION = {
  wall: { x: -11.0, z: 3.45, w: 4.6, d: 0.2 },
  counter: { x: -11.0, z: 5.0, w: 3.0, d: 0.7 },
  receptionist: { id: 'reception', x: -11.0, z: 4.3, facing: FACE_FRONT, pose: 'stand' } as Spot,
  sofas: [
    { x: -13.75, z: 7.9, w: 0.85, d: 2.0, facing: FACE_RIGHT },
    { x: -8.35, z: 7.9, w: 0.85, d: 2.0, facing: FACE_LEFT },
  ],
  table: { x: -11.05, z: 7.9, r: 0.55 },
  seats: [
    { id: 'lobby-0', x: -13.5, z: 7.4, facing: FACE_RIGHT, pose: 'sit', seatY: 0.45 } as Spot,
    { id: 'lobby-1', x: -8.6, z: 8.4, facing: FACE_LEFT, pose: 'sit', seatY: 0.45 } as Spot,
  ],
};

export const ELEVATOR = {
  /** Cửa thang máy trên tường trái. */
  door: { x: X0, z: -3.8, w: 1.8 },
  exit: { id: 'elevator', x: -13.95, z: -3.8, facing: FACE_RIGHT, pose: 'stand' } as Spot,
  inside: { id: 'elevator-inside', x: X0 - 0.9, z: -3.8, facing: FACE_RIGHT, pose: 'stand' } as Spot,
  /** Bảng nút gọi thang máy cạnh cửa + chỗ đứng bấm nút. */
  button: { x: X0 + 0.03, y: 1.15, z: -2.45 },
  call: { id: 'elevator-call', x: -14.4, z: -2.45, facing: FACE_LEFT, pose: 'press' } as Spot,
};

/** Chỗ của CEO (bạn) trên mỗi tầng: đứng ở sảnh thang máy quan sát, và đứng cạnh màn hình phòng họp khi giao việc. */
export const ME_SPOTS = {
  home: { id: 'me-home', x: -12.3, z: -2.3, facing: FACE_RIGHT + 0.35, pose: 'stand' } as Spot,
  present: { id: 'me-present', x: 13.85, z: -5.55, facing: FACE_LEFT, pose: 'present' } as Spot,
};

export const PLANTS: { x: number; z: number; s: number }[] = [
  { x: -14.3, z: -8.9, s: 1.1 },
  { x: -9.9, z: -8.9, s: 0.9 },
  { x: -14.3, z: 1.2, s: 1.0 },
  { x: -14.3, z: 9.0, s: 1.1 },
  { x: -4.5, z: -8.85, s: 0.8 },
  { x: 6.6, z: -3.5, s: 0.8 },
  { x: -1.2, z: 2.5, s: 0.8 },
  { x: 14.35, z: 3.6, s: 1.1 },
  { x: 14.35, z: 9.0, s: 1.2 },
  { x: -1.1, z: 9.0, s: 1.0 },
  { x: 12.2, z: 2.4, s: 0.8 },
  { x: -6.9, z: 9.0, s: 0.9 },
];

/** Vách kính cao (phòng giám đốc, phòng họp) – đoạn thẳng có chừa cửa. */
export const GLASS_WALLS: { x0: number; z0: number; x1: number; z1: number; h: number }[] = [
  // Phòng giám đốc: mặt trước (chừa cửa) + mặt phải
  { x0: COL_A.x0, z0: ROW_BACK.z1, x1: -5.7, z1: ROW_BACK.z1, h: 2.6 },
  { x0: -4.6, z0: ROW_BACK.z1, x1: COL_A.x1, z1: ROW_BACK.z1, h: 2.6 },
  { x0: COL_A.x1, z0: ROW_BACK.z0, x1: COL_A.x1, z1: ROW_BACK.z1, h: 2.6 },
  { x0: COL_A.x0, z0: ROW_BACK.z0, x1: COL_A.x0, z1: ROW_BACK.z1, h: 2.6 },
  // Phòng họp: mặt trước (chừa cửa) + mặt trái
  { x0: 7.0, z0: ROW_BACK.z1, x1: 7.6, z1: ROW_BACK.z1, h: 2.6 },
  { x0: 8.8, z0: ROW_BACK.z1, x1: 14.8, z1: ROW_BACK.z1, h: 2.6 },
  { x0: 7.0, z0: ROW_BACK.z0, x1: 7.0, z1: ROW_BACK.z1, h: 2.6 },
];

/** Vách kính thấp giữa các khu làm việc. */
export const LOW_PARTITIONS: { x0: number; z0: number; x1: number; z1: number }[] = [1, 2, 3, 4, 5, 6, 7].map((slot) => {
  const r = DEPT_SLOTS[slot];
  return { x0: r.x1 - 0.05, z0: r.z0 + 0.5, x1: r.x1 - 0.05, z1: r.z0 + 2.7 };
});

export function rectOf(o: { x: number; z: number; w: number; d: number }): Rect {
  return { x0: o.x - o.w / 2, z0: o.z - o.d / 2, x1: o.x + o.w / 2, z1: o.z + o.d / 2 };
}

/** Tất cả vật cản cho tìm đường (đã gồm bàn của mọi khu). */
export function obstacles(): Rect[] {
  const out: Rect[] = [];
  for (let s = 0; s < DEPT_SLOTS.length; s++) for (const d of workstation(s).desks) out.push(rectOf(d));
  out.push(rectOf(MEETING.table), rectOf(BILLIARDS.table), rectOf(FOOSBALL.table), rectOf(SOFA.sofa), rectOf(SOFA.table));
  out.push(rectOf(PANTRY.counter), rectOf(RECEPTION.wall), rectOf(RECEPTION.counter));
  out.push(rectOf({ x: MEETING.screen.x, z: MEETING.screen.z, w: 0.3, d: 1.6 }));
  for (const s of RECEPTION.sofas) out.push(rectOf(s));
  out.push(rectOf({ x: RECEPTION.table.x, z: RECEPTION.table.z, w: 1.1, d: 1.1 }));
  for (const p of PLANTS) out.push(rectOf({ x: p.x, z: p.z, w: 0.6 * p.s, d: 0.6 * p.s }));
  // Kệ sách phòng giám đốc
  out.push(rectOf({ x: -8.3, z: -9.0, w: 1.4, d: 0.4 }));
  for (const w of [...GLASS_WALLS, ...LOW_PARTITIONS]) {
    out.push({ x0: Math.min(w.x0, w.x1) - 0.05, z0: Math.min(w.z0, w.z1) - 0.05, x1: Math.max(w.x0, w.x1) + 0.05, z1: Math.max(w.z0, w.z1) + 0.05 });
  }
  return out;
}

/** Biển tên khu nằm trên sàn (chữ dịch lúc đọc `text`). */
export const FLOOR_SIGNS: { text: string; sub?: string; x: number; z: number; w: number }[] = localize([
  { text: 'SẢNH LỄ TÂN', x: -11.05, z: 9.05, w: 3.2 },
  { text: 'PHÒNG HỌP', x: 11.2, z: -4.15, w: 2.8 },
  { text: 'KHU NGHỈ · BI-DA', x: 6.6, z: 3.6, w: 3.8 },
  { text: 'PANTRY', x: 13.6, z: 2.35, w: 1.9 },
]);

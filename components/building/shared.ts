// Phần dùng chung giữa cảnh tầng và cảnh toà nhà.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Department, FloorView, Task, Workflow } from '@/lib/types';
import { localize, t } from '@/lib/i18n';
import type { Activity } from './sim';

export type DeptWithTasks = Pick<Department, '_id' | 'name' | 'title' | 'icon' | 'color' | 'enabled' | 'status' | 'pauseReason'> & { activeTasks: Task[] };

export interface BuildingData {
  floors: FloorView[];
  departments: DeptWithTasks[];
  workflows: Workflow[];
}

function subscribeTheme(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
}

export function useDarkTheme() {
  return useSyncExternalStore(subscribeTheme, () => document.documentElement.dataset.theme === 'dark', () => false);
}

function subscribeMotion(cb: () => void) {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

/** Người dùng bật "giảm chuyển động" trong hệ điều hành. */
export function useReducedMotion() {
  return useSyncExternalStore(subscribeMotion, () => window.matchMedia('(prefers-reduced-motion: reduce)').matches, () => false);
}

/** Camera bắt đầu từ góc khác rồi bay về khung chuẩn khi cảnh vừa mở. */
export interface CameraIntro {
  /** Điểm nhìn lúc đầu (mặc định = điểm nhìn cuối). */
  target?: THREE.Vector3;
  /** Hướng nhìn lúc đầu (mặc định = hướng cuối). */
  dir?: THREE.Vector3;
  /** Khoảng cách lúc đầu so với khoảng cách cuối. */
  scale: number;
  ms: number;
}

type Controls = { target: THREE.Vector3; update: () => void; enabled: boolean };

interface CameraTween {
  from: THREE.Spherical;
  to: THREE.Spherical;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  t0: number;
  ms: number;
}

const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);

/** Khoá/mở kéo xoay camera trong lúc camera đang bay. */
function setControlsEnabled(c: Controls | null, on: boolean) {
  if (c) c.enabled = on;
}

/**
 * Đặt camera theo hướng `dir` sao cho toàn bộ hộp `box` nằm gọn trong khung hình.
 * `intro`: lần đầu bay vào từ góc khác. `tweenMs`: khi khung đổi (vd vào một tầng) thì bay mượt từ góc hiện tại.
 */
export function FitCamera({
  box,
  dir,
  target,
  margin = 0.9,
  intro,
  tweenMs,
}: {
  box: THREE.Box3;
  dir: THREE.Vector3;
  target: THREE.Vector3;
  margin?: number;
  intro?: CameraIntro;
  tweenMs?: number;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as Controls | null;
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  // Hiệu ứng mở cảnh chỉ lấy theo lúc gắn vào (đổi về sau không chạy lại).
  const [introAtMount] = useState(intro);
  const first = useRef(true);
  const tween = useRef<CameraTween | null>(null);
  const tmp = useMemo(() => ({ v: new THREE.Vector3(), s: new THREE.Spherical() }), []);

  useFrame(() => {
    const a = tween.current;
    if (!a) return;
    const p = Math.min(1, (performance.now() - a.t0) / a.ms);
    const e = easeOutCubic(p);
    let dTheta = a.to.theta - a.from.theta;
    while (dTheta > Math.PI) dTheta -= Math.PI * 2;
    while (dTheta < -Math.PI) dTheta += Math.PI * 2;
    tmp.s.set(a.from.radius + (a.to.radius - a.from.radius) * e, a.from.phi + (a.to.phi - a.from.phi) * e, a.from.theta + dTheta * e);
    tmp.v.lerpVectors(a.fromTarget, a.toTarget, e);
    camera.position.setFromSpherical(tmp.s).add(tmp.v);
    camera.lookAt(tmp.v);
    if (controls) {
      controls.target.copy(tmp.v);
      controls.update();
    }
    if (p >= 1) {
      tween.current = null;
      setControlsEnabled(controls, true);
    }
  });

  useEffect(() => {
    const isFirst = first.current;
    first.current = false;
    const startPos = camera.position.clone();
    const startTarget = controls ? controls.target.clone() : target.clone();
    const corners: THREE.Vector3[] = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    const d = dir.clone().normalize();
    const v = new THREE.Vector3();
    const fits = (dist: number) => {
      camera.position.copy(target).addScaledVector(d, dist);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
      return corners.every((c) => {
        v.copy(c).project(camera);
        return Math.abs(v.x) <= margin && Math.abs(v.y) <= margin;
      });
    };
    let lo = 1;
    let hi = 400;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    fits(hi);
    const endPos = camera.position.clone();
    const sph = (pos: THREE.Vector3, at: THREE.Vector3) => new THREE.Spherical().setFromVector3(pos.clone().sub(at));
    let from: { pos: THREE.Vector3; target: THREE.Vector3; ms: number } | null = null;
    if (isFirst && introAtMount) {
      const at = introAtMount.target ?? target;
      const d = (introAtMount.dir ?? dir).clone().normalize();
      from = { pos: at.clone().addScaledVector(d, endPos.distanceTo(target) * introAtMount.scale), target: at, ms: introAtMount.ms };
    } else if (!isFirst && tweenMs) {
      from = { pos: startPos, target: startTarget, ms: tweenMs };
    }
    if (from) {
      tween.current = { from: sph(from.pos, from.target), to: sph(endPos, target), fromTarget: from.target.clone(), toTarget: target.clone(), t0: performance.now(), ms: from.ms };
      camera.position.copy(from.pos);
      camera.lookAt(from.target);
      setControlsEnabled(controls, false);
      if (controls) {
        controls.target.copy(from.target);
        controls.update();
      }
    } else {
      tween.current = null;
      setControlsEnabled(controls, true);
      if (controls) {
        controls.target.copy(target);
        controls.update();
      }
    }
  }, [camera, controls, width, height, box, dir, target, margin, introAtMount, tweenMs]);
  return null;
}

export const ACTIVITY_TEXT: Record<Activity, string> = localize({
  walk: 'Đang di chuyển',
  work: 'Đang làm việc',
  meeting: 'Đang họp nhận việc',
  present: 'Đang giao việc',
  alert: 'Cần bạn phê duyệt',
  patrol: 'Đang kiểm tra công việc',
  desk: 'Ngồi tại bàn',
  coffee: 'Uống cà phê',
  beanbag: 'Nghỉ ngơi',
  sofa: 'Nghỉ ngơi',
  billiards: 'Chơi bi-da',
  foosball: 'Chơi bi-lắc',
  chat: 'Trao đổi với đồng nghiệp',
  reception: 'Trực lễ tân',
  away: 'Vắng mặt',
  boss: 'Đang quan sát tầng',
  press: 'Bấm gọi thang máy',
  lift: 'Đang đi thang máy',
});

export const ACTIVITY_DOT: Record<Activity, string> = {
  walk: '#9A9083',
  work: '#E0B44A',
  meeting: '#4A86BD',
  present: '#C4532A',
  alert: '#C4483F',
  patrol: '#8A7DAE',
  desk: '#9A9083',
  coffee: '#5C9A68',
  beanbag: '#5C9A68',
  sofa: '#5C9A68',
  billiards: '#5C9A68',
  foosball: '#5C9A68',
  chat: '#3F8A93',
  reception: '#9A9083',
  away: '#9A9083',
  boss: '#E0B44A',
  press: '#E0B44A',
  lift: '#E0B44A',
};

/** Tên vị trí ngắn gọn cho bảng tên (bỏ phần trong ngoặc). */
export function shortTitle(d: Pick<Department, 'title' | 'name'>): string {
  const name = t(d.title || d.name).split('(')[0].trim();
  return name.length > 26 ? `${name.slice(0, 25)}…` : name;
}

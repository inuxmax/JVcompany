'use client';
// Nhân vật low-poly có khớp (hông, gối, vai, khuỷu, đầu) + bộ tư thế/hoạt ảnh.
import { useMemo, useRef, useEffect, type MutableRefObject } from 'react';
import * as THREE from 'three';
import type { Pose } from './layout';

export interface Look {
  shirt: string;
  pants: string;
  skin: string;
  hair: string;
  hairStyle: number;
  suit?: boolean;
  tie?: string;
}

export interface Rig {
  root: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  elbowL: THREE.Group;
  elbowR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
  cue: THREE.Group;
  cup: THREE.Group;
}

const SKINS = ['#F1D3B5', '#E8C29E', '#D6A57E', '#B98458', '#8E5E3B'];
const HAIRS = ['#1F1A17', '#3B2A20', '#5A3E2B', '#A7824F', '#8A8682', '#2B2220'];
const PANTS = ['#2F3440', '#3B3530', '#45494F', '#262626', '#4D4236', '#33404A'];

export function lookFor(seed: number, shirt: string, extra?: Partial<Look>): Look {
  const r = (k: number) => Math.abs(Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1;
  return {
    shirt,
    pants: PANTS[Math.floor(r(1) * PANTS.length)],
    skin: SKINS[Math.floor(r(2) * SKINS.length)],
    hair: HAIRS[Math.floor(r(3) * HAIRS.length)],
    hairStyle: Math.floor(r(4) * 5),
    ...extra,
  };
}

function Hair({ style, color }: { style: number; color: string }) {
  const mat = <meshStandardMaterial color={color} roughness={0.85} />;
  switch (style) {
    case 0: // tóc ngắn
      return (
        <mesh position={[0, 0.05, -0.01]} castShadow>
          <sphereGeometry args={[0.165, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2.1]} />
          {mat}
        </mesh>
      );
    case 1: // tóc dựng
      return (
        <group position={[0, 0.1, 0]}>
          {[-0.08, 0, 0.08].map((x, i) => (
            <mesh key={i} position={[x, 0.04, -0.02]} rotation={[-0.3, 0, x * 3]} castShadow>
              <coneGeometry args={[0.07, 0.16, 6]} />
              {mat}
            </mesh>
          ))}
          <mesh position={[0, -0.03, -0.02]}>
            <sphereGeometry args={[0.16, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2.4]} />
            {mat}
          </mesh>
        </group>
      );
    case 2: // tóc dài
      return (
        <group>
          <mesh position={[0, 0.05, -0.01]} castShadow>
            <sphereGeometry args={[0.17, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            {mat}
          </mesh>
          <mesh position={[0, -0.12, -0.09]} castShadow>
            <boxGeometry args={[0.3, 0.32, 0.1]} />
            {mat}
          </mesh>
        </group>
      );
    case 3: // búi tóc
      return (
        <group>
          <mesh position={[0, 0.05, -0.01]} castShadow>
            <sphereGeometry args={[0.165, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2.1]} />
            {mat}
          </mesh>
          <mesh position={[0, 0.17, -0.08]} castShadow>
            <sphereGeometry args={[0.08, 12, 10]} />
            {mat}
          </mesh>
        </group>
      );
    default: // hói nhẹ hai bên
      return (
        <mesh position={[0, -0.02, -0.03]} castShadow>
          <torusGeometry args={[0.15, 0.035, 8, 18, Math.PI]} />
          {mat}
        </mesh>
      );
  }
}

/** Mô hình người. Đăng ký khung xương vào `registry` để bộ mô phỏng điều khiển trực tiếp các khớp. */
export function Person({ look, id, registry }: { look: Look; id: string; registry: MutableRefObject<Map<string, Rig>> }) {
  const root = useRef<THREE.Group>(null);
  const hips = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const elbowL = useRef<THREE.Group>(null);
  const elbowR = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const kneeL = useRef<THREE.Group>(null);
  const kneeR = useRef<THREE.Group>(null);
  const cue = useRef<THREE.Group>(null);
  const cup = useRef<THREE.Group>(null);
  useEffect(() => {
    const map = registry.current;
    map.set(id, {
      root: root.current!,
      hips: hips.current!,
      torso: torso.current!,
      head: head.current!,
      armL: armL.current!,
      armR: armR.current!,
      elbowL: elbowL.current!,
      elbowR: elbowR.current!,
      legL: legL.current!,
      legR: legR.current!,
      kneeL: kneeL.current!,
      kneeR: kneeR.current!,
      cue: cue.current!,
      cup: cup.current!,
    });
    return () => {
      map.delete(id);
    };
  }, [id, registry]);
  const arms = { L: armL, R: armR };
  const elbows = { L: elbowL, R: elbowR };
  const legs = { L: legL, R: legR };
  const knees = { L: kneeL, R: kneeR };
  const shirt = look.suit ? '#2A2622' : look.shirt;
  const sleeve = shirt;
  const mats = useMemo(
    () => ({
      skin: new THREE.MeshStandardMaterial({ color: look.skin, roughness: 0.7 }),
      shirt: new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.75 }),
      pants: new THREE.MeshStandardMaterial({ color: look.pants, roughness: 0.8 }),
      shoe: new THREE.MeshStandardMaterial({ color: '#1c1a18', roughness: 0.6 }),
      eye: new THREE.MeshStandardMaterial({ color: '#141210', roughness: 0.3 }),
    }),
    [look.skin, shirt, look.pants],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  return (
    <group ref={root}>
      <group ref={hips} position={[0, 0.92, 0]}>
        {/* Thân trên */}
        <group ref={torso}>
          <mesh position={[0, 0.27, 0]} castShadow material={mats.shirt}>
            <boxGeometry args={[0.38, 0.5, 0.22]} />
          </mesh>
          <mesh position={[0, 0.0, 0]} castShadow material={mats.pants}>
            <boxGeometry args={[0.36, 0.12, 0.21]} />
          </mesh>
          {look.tie && (
            <mesh position={[0, 0.32, 0.115]}>
              <boxGeometry args={[0.06, 0.3, 0.01]} />
              <meshStandardMaterial color={look.tie} />
            </mesh>
          )}
          {look.suit && (
            <mesh position={[0, 0.42, 0.112]}>
              <boxGeometry args={[0.14, 0.12, 0.01]} />
              <meshStandardMaterial color="#F4F1EA" />
            </mesh>
          )}
          {/* Đầu */}
          <group ref={head} position={[0, 0.66, 0]}>
            <mesh position={[0, -0.09, 0]} material={mats.skin}>
              <cylinderGeometry args={[0.06, 0.07, 0.08, 10]} />
            </mesh>
            <mesh castShadow material={mats.skin} scale={[1, 1.08, 1]} position={[0, 0.06, 0]}>
              <sphereGeometry args={[0.15, 20, 16]} />
            </mesh>
            <mesh position={[-0.05, 0.08, 0.135]} material={mats.eye}>
              <sphereGeometry args={[0.018, 8, 8]} />
            </mesh>
            <mesh position={[0.05, 0.08, 0.135]} material={mats.eye}>
              <sphereGeometry args={[0.018, 8, 8]} />
            </mesh>
            <group position={[0, 0.06, 0]}>
              <Hair style={look.hairStyle} color={look.hair} />
            </group>
          </group>
          {/* Tay */}
          {(['L', 'R'] as const).map((side) => (
            <group key={side} ref={arms[side]} position={[side === 'L' ? -0.24 : 0.24, 0.48, 0]}>
              <mesh position={[0, -0.13, 0]} castShadow>
                <capsuleGeometry args={[0.055, 0.2, 4, 8]} />
                <meshStandardMaterial color={sleeve} roughness={0.75} />
              </mesh>
              <group ref={elbows[side]} position={[0, -0.27, 0]}>
                <mesh position={[0, -0.11, 0]} castShadow material={mats.skin}>
                  <capsuleGeometry args={[0.045, 0.18, 4, 8]} />
                </mesh>
                {side === 'R' && (
                  <>
                    <group ref={cue} position={[0, -0.24, 0]} visible={false}>
                      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.35]}>
                        <cylinderGeometry args={[0.008, 0.016, 1.45, 8]} />
                        <meshStandardMaterial color="#C8A47A" />
                      </mesh>
                    </group>
                    <group ref={cup} position={[0, -0.24, 0.04]} visible={false}>
                      <mesh>
                        <cylinderGeometry args={[0.04, 0.035, 0.09, 12]} />
                        <meshStandardMaterial color="#F4F1EA" />
                      </mesh>
                    </group>
                  </>
                )}
              </group>
            </group>
          ))}
        </group>
        {/* Chân */}
        {(['L', 'R'] as const).map((side) => (
          <group key={side} ref={legs[side]} position={[side === 'L' ? -0.1 : 0.1, -0.04, 0]}>
            <mesh position={[0, -0.21, 0]} castShadow material={mats.pants}>
              <capsuleGeometry args={[0.07, 0.3, 4, 8]} />
            </mesh>
            <group ref={knees[side]} position={[0, -0.44, 0]}>
              <mesh position={[0, -0.2, 0]} castShadow material={mats.pants}>
                <capsuleGeometry args={[0.06, 0.3, 4, 8]} />
              </mesh>
              <mesh position={[0, -0.42, 0.05]} castShadow material={mats.shoe}>
                <boxGeometry args={[0.11, 0.07, 0.24]} />
              </mesh>
            </group>
          </group>
        ))}
      </group>
    </group>
  );
}

// ---------------- Hoạt ảnh ----------------

interface Target {
  hipY: number;
  torso: number;
  head: number;
  headY: number;
  armL: number;
  armR: number;
  armRz: number;
  elbowL: number;
  elbowR: number;
  legL: number;
  legR: number;
  kneeL: number;
  kneeR: number;
}

const STAND: Target = { hipY: 0.92, torso: 0, head: 0, headY: 0, armL: 0.05, armR: 0.05, armRz: 0, elbowL: -0.1, elbowR: -0.1, legL: 0, legR: 0, kneeL: 0, kneeR: 0 };

/** Tính tư thế mục tiêu tại thời điểm t. `walking` khi đang di chuyển. */
function target(pose: Pose | 'walk', t: number, seed: number, seatY = 0.48): Target {
  const s = { ...STAND };
  const breathe = Math.sin(t * 1.6 + seed) * 0.015;
  switch (pose) {
    case 'walk': {
      const ph = t * 7.5;
      const sw = Math.sin(ph);
      s.legL = sw * 0.55;
      s.legR = -sw * 0.55;
      s.kneeL = Math.max(0, -Math.sin(ph)) * 0.7;
      s.kneeR = Math.max(0, Math.sin(ph)) * 0.7;
      s.armL = -sw * 0.45;
      s.armR = sw * 0.45;
      s.hipY = 0.92 + Math.abs(Math.cos(ph)) * 0.03;
      s.torso = 0.05;
      break;
    }
    case 'sit':
    case 'type': {
      s.hipY = seatY + 0.12;
      s.legL = s.legR = -Math.PI / 2;
      s.kneeL = s.kneeR = Math.PI / 2;
      s.torso = 0.08 + breathe;
      if (pose === 'type') {
        s.armL = -0.95 + Math.sin(t * 13 + seed) * 0.06;
        s.armR = -0.95 + Math.cos(t * 12 + seed) * 0.06;
        s.elbowL = s.elbowR = -0.75;
        s.head = 0.12 + Math.sin(t * 0.7 + seed) * 0.04;
        s.headY = Math.sin(t * 0.4 + seed) * 0.15;
      } else {
        s.armL = s.armR = -0.55;
        s.elbowL = s.elbowR = -0.9;
        s.headY = Math.sin(t * 0.5 + seed) * 0.5;
      }
      break;
    }
    case 'lounge': {
      s.hipY = seatY + 0.1;
      s.legL = -1.15;
      s.legR = -1.25;
      s.kneeL = s.kneeR = 1.0;
      s.torso = -0.45;
      s.armL = s.armR = 0.25;
      s.elbowL = s.elbowR = -0.6;
      s.head = 0.3;
      s.headY = Math.sin(t * 0.3 + seed) * 0.4;
      break;
    }
    case 'present': {
      s.armR = -2.1 + Math.sin(t * 2.2 + seed) * 0.25;
      s.armRz = -0.2;
      s.elbowR = -0.4;
      s.armL = -0.3 + Math.sin(t * 1.4) * 0.1;
      s.elbowL = -0.6;
      s.headY = Math.sin(t * 0.8 + seed) * 0.35;
      s.torso = breathe;
      break;
    }
    case 'talk': {
      s.armL = -0.4 + Math.sin(t * 2.6 + seed) * 0.25;
      s.armR = -0.3 + Math.cos(t * 2.1 + seed) * 0.3;
      s.elbowL = s.elbowR = -0.7;
      s.headY = Math.sin(t * 1.1 + seed) * 0.2;
      s.torso = breathe;
      break;
    }
    case 'billiards': {
      // Cúi người ngắm, tay phải đẩy cơ theo nhịp
      const cycle = (t * 0.45 + seed) % 1;
      const aiming = cycle < 0.7;
      const stroke = aiming ? Math.sin(cycle * 20) * 0.12 : -0.35 * Math.sin(((cycle - 0.7) / 0.3) * Math.PI);
      s.torso = aiming ? 0.95 : 0.55;
      s.legL = 0.25;
      s.legR = -0.35;
      s.armL = -1.45;
      s.elbowL = -0.15;
      s.armR = -0.75 + stroke;
      s.elbowR = -1.25 - stroke;
      s.head = aiming ? -0.75 : -0.4;
      break;
    }
    case 'foosball': {
      s.torso = 0.25;
      s.armL = -1.15 + Math.sin(t * 9 + seed) * 0.12;
      s.armR = -1.15 + Math.cos(t * 9.5 + seed) * 0.12;
      s.elbowL = s.elbowR = -0.35;
      s.legL = 0.12;
      s.legR = -0.12;
      s.head = 0.25;
      break;
    }
    case 'press': {
      // Giơ tay phải bấm nút gọi thang máy
      s.armR = -1.35 + Math.sin(t * 6 + seed) * 0.05;
      s.elbowR = -0.35;
      s.armL = 0.05;
      s.head = 0.05;
      break;
    }
    case 'drink': {
      const sip = Math.max(0, Math.sin(t * 0.9 + seed));
      s.armR = -0.6 - sip * 1.1;
      s.elbowR = -1.2 - sip * 0.8;
      s.head = -sip * 0.15;
      s.headY = Math.sin(t * 0.5 + seed) * 0.3;
      s.armL = 0.05;
      break;
    }
    default: {
      s.torso = breathe;
      s.headY = Math.sin(t * 0.35 + seed) * 0.35;
    }
  }
  return s;
}

/** Áp tư thế lên khung xương (nội suy mượt). */
export function animateRig(rig: Rig, pose: Pose | 'walk', t: number, dt: number, seed: number, seatY?: number) {
  const g = target(pose, t, seed, seatY);
  const k = 1 - Math.exp(-dt * (pose === 'walk' ? 18 : 9));
  const lerp = (a: number, b: number) => a + (b - a) * k;
  rig.hips.position.y = lerp(rig.hips.position.y, g.hipY);
  rig.torso.rotation.x = lerp(rig.torso.rotation.x, g.torso);
  rig.head.rotation.x = lerp(rig.head.rotation.x, g.head);
  rig.head.rotation.y = lerp(rig.head.rotation.y, g.headY);
  rig.armL.rotation.x = lerp(rig.armL.rotation.x, g.armL);
  rig.armR.rotation.x = lerp(rig.armR.rotation.x, g.armR);
  rig.armR.rotation.z = lerp(rig.armR.rotation.z, g.armRz);
  rig.elbowL.rotation.x = lerp(rig.elbowL.rotation.x, g.elbowL);
  rig.elbowR.rotation.x = lerp(rig.elbowR.rotation.x, g.elbowR);
  rig.legL.rotation.x = lerp(rig.legL.rotation.x, g.legL);
  rig.legR.rotation.x = lerp(rig.legR.rotation.x, g.legR);
  rig.kneeL.rotation.x = lerp(rig.kneeL.rotation.x, g.kneeL);
  rig.kneeR.rotation.x = lerp(rig.kneeR.rotation.x, g.kneeR);
  rig.cue.visible = pose === 'billiards';
  rig.cup.visible = pose === 'drink';
}

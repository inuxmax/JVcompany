'use client';
// Nội thất văn phòng low-poly: bàn, ghế, bàn họp, bi-da, bi-lắc, ghế lười, sofa, quầy cà phê, lễ tân, cây, vách kính…
import { useMemo } from 'react';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { localize } from '@/lib/i18n';
import { codeTexture, plaqueTexture, screenTexture, signTexture } from './textures';

/** Chữ vẽ lên bảng hiệu (dịch lúc đọc; trong các component bên dưới, `t` là bảng màu Theme). */
const SIGN_TEXT = localize({ reception: 'Công ty vận hành bởi AI Agent' });

export interface Theme {
  dark: boolean;
  wall: string;
  wallTrim: string;
  slab: string;
  deskTop: string;
  deskLeg: string;
  chair: string;
  monitor: string;
  glass: string;
  frame: string;
  wood: string;
  woodDark: string;
  pot: string;
  leaf: string[];
  sofa: string;
  counter: string;
  felt: string;
  ink: string;
  paper: string;
  window: string;
  grass: string;
}

export const LIGHT_THEME: Theme = {
  dark: false,
  wall: '#F4F0E8',
  wallTrim: '#E2D9CA',
  slab: '#CFC5B4',
  deskTop: '#FBF9F4',
  deskLeg: '#3A3632',
  chair: '#2F2B28',
  monitor: '#26231F',
  glass: '#DCE7EC',
  frame: '#8E8A84',
  wood: '#C8A47A',
  woodDark: '#8E6B49',
  pot: '#F4F1EA',
  leaf: ['#4E8A43', '#5E9C4F', '#3F7537'],
  sofa: '#6E6A64',
  counter: '#EFE7D8',
  felt: '#2F7A4A',
  ink: '#25211C',
  paper: '#FFFDF8',
  window: '#CFE3D6',
  grass: '#B7D3A0',
};

export const DARK_THEME: Theme = {
  dark: true,
  wall: '#3A352F',
  wallTrim: '#2C2823',
  slab: '#4A443D',
  deskTop: '#4A453F',
  deskLeg: '#161412',
  chair: '#1C1A18',
  monitor: '#121110',
  glass: '#6F8590',
  frame: '#5A554F',
  wood: '#7A5A3E',
  woodDark: '#523B27',
  pot: '#8E887E',
  leaf: ['#3F6E37', '#4B7D41', '#335C2D'],
  sofa: '#3E3A35',
  counter: '#4A433A',
  felt: '#245E39',
  ink: '#151310',
  paper: '#E9E1D2',
  window: '#3E5868',
  grass: '#34482D',
};

type V3 = [number, number, number];

export function Box({
  size,
  position,
  color,
  rotation,
  cast = true,
  receive = false,
  roughness = 0.8,
  metalness = 0,
  opacity,
}: {
  size: V3;
  position: V3;
  color: string;
  rotation?: V3;
  cast?: boolean;
  receive?: boolean;
  roughness?: number;
  metalness?: number;
  opacity?: number;
}) {
  return (
    <mesh position={position} rotation={rotation} castShadow={cast} receiveShadow={receive}>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        roughness={roughness}
        metalness={metalness}
        transparent={opacity !== undefined}
        opacity={opacity ?? 1}
        depthWrite={opacity === undefined}
      />
    </mesh>
  );
}

// ---------------- Bàn làm việc ----------------

export function Desk({
  x,
  z,
  w,
  d,
  t,
  working,
  color,
  laptop,
}: {
  x: number;
  z: number;
  w: number;
  d: number;
  t: Theme;
  working: boolean;
  color: string;
  laptop?: boolean;
}) {
  const screen = useMemo(() => codeTexture(color), [color]);
  return (
    <group position={[x, 0, z]}>
      <Box size={[w, 0.05, d]} position={[0, 0.74, 0]} color={t.deskTop} receive roughness={0.5} />
      {[-w / 2 + 0.05, w / 2 - 0.05].map((lx) => (
        <group key={lx}>
          <Box size={[0.05, 0.72, 0.05]} position={[lx, 0.36, -d / 2 + 0.08]} color={t.deskLeg} />
          <Box size={[0.05, 0.72, 0.05]} position={[lx, 0.36, d / 2 - 0.08]} color={t.deskLeg} />
          <Box size={[0.05, 0.04, d - 0.1]} position={[lx, 0.04, 0]} color={t.deskLeg} />
        </group>
      ))}
      {laptop ? (
        <group position={[0, 0.77, -0.05]}>
          <Box size={[0.42, 0.02, 0.3]} position={[0, 0, 0]} color="#B9B4AC" metalness={0.4} roughness={0.4} />
          <Box size={[0.42, 0.28, 0.015]} position={[0, 0.14, -0.15]} rotation={[-0.25, 0, 0]} color="#B9B4AC" metalness={0.4} roughness={0.4} />
        </group>
      ) : (
        <group position={[0, 0.77, 0.12]}>
          {/* Màn hình quay về phía người ngồi (−z) */}
          <Box size={[0.06, 0.2, 0.06]} position={[0, 0.1, 0.05]} color={t.monitor} />
          <Box size={[0.25, 0.015, 0.18]} position={[0, 0.008, 0.05]} color={t.monitor} />
          <Box size={[0.66, 0.4, 0.04]} position={[0, 0.38, 0]} color={t.monitor} roughness={0.4} />
          <mesh position={[0, 0.38, -0.021]} rotation={[0, Math.PI, 0]}>
            <planeGeometry args={[0.62, 0.36]} />
            <meshStandardMaterial
              map={working ? screen : null}
              color={working ? '#ffffff' : '#0d0d0f'}
              emissive={working ? '#ffffff' : '#000000'}
              emissiveMap={working ? screen : null}
              emissiveIntensity={working ? 0.7 : 0}
            />
          </mesh>
          {/* Đèn LED sau màn hình báo đang làm */}
          <mesh position={[0.28, 0.2, 0.025]}>
            <sphereGeometry args={[0.018, 8, 8]} />
            <meshStandardMaterial color={working ? color : '#444'} emissive={working ? color : '#000'} emissiveIntensity={working ? 2 : 0} />
          </mesh>
          <Box size={[0.42, 0.015, 0.14]} position={[0, 0.008, -0.22]} color="#E3DED6" />
        </group>
      )}
      {/* Cốc + cây nhỏ */}
      <mesh position={[w / 2 - 0.18, 0.81, -0.15]} castShadow>
        <cylinderGeometry args={[0.04, 0.035, 0.09, 12]} />
        <meshStandardMaterial color={color} roughness={0.5} />
      </mesh>
      <group position={[-w / 2 + 0.16, 0.77, 0.18]}>
        <mesh castShadow position={[0, 0.05, 0]}>
          <cylinderGeometry args={[0.05, 0.04, 0.1, 10]} />
          <meshStandardMaterial color={t.pot} />
        </mesh>
        <mesh castShadow position={[0, 0.15, 0]}>
          <icosahedronGeometry args={[0.07, 0]} />
          <meshStandardMaterial color={t.leaf[0]} flatShading />
        </mesh>
      </group>
    </group>
  );
}

export function OfficeChair({ x, z, facing, t, color }: { x: number; z: number; facing: number; t: Theme; color?: string }) {
  const c = color ?? t.chair;
  return (
    <group position={[x, 0, z]} rotation={[0, facing, 0]}>
      <Box size={[0.48, 0.07, 0.46]} position={[0, 0.46, 0]} color={c} />
      <Box size={[0.46, 0.5, 0.06]} position={[0, 0.78, -0.24]} color={c} />
      <mesh position={[0, 0.24, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 0.42, 8]} />
        <meshStandardMaterial color={t.deskLeg} metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.03, 0]}>
        <cylinderGeometry args={[0.26, 0.26, 0.03, 5]} />
        <meshStandardMaterial color={t.deskLeg} />
      </mesh>
    </group>
  );
}

// ---------------- Phòng họp ----------------

export function MeetingTable({ x, z, w, d, t }: { x: number; z: number; w: number; d: number; t: Theme }) {
  return (
    <group position={[x, 0, z]}>
      <RoundedBox args={[w, 0.06, d]} radius={0.03} position={[0, 0.75, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={t.wood} roughness={0.5} />
      </RoundedBox>
      <Box size={[w * 0.7, 0.7, 0.12]} position={[0, 0.37, 0]} color={t.woodDark} />
      {Array.from({ length: 4 }).map((_, i) => (
        <group key={i} position={[-w / 2 + 0.6 + i * 1.1, 0.79, 0]}>
          <Box size={[0.24, 0.01, 0.32]} position={[0, 0, -0.3]} color={t.paper} cast={false} />
          <Box size={[0.24, 0.01, 0.32]} position={[0, 0, 0.3]} color={t.paper} cast={false} />
        </group>
      ))}
    </group>
  );
}

export function PresentationScreen({ x, z, title }: { x: number; z: number; title: string }) {
  const tex = useMemo(() => screenTexture(title), [title]);
  return (
    <group position={[x, 0, z]} rotation={[0, -Math.PI / 2, 0]}>
      <Box size={[0.06, 1.2, 0.06]} position={[0, 0.6, 0]} color="#2a2724" />
      <Box size={[0.6, 0.04, 0.4]} position={[0, 0.02, 0]} color="#2a2724" />
      <Box size={[1.5, 0.9, 0.06]} position={[0, 1.55, 0]} color="#1a1816" />
      <mesh position={[0, 1.55, 0.032]}>
        <planeGeometry args={[1.42, 0.82]} />
        <meshStandardMaterial map={tex} emissive="#ffffff" emissiveMap={tex} emissiveIntensity={0.55} />
      </mesh>
    </group>
  );
}

// ---------------- Khu nghỉ ----------------

export function BilliardTable({ x, z, w, d, t }: { x: number; z: number; w: number; d: number; t: Theme }) {
  const balls = useMemo(() => {
    const colors = ['#F2C14E', '#2B59C3', '#C4483F', '#6B3FA0', '#E07A2F', '#2F7A4A', '#8B2C2C', '#111111', '#F7F3EA'];
    const out: { x: number; z: number; c: string }[] = [];
    let k = 0;
    for (let row = 0; row < 4; row++) {
      for (let i = 0; i <= row; i++) {
        out.push({ x: 0.45 + row * 0.07, z: (i - row / 2) * 0.075, c: colors[k++ % colors.length] });
      }
    }
    out.push({ x: -0.6, z: 0.05, c: '#F7F3EA' });
    return out;
  }, []);
  return (
    <group position={[x, 0, z]}>
      {[
        [-w / 2 + 0.15, -d / 2 + 0.15],
        [w / 2 - 0.15, -d / 2 + 0.15],
        [-w / 2 + 0.15, d / 2 - 0.15],
        [w / 2 - 0.15, d / 2 - 0.15],
      ].map(([lx, lz], i) => (
        <Box key={i} size={[0.16, 0.7, 0.16]} position={[lx, 0.35, lz]} color={t.woodDark} />
      ))}
      <Box size={[w, 0.16, d]} position={[0, 0.74, 0]} color={t.woodDark} roughness={0.5} />
      <Box size={[w - 0.22, 0.03, d - 0.22]} position={[0, 0.83, 0]} color={t.felt} roughness={0.95} cast={false} receive />
      {/* Băng mép */}
      <Box size={[w, 0.06, 0.11]} position={[0, 0.85, -d / 2 + 0.055]} color={t.woodDark} />
      <Box size={[w, 0.06, 0.11]} position={[0, 0.85, d / 2 - 0.055]} color={t.woodDark} />
      <Box size={[0.11, 0.06, d]} position={[-w / 2 + 0.055, 0.85, 0]} color={t.woodDark} />
      <Box size={[0.11, 0.06, d]} position={[w / 2 - 0.055, 0.85, 0]} color={t.woodDark} />
      {[-1, 0, 1].flatMap((ix) =>
        [-1, 1].map((iz) => (
          <mesh key={`${ix}${iz}`} position={[ix * (w / 2 - 0.12), 0.86, iz * (d / 2 - 0.12)]}>
            <cylinderGeometry args={[0.055, 0.055, 0.02, 12]} />
            <meshStandardMaterial color="#0c0c0c" />
          </mesh>
        )),
      )}
      {balls.map((b, i) => (
        <mesh key={i} position={[b.x, 0.875, b.z]} castShadow>
          <sphereGeometry args={[0.032, 12, 12]} />
          <meshStandardMaterial color={b.c} roughness={0.25} />
        </mesh>
      ))}
      {/* Đèn treo trên bàn */}
      <Box size={[1.6, 0.08, 0.3]} position={[0, 2.25, 0]} color="#1f2a24" />
      <mesh position={[0, 2.2, 0]}>
        <boxGeometry args={[1.5, 0.02, 0.24]} />
        <meshStandardMaterial color="#fff6dc" emissive="#fff1c8" emissiveIntensity={1.2} />
      </mesh>
    </group>
  );
}

export function Foosball({ x, z, w, d, t }: { x: number; z: number; w: number; d: number; t: Theme }) {
  return (
    <group position={[x, 0, z]}>
      {[
        [-w / 2 + 0.06, -d / 2 + 0.06],
        [w / 2 - 0.06, -d / 2 + 0.06],
        [-w / 2 + 0.06, d / 2 - 0.06],
        [w / 2 - 0.06, d / 2 - 0.06],
      ].map(([lx, lz], i) => (
        <Box key={i} size={[0.07, 0.75, 0.07]} position={[lx, 0.37, lz]} color={t.deskLeg} />
      ))}
      <Box size={[w, 0.2, d]} position={[0, 0.82, 0]} color={t.dark ? '#2b2b2b' : '#1d1d1d'} />
      <Box size={[w - 0.1, 0.02, d - 0.1]} position={[0, 0.92, 0]} color="#3c8a4f" cast={false} />
      {[-0.45, -0.15, 0.15, 0.45].map((rz, i) => (
        <group key={rz} position={[0, 0.98, rz]}>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.012, 0.012, w + 0.4, 6]} />
            <meshStandardMaterial color="#c9c9c9" metalness={0.8} roughness={0.3} />
          </mesh>
          {[-0.18, 0, 0.18].map((px) => (
            <Box key={px} size={[0.04, 0.12, 0.05]} position={[px, -0.02, 0]} color={i % 2 ? '#C4483F' : '#4A86BD'} />
          ))}
        </group>
      ))}
    </group>
  );
}

export function BeanBag({ x, z, color }: { x: number; z: number; color: string }) {
  return (
    <mesh position={[x, 0.2, z]} scale={[1, 0.62, 1]} castShadow receiveShadow>
      <sphereGeometry args={[0.42, 20, 14]} />
      <meshStandardMaterial color={color} roughness={0.85} />
    </mesh>
  );
}

export function Sofa({ x, z, w, d, facing, t, color }: { x: number; z: number; w: number; d: number; facing: number; t: Theme; color?: string }) {
  const c = color ?? t.sofa;
  // Mặc định sofa nhìn về −z (lưng ở +z) rồi xoay theo `facing` quanh trục y.
  const len = Math.max(w, d);
  return (
    <group position={[x, 0, z]} rotation={[0, facing + Math.PI, 0]}>
      <RoundedBox args={[len, 0.42, 0.85]} radius={0.06} position={[0, 0.21, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={c} roughness={0.9} />
      </RoundedBox>
      <RoundedBox args={[len, 0.5, 0.2]} radius={0.06} position={[0, 0.62, 0.33]} castShadow>
        <meshStandardMaterial color={c} roughness={0.9} />
      </RoundedBox>
      {[-len / 2 + 0.1, len / 2 - 0.1].map((ax) => (
        <RoundedBox key={ax} args={[0.2, 0.55, 0.85]} radius={0.06} position={[ax, 0.35, 0]} castShadow>
          <meshStandardMaterial color={c} roughness={0.9} />
        </RoundedBox>
      ))}
    </group>
  );
}

export function CoffeeCounter({ x, z, w, d, t }: { x: number; z: number; w: number; d: number; t: Theme }) {
  return (
    <group position={[x, 0, z]}>
      <Box size={[w, 0.95, d]} position={[0, 0.475, 0]} color={t.counter} receive />
      <Box size={[w + 0.06, 0.05, d + 0.06]} position={[0, 0.97, 0]} color={t.wood} />
      {/* Máy pha cà phê */}
      <Box size={[0.4, 0.42, 0.36]} position={[0.02, 1.2, -0.9]} color="#2b2826" metalness={0.4} roughness={0.35} />
      <Box size={[0.3, 0.06, 0.3]} position={[-0.1, 1.05, -0.9]} color="#9a9692" metalness={0.6} />
      {[-0.2, 0.1, 0.4, 0.7].map((cz, i) => (
        <mesh key={cz} position={[-0.05, 1.04, cz]} castShadow>
          <cylinderGeometry args={[0.045, 0.04, 0.09, 12]} />
          <meshStandardMaterial color={i % 2 ? '#F4F1EA' : '#C4532A'} />
        </mesh>
      ))}
      {/* Tủ lạnh */}
      <Box size={[0.65, 1.8, 0.7]} position={[0.02, 0.9, d / 2 + 0.4]} color={t.dark ? '#55504a' : '#d9d5ce'} metalness={0.3} roughness={0.4} />
      {/* Bảng menu */}
      <Box size={[0.04, 0.7, 1.2]} position={[w / 2 - 0.02, 1.85, 0]} color="#1f1c19" />
    </group>
  );
}

export function ReceptionDesk({
  wall,
  counter,
  t,
  title,
}: {
  wall: { x: number; z: number; w: number; d: number };
  counter: { x: number; z: number; w: number; d: number };
  t: Theme;
  title: string;
}) {
  const sign = useMemo(() => signTexture(title, SIGN_TEXT.reception, t.dark), [title, t.dark]);
  const slats = Math.floor(wall.w / 0.16);
  return (
    <group>
      {/* Tường gỗ phía sau */}
      <group position={[wall.x, 0, wall.z]}>
        <Box size={[wall.w, 2.5, 0.14]} position={[0, 1.25, 0]} color={t.woodDark} />
        {Array.from({ length: slats }).map((_, i) => (
          <Box key={i} size={[0.08, 2.5, 0.06]} position={[-wall.w / 2 + 0.1 + i * 0.16, 1.25, 0.09]} color={t.wood} cast={false} />
        ))}
        <mesh position={[0, 1.55, 0.14]}>
          <planeGeometry args={[2.6, 0.98]} />
          <meshStandardMaterial map={sign} />
        </mesh>
      </group>
      {/* Quầy */}
      <group position={[counter.x, 0, counter.z]}>
        <RoundedBox args={[counter.w, 1.05, counter.d]} radius={0.04} position={[0, 0.525, 0]} castShadow receiveShadow>
          <meshStandardMaterial color={t.paper} roughness={0.6} />
        </RoundedBox>
        <Box size={[counter.w + 0.1, 0.05, counter.d + 0.15]} position={[0, 1.08, 0]} color={t.wood} />
        <Box size={[counter.w * 0.9, 0.18, 0.02]} position={[0, 0.7, counter.d / 2 + 0.01]} color="#C4532A" cast={false} />
        <Box size={[0.5, 0.32, 0.04]} position={[0.6, 1.28, -0.1]} color={t.monitor} />
      </group>
    </group>
  );
}

// ---------------- Cây xanh & tường cây ----------------

export function Plant({ x, z, s = 1, t }: { x: number; z: number; s?: number; t: Theme }) {
  return (
    <group position={[x, 0, z]} scale={s}>
      <mesh castShadow receiveShadow position={[0, 0.25, 0]}>
        <cylinderGeometry args={[0.24, 0.19, 0.5, 18]} />
        <meshStandardMaterial color={t.pot} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.65, 0]}>
        <cylinderGeometry args={[0.03, 0.04, 0.4, 6]} />
        <meshStandardMaterial color={t.woodDark} />
      </mesh>
      {[
        [0, 1.05, 0, 0.42],
        [0.2, 0.95, 0.1, 0.28],
        [-0.18, 1.0, -0.08, 0.3],
        [0.05, 1.3, -0.05, 0.26],
      ].map(([px, py, pz, r], i) => (
        <mesh key={i} castShadow position={[px, py, pz]}>
          <icosahedronGeometry args={[r, 1]} />
          <meshStandardMaterial color={t.leaf[i % t.leaf.length]} roughness={0.9} flatShading />
        </mesh>
      ))}
    </group>
  );
}

export function MossWall({ x, z, w, h, t, rotationY = 0 }: { x: number; z: number; w: number; h: number; t: Theme; rotationY?: number }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = t.leaf[2];
    g.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = t.leaf[i % 3];
      g.globalAlpha = 0.7;
      g.beginPath();
      g.arc((i * 73) % 256, (i * 41) % 128, 2 + ((i * 7) % 5), 0, Math.PI * 2);
      g.fill();
    }
    const tx = new THREE.CanvasTexture(c);
    tx.colorSpace = THREE.SRGBColorSpace;
    return tx;
  }, [t.leaf]);
  return (
    <group position={[x, 0, z]} rotation={[0, rotationY, 0]}>
      <Box size={[w + 0.16, h + 0.16, 0.08]} position={[0, 0.3 + h / 2, 0]} color={t.woodDark} />
      <mesh position={[0, 0.3 + h / 2, 0.045]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial map={tex} roughness={1} />
      </mesh>
    </group>
  );
}

// ---------------- Vách kính ----------------

export function GlassWall({ x0, z0, x1, z1, h, t }: { x0: number; z0: number; x1: number; z1: number; h: number; t: Theme }) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const angle = Math.atan2(-(z1 - z0), x1 - x0);
  return (
    <group position={[(x0 + x1) / 2, 0, (z0 + z1) / 2]} rotation={[0, angle, 0]}>
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[len, h, 0.03]} />
        <meshStandardMaterial color={t.glass} transparent opacity={t.dark ? 0.18 : 0.26} roughness={0.05} metalness={0.1} depthWrite={false} />
      </mesh>
      <Box size={[len, 0.05, 0.06]} position={[0, h, 0]} color={t.frame} />
      <Box size={[len, 0.06, 0.06]} position={[0, 0.03, 0]} color={t.frame} />
      <Box size={[0.05, h, 0.06]} position={[-len / 2, h / 2, 0]} color={t.frame} />
      <Box size={[0.05, h, 0.06]} position={[len / 2, h / 2, 0]} color={t.frame} />
      {len > 2.5 && <Box size={[0.03, h, 0.05]} position={[0, h / 2, 0]} color={t.frame} cast={false} />}
    </group>
  );
}

// ---------------- Biển tên trên sàn ----------------

export function FloorPlaque({ x, z, w, text, sub, color }: { x: number; z: number; w: number; text: string; sub?: string; color?: string }) {
  const tex = useMemo(() => plaqueTexture(text, sub, color), [text, sub, color]);
  return (
    <mesh position={[x, 0.012, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[w, w / 4]} />
      <meshStandardMaterial map={tex} transparent roughness={0.8} />
    </mesh>
  );
}

// ---------------- Thang máy ----------------

export function ElevatorDoor({ z, w, open, t, floorLabel }: { z: number; w: number; open: number; t: Theme; floorLabel: string }) {
  const sign = useMemo(() => plaqueTexture(floorLabel, undefined, '#E0B44A'), [floorLabel]);
  const half = w / 2;
  return (
    <group position={[0, 0, z]} rotation={[0, Math.PI / 2, 0]}>
      {/* Khung thép */}
      <Box size={[w + 0.3, 2.6, 0.08]} position={[0, 1.3, -0.02]} color="#8f8b86" metalness={0.6} roughness={0.35} />
      {/* Lòng cabin tối phía sau */}
      <Box size={[w, 2.35, 0.02]} position={[0, 1.18, 0.0]} color="#1b1a19" cast={false} />
      {/* Hai cánh cửa trượt */}
      <mesh name="doorL" position={[-half / 2 - open * half * 0.95, 1.18, 0.04]} castShadow>
        <boxGeometry args={[half, 2.35, 0.04]} />
        <meshStandardMaterial color="#d6d2cc" metalness={0.7} roughness={0.25} />
      </mesh>
      <mesh name="doorR" position={[half / 2 + open * half * 0.95, 1.18, 0.04]} castShadow>
        <boxGeometry args={[half, 2.35, 0.04]} />
        <meshStandardMaterial color="#d6d2cc" metalness={0.7} roughness={0.25} />
      </mesh>
      <mesh position={[0, 2.75, 0.03]}>
        <planeGeometry args={[1.0, 0.25]} />
        <meshStandardMaterial map={sign} transparent />
      </mesh>
      <Box size={[0.08, 0.16, 0.03]} position={[half + 0.3, 1.2, 0.03]} color={t.ink} />
    </group>
  );
}

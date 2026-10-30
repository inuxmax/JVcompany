// Texture vẽ bằng canvas (không tải ảnh/font ngoài): sàn, biển tên khu, bảng hiệu, màn hình.
import * as THREE from 'three';

const cache = new Map<string, THREE.Texture>();

function fontFamily() {
  if (typeof document === 'undefined') return 'sans-serif';
  const v = getComputedStyle(document.documentElement).getPropertyValue('--font-sans-family').trim();
  return v ? `${v}, "Segoe UI", sans-serif` : '"Segoe UI", sans-serif';
}

function make(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  cache.set(key, tex);
  return tex;
}

/** Sàn gạch lớn màu xám ấm. */
export function floorTexture(dark: boolean, w: number, d: number) {
  return make(
    `floor-${dark}`,
    512,
    512,
    (g) => {
      g.fillStyle = dark ? '#2b2824' : '#e9e5de';
      g.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
          g.fillStyle = dark ? (i + j) % 2 ? '#2e2a26' : '#2a2723' : (i + j) % 2 ? '#ebe7e0' : '#e6e2db';
          g.fillRect(i * 256 + 2, j * 256 + 2, 252, 252);
        }
      }
      g.strokeStyle = dark ? 'rgba(0,0,0,0.45)' : 'rgba(120,105,85,0.18)';
      g.lineWidth = 3;
      for (let k = 0; k <= 512; k += 256) {
        g.beginPath();
        g.moveTo(k, 0);
        g.lineTo(k, 512);
        g.moveTo(0, k);
        g.lineTo(512, k);
        g.stroke();
      }
    },
    [w / 2.4, d / 2.4],
  );
}

/** Biển tên khu nằm trên sàn: nền mực, chữ vàng (giống bảng chỉ dẫn văn phòng thật). */
export function plaqueTexture(text: string, sub?: string, color = '#E0B44A') {
  return make(`plaque-${text}-${sub}-${color}`, 1024, 256, (g) => {
    g.clearRect(0, 0, 1024, 256);
    g.fillStyle = '#25211c';
    roundRect(g, 8, 8, 1008, 240, 60);
    g.fill();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = color;
    if (sub) {
      g.font = `800 92px ${fontFamily()}`;
      g.fillText(text, 512, 92, 940);
      g.font = `700 64px ${fontFamily()}`;
      g.fillStyle = '#F3E6C8';
      g.fillText(sub.toUpperCase(), 512, 178, 940);
    } else {
      g.font = `800 104px ${fontFamily()}`;
      g.fillText(text, 512, 132, 940);
    }
  });
}

/** Bảng hiệu thương hiệu ở sảnh/tường cây. */
export function signTexture(title: string, sub: string, dark = false) {
  return make(`sign-${title}-${sub}-${dark}`, 1024, 384, (g) => {
    g.fillStyle = dark ? '#1f1c19' : '#fffdf8';
    g.fillRect(0, 0, 1024, 384);
    g.fillStyle = '#C4532A';
    g.fillRect(64, 92, 26, 26);
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = dark ? '#eee7da' : '#1f1a14';
    g.font = `800 120px ${fontFamily()}`;
    g.fillText(title, 110, 200, 860);
    g.font = `600 52px ${fontFamily()}`;
    g.fillStyle = dark ? '#a89f91' : '#6b6255';
    g.fillText(sub, 112, 290, 860);
  });
}

/** Màn hình trình chiếu phòng họp: biểu đồ đơn giản. */
export function screenTexture(title: string) {
  return make(`screen-${title}`, 512, 288, (g) => {
    g.fillStyle = '#1b2430';
    g.fillRect(0, 0, 512, 288);
    g.fillStyle = '#E0B44A';
    g.font = `700 30px ${fontFamily()}`;
    g.fillText(title, 24, 46, 460);
    const bars = [0.4, 0.65, 0.5, 0.85, 0.7, 0.95];
    bars.forEach((b, i) => {
      g.fillStyle = i % 2 ? '#5C9A68' : '#4A86BD';
      g.fillRect(40 + i * 72, 260 - b * 170, 44, b * 170);
    });
  });
}

/** Mặt trước màn hình máy tính (đang làm việc: các dòng code). */
export function codeTexture(color: string) {
  return make(`code-${color}`, 256, 160, (g) => {
    g.fillStyle = '#16181d';
    g.fillRect(0, 0, 256, 160);
    for (let i = 0; i < 9; i++) {
      g.fillStyle = i % 3 === 0 ? color : i % 3 === 1 ? '#9fb3c8' : '#5C9A68';
      g.fillRect(16 + (i % 4) * 10, 14 + i * 16, 60 + ((i * 37) % 140), 7);
    }
  });
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

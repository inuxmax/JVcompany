'use client';
// Cửa thang máy phủ lên khung 3D khi chuyển tầng: đóng lại, bảng số đếm tầng, rồi mở ra ở tầng mới.
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { tc } from '@/lib/i18n';

export const DOOR_MS = 460;
const STEP_MS = 230;

/** Thời gian cabin chạy giữa hai tầng (0 = tầng trệt / toà nhà). */
export function travelMs(from: number, to: number): number {
  return Math.min(1300, Math.max(520, Math.abs(to - from) * STEP_MS + 200));
}

/** Số tầng trên bảng thang máy; tầng trệt là "T" (Trệt). */
const levelText = (n: number) => (n === 0 ? tc('level', 'T') : String(n));

function Panel({ side, closed, dark }: { side: 'left' | 'right'; closed: boolean; dark: boolean }) {
  const metal = dark
    ? 'linear-gradient(90deg, #3b352e 0%, #4b443b 45%, #3f3932 100%)'
    : 'linear-gradient(90deg, #cfc6b8 0%, #e6dfd4 45%, #d2c9bc 100%)';
  const brush = 'repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 2px, rgba(0,0,0,0.035) 2px 4px)';
  return (
    <div
      className="absolute inset-y-0 w-1/2 ease-[cubic-bezier(0.7,0,0.3,1)]"
      style={{
        [side]: 0,
        background: `${brush}, ${metal}`,
        transform: closed ? 'translateX(0)' : `translateX(${side === 'left' ? '-101%' : '101%'})`,
        transitionProperty: 'transform',
        transitionDuration: `${DOOR_MS}ms`,
        boxShadow: side === 'left' ? 'inset -1px 0 0 rgba(0,0,0,0.35), inset -8px 0 18px -10px rgba(0,0,0,0.35)' : 'inset 1px 0 0 rgba(255,255,255,0.25), inset 8px 0 18px -10px rgba(0,0,0,0.3)',
      }}
    />
  );
}

/** `closed`: cửa đang đóng (hoặc đóng hẳn). Bảng số đếm từ `from` tới `to` sau khi cửa đóng. */
export function ElevatorDoors({ closed, from, to, title, subtitle, dark }: { closed: boolean; from: number; to: number; title: string; subtitle?: string; dark: boolean }) {
  const [shown, setShown] = useState(from);
  useEffect(() => {
    if (!closed || from === to) return;
    let cur = from;
    let iv = 0;
    const start = window.setTimeout(() => {
      const step = Math.min(STEP_MS, Math.max(120, (travelMs(from, to) - 200) / Math.abs(to - from)));
      iv = window.setInterval(() => {
        cur += Math.sign(to - cur);
        setShown(cur);
        if (cur === to) window.clearInterval(iv);
      }, step);
    }, DOOR_MS * 0.7);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(iv);
    };
  }, [closed, from, to]);

  const moving = closed && shown !== to;
  const Arrow = to >= from ? ChevronUp : ChevronDown;
  return (
    <div className={clsx('absolute inset-0 z-20 overflow-hidden', closed ? 'pointer-events-auto' : 'pointer-events-none')} aria-hidden={!closed}>
      <Panel side="left" closed={closed} dark={dark} />
      <Panel side="right" closed={closed} dark={dark} />
      <div
        className={clsx(
          'absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 transition-opacity duration-300',
          closed ? 'opacity-100 delay-200' : 'opacity-0',
        )}
        role="status"
      >
        <div className="flex items-center gap-3 rounded-2xl bg-[#25211c] px-5 py-3 shadow-xl ring-1 ring-black/25">
          <Arrow className={clsx('size-7 text-[#E0B44A]', moving ? 'animate-vp-pulse' : 'opacity-30')} strokeWidth={2.5} />
          <span className={clsx('min-w-[1.6ch] text-center font-mono text-[44px] leading-none font-semibold text-[#E0B44A] tabular-nums', !moving && closed && 'drop-shadow-[0_0_10px_rgba(224,180,74,0.7)]')}>
            {levelText(shown)}
          </span>
        </div>
        <div className="rounded-full bg-[var(--surface-solid)]/90 px-3.5 py-1.5 text-center shadow-md ring-1 ring-black/5">
          <div className="text-[13px] font-semibold text-fg">{title}</div>
          {subtitle && <div className="max-w-[260px] truncate text-[11.5px] text-muted">{subtitle}</div>}
        </div>
      </div>
    </div>
  );
}

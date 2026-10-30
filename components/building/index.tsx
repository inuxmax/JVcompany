'use client';
// Toà nhà công ty AI 5 tầng (three.js): cảnh toàn nhà + cảnh chi tiết từng tầng với nhân viên tự đi lại.
// Chuyển tầng như đi thang máy thật: bạn (CEO) ra bấm thang máy → cửa đóng → bảng số đếm tầng → cửa mở ở tầng mới.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import clsx from 'clsx';
import { Building2, Crown, UserRound } from 'lucide-react';
import { PHASE_STATE } from '@/lib/catalog';
import { t, tc } from '@/lib/i18n';
import { DARK_THEME, LIGHT_THEME } from './props';
import { SceneLights } from './office-lights';
import { FD, FW } from './layout';
import { FloorScene, floorAgents, type LabelHandle } from './floor-scene';
import { LEVELS, LEVEL_H, TowerScene, type TowerLabel, type TowerRide } from './tower-scene';
import { FitCamera, useDarkTheme, useReducedMotion, type BuildingData, type CameraIntro } from './shared';
import { DOOR_MS, ElevatorDoors, travelMs } from './elevator-doors';
import { useLiveEvent } from '@/lib/client/live';
import useSWR from 'swr';
import type { LiveFeed } from './floor-scene';

export type BuildingViewMode = 'tower' | number;

function FirstFrame({ onReady }: { onReady: () => void }) {
  const done = useRef(false);
  useFrame(() => {
    if (done.current) return;
    done.current = true;
    requestAnimationFrame(onReady);
  });
  return null;
}

// Khung mặc định hơi gần (như ảnh chụp văn phòng); cuộn chuột để xem toàn tầng.
const FLOOR_BOX = new THREE.Box3(new THREE.Vector3(-FW / 2 + 1, 0, -FD / 2 + 1.2), new THREE.Vector3(FW / 2 - 2, 2.0, FD / 2 - 0.8));
const FLOOR_DIR = new THREE.Vector3(0.3, 1.1, 1);
const FLOOR_TARGET = new THREE.Vector3(0, 0, 0.6);
// Cận cảnh sảnh thang máy (khi bạn rời tầng / vừa tới tầng)
const LIFT_BOX = new THREE.Box3(new THREE.Vector3(-15.5, 0, -6.8), new THREE.Vector3(-10, 2.4, -0.8));
const LIFT_TARGET = new THREE.Vector3(-13.4, 0.9, -3.6);
const FLOOR_INTRO: CameraIntro = { target: LIFT_TARGET, scale: 0.32, ms: 2400 };
const TOWER_BOX = new THREE.Box3(new THREE.Vector3(-FW / 2 - 3, -0.4, -FD / 2), new THREE.Vector3(FW / 2 + 9, LEVELS * LEVEL_H + 4, FD / 2));
// Nhìn từ trước-trái để thấy trục thang máy kính (bên trái toà nhà).
const TOWER_DIR = new THREE.Vector3(-0.85, 0.6, 1.4);
const TOWER_TARGET = new THREE.Vector3(0, (LEVELS * LEVEL_H) / 2, 0);
const TOWER_INTRO: CameraIntro = { dir: new THREE.Vector3(-0.35, 0.75, 1.5), scale: 1.3, ms: 1600 };

/** Thời gian camera bay vào một tầng ở cảnh toà nhà (cabin chở bạn lên cùng lúc). */
const FOCUS_MS = 1300;
/** Dự phòng nếu không nhận được tín hiệu bạn đã vào thang máy. */
const DEPART_TIMEOUT_MS = 9000;

type Phase = 'idle' | 'focus' | 'depart' | 'closing' | 'opening';
/** Một chuyến thang máy: tầng đi/đến (0 = tầng trệt / toà nhà). `enter`: chỉ bay vào rồi báo ra ngoài (trang tổng quan). */
interface Trip {
  id: number;
  from: number;
  to: number;
  enter?: boolean;
}

const levelOf = (v: BuildingViewMode) => (v === 'tower' ? 0 : v);

function levelFit(lv: number) {
  return {
    box: new THREE.Box3(new THREE.Vector3(-FW / 2, lv * LEVEL_H - 0.3, -FD / 2), new THREE.Vector3(FW / 2, lv * LEVEL_H + 2.6, FD / 2)),
    dir: new THREE.Vector3(0.35, 0.95, 1.2),
    target: new THREE.Vector3(0, lv * LEVEL_H + 0.8, 0.4),
    margin: 0.95,
  };
}

const TOWER_FIT = { box: TOWER_BOX, dir: TOWER_DIR, target: TOWER_TARGET, margin: 0.92 };
const FLOOR_FIT = { box: FLOOR_BOX, dir: FLOOR_DIR, target: FLOOR_TARGET, margin: 0.95 };
const LIFT_FIT = { box: LIFT_BOX, dir: FLOOR_DIR, target: LIFT_TARGET, margin: 0.9 };

export default function BuildingView({
  data,
  view,
  onViewChange,
  onEnterFloor,
  onSelectDept,
  onSelectMe,
  presentUntil = 0,
  className,
  showSelector = true,
}: {
  data: BuildingData;
  view: BuildingViewMode;
  onViewChange: (v: BuildingViewMode) => void;
  /** Có thì bấm một tầng ở cảnh toà nhà chỉ bay vào rồi gọi hàm này (vd chuyển sang trang Toà nhà). */
  onEnterFloor?: (n: number) => void;
  onSelectDept?: (deptId: string) => void;
  /** Bấm vào nhân vật của bạn (CEO). */
  onSelectMe?: () => void;
  /** Bạn đang giao việc: đứng ở phòng họp tới thời điểm này. */
  presentUntil?: number;
  className?: string;
  showSelector?: boolean;
}) {
  const dark = useDarkTheme();
  const reduced = useReducedMotion();
  const theme = dark ? DARK_THEME : LIGHT_THEME;
  const [ready, setReady] = useState(false);
  const [compact, setCompact] = useState(false);
  const [hoverLevel, setHoverLevel] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const agentLabels = useRef(new Map<string, LabelHandle>());
  // Tên công ty trên bảng hiệu toà nhà / quầy lễ tân
  const { data: company } = useSWR<{ name: string }>('/api/company', { revalidateOnFocus: false });
  // Việc AI đang làm theo thời gian thực (chữ đang viết / thao tác vừa làm) theo từng phòng
  const liveFeed = useRef<LiveFeed>(new Map());
  useLiveEvent((ev) => {
    if ((ev.type !== 'task.live' && ev.type !== 'task.activity') || !ev.projectId) return;
    const d = ev.data as { departmentId: string; text: string | null };
    const cur = liveFeed.current.get(d.departmentId);
    const next = { projectId: ev.projectId, text: cur?.text ?? null, textAt: cur?.textAt ?? 0, tool: cur?.tool ?? null, toolAt: cur?.toolAt ?? 0 };
    if (ev.type === 'task.live') {
      next.text = d.text;
      next.textAt = Date.now();
    } else {
      next.tool = d.text;
      next.toolAt = Date.now();
    }
    liveFeed.current.set(d.departmentId, next);
  });
  const levelLabels = useRef(new Map<string, TowerLabel>());

  // ---- Chuyển tầng: cảnh đang hiển thị (`shown`) đi theo tầng được chọn (`view`) qua một chuyến thang máy ----
  const [shown, setShown] = useState<BuildingViewMode>(view);
  const [phase, setPhase] = useState<Phase>('idle');
  const [trip, setTrip] = useState<Trip | null>(null);
  if (view !== shown && phase === 'idle') {
    if (reduced) setShown(view);
    else {
      setTrip({ id: (trip?.id ?? 0) + 1, from: levelOf(shown), to: levelOf(view) });
      setPhase(shown === 'tower' ? 'focus' : 'depart');
    }
  }
  // Đổi đích giữa chừng (bấm tầng khác khi thang máy chưa tới)
  if (trip && !trip.enter && (phase === 'focus' || phase === 'depart' || phase === 'closing') && trip.to !== levelOf(view)) {
    setTrip({ ...trip, to: levelOf(view) });
  }

  const latest = useRef({ view, onEnterFloor });
  useEffect(() => {
    latest.current = { view, onEnterFloor };
  });
  useEffect(() => {
    if (phase === 'idle' || !trip) return;
    let ms = 0;
    let next = () => {};
    if (phase === 'focus') {
      ms = FOCUS_MS;
      next = () => (trip.enter ? latest.current.onEnterFloor?.(trip.to) : setPhase('closing'));
    } else if (phase === 'depart') {
      ms = DEPART_TIMEOUT_MS;
      next = () => setPhase('closing');
    } else if (phase === 'closing') {
      ms = DOOR_MS + travelMs(trip.from, trip.to) + 250;
      next = () => {
        setShown(latest.current.view);
        setPhase('opening');
      };
    } else {
      ms = DOOR_MS + 250;
      next = () => setPhase('idle');
    }
    const id = window.setTimeout(next, ms);
    return () => window.clearTimeout(id);
  }, [phase, trip]);
  const onDeparted = useCallback(() => setPhase((p) => (p === 'depart' ? 'closing' : p)), []);

  /** Bấm một tầng ở cảnh toà nhà. */
  const pickLevel = (n: number) => {
    setHoverLevel(null);
    if (onEnterFloor && !reduced) {
      if (phase !== 'idle') return;
      setTrip({ id: (trip?.id ?? 0) + 1, from: 0, to: n, enter: true });
      setPhase('focus');
    } else if (onEnterFloor) onEnterFloor(n);
    else onViewChange(n);
  };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setCompact(e.contentRect.width < 640));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    document.body.style.cursor = hoverLevel !== null ? 'pointer' : '';
    return () => {
      document.body.style.cursor = '';
    };
  }, [hoverLevel]);

  const floor = typeof shown === 'number' ? (data.floors.find((f) => f.number === shown) ?? null) : null;
  const agents = useMemo(() => (floor ? floorAgents(floor, data.departments) : []), [floor, data.departments]);
  const mode = floor ? `floor-${floor.number}` : 'tower';

  // Camera & hiệu ứng theo giai đoạn chuyến đi
  const travelling = phase !== 'idle';
  const towerFocus = !floor && trip && trip.to > 0 && (phase === 'focus' || phase === 'closing') ? trip.to : null;
  const towerFit = useMemo(() => (towerFocus === null ? TOWER_FIT : levelFit(towerFocus)), [towerFocus]);
  const towerIntro: CameraIntro | undefined = reduced ? undefined : trip && trip.from > 0 && trip.to === 0 ? { target: levelFit(trip.from).target, scale: 0.45, ms: 1800 } : TOWER_INTRO;
  const ride: TowerRide | null = floor || !trip ? null : towerFocus !== null ? { from: trip.from, to: trip.to, ms: FOCUS_MS } : trip.to === 0 && trip.from > 0 ? { from: trip.from, to: 0, ms: 1800 } : null;
  const leaving = Boolean(floor) && (phase === 'depart' || phase === 'closing');
  const floorFit = leaving ? LIFT_FIT : FLOOR_FIT;
  const doors = trip && (phase === 'closing' || phase === 'opening') ? trip : null;
  const doorFloor = doors && doors.to > 0 ? data.floors.find((f) => f.number === doors.to) : null;

  // Hàm chọn nhân vật giữ nguyên giữa các lần vẽ (để nhân vật 3D không bị vẽ lại khi dữ liệu cập nhật)
  const selectImpl = useRef<(agentId: string) => void>(() => {});
  useEffect(() => {
    selectImpl.current = (agentId: string) => {
      if (agentId === '__me') return onSelectMe?.();
      const a = agents.find((x) => x.id === agentId);
      if (a?.deptId) onSelectDept?.(a.deptId);
    };
  });
  const select = useCallback((agentId: string) => selectImpl.current(agentId), []);

  return (
    <div ref={box} className={clsx('relative isolate w-full overflow-hidden', className)}>
      <Canvas shadows dpr={[1, 1.75]} camera={{ position: [40, 40, 40], fov: 32, near: 0.5, far: 400 }} gl={{ antialias: true, alpha: true }}>
        {/* Trời, môi trường, mặt trời – đổi giao diện thì chuyển dần ngày ↔ đêm */}
        <SceneLights dark={dark} />
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          enablePan={mode !== 'tower'}
          screenSpacePanning={false}
          minPolarAngle={0.25}
          maxPolarAngle={1.25}
          minDistance={8}
          maxDistance={160}
          rotateSpeed={0.55}
        />
        {floor ? (
          <>
            <FitCamera key={`cam-${mode}`} {...floorFit} intro={reduced ? undefined : FLOOR_INTRO} tweenMs={reduced ? undefined : 1300} />
            <FloorScene
              key={`scene-${mode}`}
              floor={floor}
              floors={data.floors}
              departments={data.departments}
              workflows={data.workflows}
              theme={theme}
              labels={agentLabels}
              liveFeed={liveFeed}
              onSelect={select}
              leaving={leaving}
              onDeparted={onDeparted}
              presentUntil={presentUntil}
              intro={!reduced}
              companyName={company?.name}
            />
          </>
        ) : (
          <>
            <FitCamera key={`cam-${mode}`} {...towerFit} intro={towerIntro} tweenMs={reduced ? undefined : 1100} />
            <TowerScene
              floors={data.floors}
              departments={data.departments}
              theme={theme}
              labels={levelLabels}
              hover={hoverLevel}
              setHover={setHoverLevel}
              onPick={pickLevel}
              focus={towerFocus}
              ride={ride}
              companyName={company?.name}
            />
          </>
        )}
        <FirstFrame onReady={() => setReady(true)} />
      </Canvas>

      {/* Lớp chờ */}
      <div className={clsx('pointer-events-none absolute inset-0 flex items-center justify-center bg-surface transition-opacity duration-500', ready ? 'opacity-0' : 'opacity-100')}>
        <span className="animate-vp-pulse text-[13px] text-muted">{t('Đang dựng toà nhà…')}</span>
      </div>

      {/* Nhãn nhân vật (cảnh tầng) */}
      {floor && (
        <div className={clsx('pointer-events-none absolute inset-0 transition-opacity duration-500', ready && (phase === 'idle' || phase === 'depart') ? 'opacity-100' : 'opacity-0')}>
          {agents.map((a) => (
            <div
              key={`${mode}-${a.id}`}
              ref={(el) => {
                if (el) agentLabels.current.set(a.id, { el, dot: el.querySelector('[data-dot]'), status: el.querySelector('[data-status]'), live: el.querySelector<HTMLElement>('[data-live]') });
                else agentLabels.current.delete(a.id);
              }}
              className={clsx('group absolute top-0 left-0 will-change-transform', (a.deptStatus === 'paused' || a.deptStatus === 'pending_approval') && 'opacity-60')}
              style={{ transform: 'translate(-9999px,-9999px)' }}
            >
              <button
                type="button"
                onClick={() => select(a.id)}
                className={clsx(
                  'pointer-events-auto flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap shadow-md ring-1 backdrop-blur-sm',
                  a.role === 'me' ? 'bg-accent/95 text-accent-fg ring-black/10' : 'bg-[#25211c]/90 text-[#fffdf8] ring-black/10',
                  compact ? 'px-1.5 py-1 text-[0px]' : 'px-2.5 py-1 text-[11.5px]',
                )}
              >
                {a.role === 'ceo' ? (
                  <Crown className="size-3 text-[#E0B44A]" />
                ) : a.role === 'me' ? (
                  <UserRound className="size-3" />
                ) : (
                  <span data-dot className="size-2 shrink-0 rounded-full bg-[#9A9083]" />
                )}
                {a.name}
                {a.deptStatus === 'error' && (
                  <span title={a.pauseReason || t('Phòng đang lỗi – mở để xem')} className="flex size-3.5 items-center justify-center rounded-full bg-[#C4483F] text-[9.5px] leading-none font-bold text-white">
                    !
                  </span>
                )}
              </button>
              <div
                data-status
                className={clsx(
                  'pointer-events-auto mx-auto mt-1 w-max max-w-[230px] cursor-default truncate rounded-full bg-[var(--surface-solid)]/95 px-2 py-0.5 text-[10.5px] text-muted shadow-sm ring-1 ring-black/5 data-[busy=1]:font-medium data-[busy=1]:text-fg data-[state=error]:font-medium data-[state=error]:text-[#C4483F]',
                  compact && 'hidden',
                )}
              />
              {/* AI đang viết / vừa làm gì (thời gian thực) */}
              <div
                data-live
                style={{ display: 'none' }}
                className={clsx(
                  'pointer-events-auto mx-auto mt-0.5 w-max max-w-[260px] cursor-default truncate rounded-full bg-[#25211c]/80 px-2 py-0.5 text-[10px] text-[#fffdf8]/90 italic shadow-sm',
                  compact && '!hidden',
                )}
              />
            </div>
          ))}
        </div>
      )}

      {/* Nhãn từng tầng (cảnh toà nhà) */}
      {!floor && (
        <div className={clsx('pointer-events-none absolute inset-0 transition-opacity duration-500', ready && !travelling ? 'opacity-100' : 'opacity-0')}>
          {Array.from({ length: LEVELS }).map((_, lv) => {
            const f = data.floors.find((x) => x.number === lv);
            const busy = Boolean(f?.project);
            return (
              <div
                key={lv}
                ref={(el) => {
                  if (el) levelLabels.current.set(`level-${lv}`, { el });
                  else levelLabels.current.delete(`level-${lv}`);
                }}
                className="absolute top-0 left-0 will-change-transform"
                style={{ transform: 'translate(-9999px,-9999px)' }}
              >
                <button
                  type="button"
                  disabled={lv === 0 || travelling}
                  onClick={() => lv > 0 && pickLevel(lv)}
                  onMouseEnter={() => lv > 0 && setHoverLevel(lv)}
                  onMouseLeave={() => setHoverLevel(null)}
                  className={clsx(
                    'pointer-events-auto flex max-w-[240px] items-center gap-2 rounded-2xl border px-2.5 py-1.5 text-left shadow-md transition-transform',
                    hoverLevel === lv && 'scale-105',
                    busy ? 'border-accent/40 bg-[var(--surface-solid)]' : 'border-line bg-[var(--surface-solid)]/90',
                  )}
                >
                  <span
                    className={clsx(
                      'flex size-7 shrink-0 items-center justify-center rounded-lg font-display text-[13px] font-semibold',
                      busy ? 'bg-accent text-accent-fg' : 'bg-surface-3 text-muted',
                    )}
                  >
                    {lv === 0 ? tc('level', 'T') : lv}
                  </span>
                  {!compact && (
                    <span className="min-w-0 leading-tight">
                      <span className="block truncate text-[12px] font-semibold text-fg">
                        {lv === 0 ? t('Sảnh & phòng CEO') : f?.project ? f.project.name : f?.enabled === false ? t('Tầng đang tắt') : t('Tầng trống')}
                      </span>
                      <span className="block truncate text-[10.5px] text-muted">
                        {lv === 0 ? t('Lễ tân · CEO tổng · bạn') : f?.project ? PHASE_STATE[f.project.phaseState] : t('Sẵn sàng nhận dự án')}
                      </span>
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Cửa thang máy khi chuyển tầng */}
      {doors && (
        <ElevatorDoors
          key={doors.id}
          closed={phase === 'closing'}
          from={doors.from}
          to={doors.to}
          dark={dark}
          title={doors.to === 0 ? t('Toà nhà') : t('Tầng {n}', { n: doors.to })}
          subtitle={doors.to === 0 ? t('Xem toàn bộ 5 tầng') : doorFloor?.project ? doorFloor.project.name : t('Tầng trống – sẵn sàng nhận dự án')}
        />
      )}

      {/* Thanh chọn tầng */}
      {showSelector && (
        <div className="absolute top-3 left-3 z-30 flex flex-wrap items-center gap-1 rounded-full border border-line bg-[var(--surface-solid)]/95 p-1 shadow-md">
          <button
            type="button"
            onClick={() => onViewChange('tower')}
            className={clsx('flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium', view === 'tower' ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-surface-3 hover:text-fg')}
          >
            <Building2 className="size-3.5" />
            {!compact && t('Toà nhà')}
          </button>
          {data.floors.map((f) => (
            <button
              key={f._id}
              type="button"
              title={f.project ? `${t(f.name)} · ${f.project.name}` : t('{floor} · trống', { floor: t(f.name) })}
              onClick={() => onViewChange(f.number)}
              className={clsx(
                'relative flex size-8 items-center justify-center rounded-full font-display text-[13px] font-semibold',
                view === f.number ? 'bg-accent text-accent-fg' : 'text-fg hover:bg-surface-3',
                !f.enabled && 'opacity-40',
              )}
            >
              {f.number}
              {f.project && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-[#E0B44A] ring-1 ring-[var(--surface-solid)]" />}
            </button>
          ))}
        </div>
      )}
      <div className="pointer-events-none absolute right-3 bottom-3 z-30 hidden rounded-full border border-line bg-[var(--surface)]/90 px-3 py-1 text-[11.5px] text-muted sm:block">
        {phase === 'depart'
          ? t('Bạn đang ra thang máy…')
          : travelling
            ? t('Đang đi thang máy…')
            : floor
              ? t('Bấm sàn để bạn (CEO) đi tới · bấm ghế, bi-da, cà phê để dùng · kéo để xoay')
              : t('Bấm vào một tầng để đi thang máy lên')}
      </div>
    </div>
  );
}

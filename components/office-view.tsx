'use client';
// Toà nhà 3D: tải động three.js khi trình duyệt hỗ trợ WebGL; nếu không thì hiển thị thẻ trạng thái từng tầng.
import dynamic from 'next/dynamic';
import { useSyncExternalStore } from 'react';
import clsx from 'clsx';
import { PHASE_STATE } from '@/lib/catalog';
import { t } from '@/lib/i18n';
import type { FloorView } from '@/lib/types';
import type { BuildingData } from './building/shared';
import type { BuildingViewMode } from './building';
import { Skeleton } from './ui';

const BuildingView = dynamic(() => import('./building'), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full" />,
});

let webgl: boolean | null = null;
function webglSupported(): boolean {
  if (webgl === null) {
    try {
      const c = document.createElement('canvas');
      webgl = Boolean(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
      webgl = false;
    }
  }
  return webgl;
}

const noopSubscribe = () => () => {};

export function FloorCards({ floors, onPick }: { floors: FloorView[]; onPick?: (n: number) => void }) {
  return (
    <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 lg:grid-cols-5">
      {floors.map((f) => (
        <button
          key={f._id}
          type="button"
          onClick={() => onPick?.(f.number)}
          className={clsx('rounded-2xl border p-3 text-left transition-colors hover:bg-surface-3', f.project ? 'border-accent/40' : 'border-line')}
        >
          <div className="flex items-center gap-2">
            <span className={clsx('flex size-7 items-center justify-center rounded-lg font-display font-semibold', f.project ? 'bg-accent text-accent-fg' : 'bg-surface-3 text-muted')}>
              {f.number}
            </span>
            <span className="text-[13px] font-semibold">{t(f.name)}</span>
          </div>
          <div className="mt-2 truncate text-[12.5px]">{f.project ? f.project.name : f.enabled ? t('Trống – sẵn sàng') : t('Đang tắt')}</div>
          {f.project && <div className="text-[11.5px] text-muted">{t(PHASE_STATE[f.project.phaseState])}</div>}
        </button>
      ))}
    </div>
  );
}

export function OfficeView({
  data,
  view,
  onViewChange,
  onEnterFloor,
  onSelectDept,
  onSelectMe,
  presentUntil,
  className,
  showSelector,
}: {
  data: BuildingData;
  view: BuildingViewMode;
  onViewChange: (v: BuildingViewMode) => void;
  onEnterFloor?: (n: number) => void;
  onSelectDept?: (deptId: string) => void;
  onSelectMe?: () => void;
  presentUntil?: number;
  className?: string;
  showSelector?: boolean;
}) {
  const gl = useSyncExternalStore(noopSubscribe, webglSupported, () => true);
  if (!gl) return <FloorCards floors={data.floors} onPick={(n) => (onEnterFloor ? onEnterFloor(n) : onViewChange(n))} />;
  return (
    <div className={clsx('relative w-full', className)}>
      <BuildingView
        data={data}
        view={view}
        onViewChange={onViewChange}
        onEnterFloor={onEnterFloor}
        onSelectDept={onSelectDept}
        onSelectMe={onSelectMe}
        presentUntil={presentUntil}
        showSelector={showSelector}
        className="h-full"
      />
    </div>
  );
}

export function BuildingLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-[#E0B44A]" /> {t('Đang làm việc')}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-[#4A86BD]" /> {t('Họp nhận việc')}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-[#C4532A]" /> {t('Giám đốc giao việc')}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-[#C4483F]" /> {t('Cần bạn duyệt')}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-[#5C9A68]" /> {t('Nghỉ ngơi · bi-da · cà phê')}
      </span>
    </div>
  );
}

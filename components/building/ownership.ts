// Việc nào hiện ở tầng nào (không phụ thuộc three.js – dùng được cả ở trang Toà nhà lẫn cảnh 3D).
import type { FloorView } from '@/lib/types';
import type { DeptWithTasks } from './shared';

/** Dự án đang có việc mở nhưng không ở tầng nào: chat trực tiếp với phòng, "Việc chung công ty" (heartbeat, lịch định kỳ), dự án đã xong được nhắn tiếp. */
export function floatingProjects(floors: Pick<FloorView, 'project'>[], departments: DeptWithTasks[]): Set<string> {
  const onFloor = new Set(floors.map((f) => f.project?._id).filter(Boolean) as string[]);
  const out = new Set<string>();
  for (const d of departments) for (const t of d.activeTasks) if (!onFloor.has(t.projectId)) out.add(t.projectId);
  return out;
}

/** Tầng hiển thị các việc không thuộc tầng nào: tầng đang bật còn trống đầu tiên, không có thì tầng thấp nhất. */
export function floatingHostId(floors: Pick<FloorView, '_id' | 'number' | 'enabled' | 'project'>[]): string | null {
  const sorted = [...floors].sort((a, b) => a.number - b.number);
  return (sorted.find((f) => f.enabled && !f.project) ?? sorted.find((f) => f.enabled) ?? sorted[0])?._id ?? null;
}

/** Hàm kiểm tra một việc (theo dự án) có hiện ở tầng này không. */
export function floorOwnership(floor: Pick<FloorView, '_id' | 'project'>, floors: FloorView[], departments: DeptWithTasks[]): { owns: (projectId: string) => boolean; hostsFloating: boolean } {
  const own = floor.project?._id ?? null;
  const hostsFloating = floatingHostId(floors) === floor._id;
  const floating = hostsFloating ? floatingProjects(floors, departments) : new Set<string>();
  return { owns: (pid: string) => pid === own || floating.has(pid), hostsFloating: hostsFloating && floating.size > 0 };
}

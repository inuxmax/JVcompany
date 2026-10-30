// Trạng thái các nhiệm vụ đang chạy trong tiến trình (dùng chung giữa worker và API).
interface Running {
  projectId: string;
  companyId: string;
  controller: AbortController;
  startedAt: number;
}

interface ControlState {
  /** Mã định danh worker của tiến trình này (nhiều instance có thể dùng chung MongoDB). */
  workerId: string;
  running: Map<string, Running>;
  /** Nhiệm vụ bị dừng để xếp lại hàng (vd tạm dừng vì vượt ngân sách) – không coi là huỷ. */
  requeue?: Map<string, string>;
  startedAt: string | null;
  started: boolean;
}

const g = globalThis as unknown as { __vpControl?: ControlState };
export const control: ControlState = (g.__vpControl ??= {
  workerId: `w-${process.pid}-${Date.now().toString(36)}`,
  running: new Map(),
  startedAt: null,
  started: false,
});

export function registerRunning(taskId: string, projectId: string, companyId = 'main'): AbortController {
  const controller = new AbortController();
  control.running.set(taskId, { projectId, companyId, controller, startedAt: Date.now() });
  return controller;
}

export function unregisterRunning(taskId: string) {
  control.running.delete(taskId);
}

export function abortRunning(taskId: string): boolean {
  const r = control.running.get(taskId);
  if (!r) return false;
  r.controller.abort();
  return true;
}

/** Số lượt đang chạy của một công ty (mỗi công ty có giới hạn song song riêng). */
export function runningForCompany(companyId: string): number {
  let n = 0;
  for (const r of control.running.values()) if ((r.companyId ?? 'main') === companyId) n++;
  return n;
}

export function runningForProject(projectId: string): number {
  let n = 0;
  for (const r of control.running.values()) if (r.projectId === projectId) n++;
  return n;
}

/** Dừng lượt chạy đang chạy nhưng xếp nhiệm vụ lại hàng (chạy tiếp khi được gỡ tạm dừng). */
export function requeueRunning(taskId: string, reason: string): boolean {
  (control.requeue ??= new Map()).set(taskId, reason);
  return abortRunning(taskId);
}

/** Lý do xếp lại hàng (nếu nhiệm vụ bị dừng theo cách đó) – đọc một lần. */
export function takeRequeue(taskId: string): string | null {
  const r = control.requeue?.get(taskId) ?? null;
  control.requeue?.delete(taskId);
  return r;
}

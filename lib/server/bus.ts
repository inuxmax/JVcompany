// Bus sự kiện trong tiến trình → client nhận realtime qua SSE (/api/events).
// Sự kiện chỉ đi qua bộ nhớ (SSE đọc thẳng từ bus): không ghi MongoDB cho từng sự kiện – trước đây mỗi sự kiện tốn
// 2 lần ghi (bộ đếm + bản ghi) mà không nơi nào đọc lại.
import { EventEmitter } from 'events';
import type { AppEvent } from '../types';
import { contextCompanyId, currentCompanyId, newId, now } from './db';

const g = globalThis as unknown as { __vpBus?: EventEmitter; __vpEventSeq?: number };
export const bus: EventEmitter = (g.__vpBus ??= (() => {
  const e = new EventEmitter();
  e.setMaxListeners(200);
  return e;
})());

/** Số thứ tự sự kiện trong tiến trình (tăng dần). */
function nextEventSeq(): number {
  g.__vpEventSeq = (g.__vpEventSeq ?? 0) + 1;
  return g.__vpEventSeq;
}

export type EventType =
  | 'project.updated'
  | 'project.deleted'
  | 'task.updated'
  | 'message.created'
  | 'approval.updated'
  | 'artifact.created'
  | 'department.updated'
  | 'provider.updated'
  | 'settings.updated'
  | 'floor.updated'
  | 'company.updated'
  | 'goal.updated'
  | 'routine.updated'
  | 'run.updated'
  | 'cost.recorded'
  | 'budget.updated'
  | 'activity.logged'
  | 'skill.updated'
  | 'secret.updated'
  | 'document.updated'
  | 'inbox.updated'
  | 'connection.updated'
  | 'connector.updated'
  | 'eval.updated'
  | 'user.updated'
  | 'plugin.updated'
  /** Chữ agent đang viết (đẩy thẳng tới trình duyệt, không lưu). */
  | 'task.live'
  /** Thao tác agent vừa làm (đọc tệp, chạy lệnh…) – đẩy thẳng, không lưu. */
  | 'task.activity'
  | 'worker.state';

export async function emit(type: EventType, projectId?: string | null, data?: Record<string, unknown>) {
  const ev: AppEvent = {
    _id: newId(),
    seq: nextEventSeq(),
    type,
    companyId: await currentCompanyId(),
    projectId: projectId ?? null,
    data,
    createdAt: now(),
  };
  bus.emit('event', ev);
}

/** Đẩy chữ đang viết tới trình duyệt ngay (mỗi giây có thể vài lần). */
export function emitLive(projectId: string, data: { taskId: string; departmentId: string; text: string | null }) {
  const ev: AppEvent = { _id: '', seq: 0, type: 'task.live', companyId: contextCompanyId(), projectId, data, createdAt: now() };
  bus.emit('event', ev);
}

/** Đẩy thao tác agent vừa làm (vd "Read next.config.js") tới trình duyệt – hiện dưới tên nhân viên. */
export function emitActivity(projectId: string, data: { taskId: string; departmentId: string; text: string }) {
  const ev: AppEvent = { _id: '', seq: 0, type: 'task.activity', companyId: contextCompanyId(), projectId, data, createdAt: now() };
  bus.emit('event', ev);
}

/** Đánh thức worker để xử lý hàng đợi ngay. */
export function wakeWorker() {
  bus.emit('wake');
}

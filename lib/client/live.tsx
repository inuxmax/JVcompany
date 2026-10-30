'use client';
// Nhận sự kiện realtime qua SSE và làm mới dữ liệu SWR tương ứng.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { fetcher } from './api';

interface LiveEvent {
  seq?: number;
  type: string;
  projectId?: string | null;
  data?: Record<string, unknown>;
}

type Listener = (ev: LiveEvent) => void;

const LiveContext = createContext<{ connected: boolean; subscribe: (l: Listener) => () => void }>({
  connected: false,
  subscribe: () => () => {},
});

/** Khóa SWR không nên tự làm mới theo sự kiện (tốn kém hoặc không liên quan). */
const SKIP = [/^\/api\/fs\//, /^\/api\/providers\/detect/, /\/files(\?|$)/, /^\/api\/health/];

/**
 * Mỗi loại sự kiện chỉ làm mới đúng các dữ liệu liên quan (trước đây mọi sự kiện tải lại toàn bộ API →
 * khi agent đang chạy, trang Toà nhà tải lại ~9 API vài lần mỗi giây và cảnh 3D bị giật).
 * Loại sự kiện chưa khai báo → làm mới tất cả như cũ.
 */
const PROJECT_DETAIL = /^\/api\/projects\/[^/?]+(\?|$)/;
const ROUTES: Record<string, RegExp[]> = {
  'message.created': [/^\/api\/projects\/[^/]+\/(messages|live)/, /^\/api\/tasks\/[^/?]+/],
  'task.updated': [/^\/api\/departments(\?|$)/, /^\/api\/floors/, /^\/api\/projects(\?|$)/, PROJECT_DETAIL, /^\/api\/projects\/[^/]+\/live/, /^\/api\/tasks/, /^\/api\/overview/, /^\/api\/runs/, /^\/api\/inbox/, /^\/api\/evals\//],
  'project.updated': [/^\/api\/projects/, /^\/api\/floors/, /^\/api\/overview/, /^\/api\/departments(\?|$)/, /^\/api\/inbox/],
  'project.deleted': [/^\/api\/projects/, /^\/api\/floors/, /^\/api\/overview/, /^\/api\/departments(\?|$)/, /^\/api\/tasks/, /^\/api\/inbox/],
  'approval.updated': [/^\/api\/approvals/, /^\/api\/overview/, PROJECT_DETAIL, /^\/api\/tasks\/[^/?]+/, /^\/api\/inbox/],
  'artifact.created': [/^\/api\/projects\/[^/]+\/artifacts/],
  'department.updated': [/^\/api\/departments/, /^\/api\/overview/, /^\/api\/setup/, /^\/api\/teams/, /^\/api\/skills/],
  'provider.updated': [/^\/api\/providers/, /^\/api\/setup/, /^\/api\/overview(\?|$)/],
  'settings.updated': [/^\/api\/settings/, /^\/api\/providers/],
  'floor.updated': [/^\/api\/floors/, /^\/api\/overview/],
  'company.updated': [/^\/api\/company/, /^\/api\/setup/, /^\/api\/overview/, /^\/api\/companies/],
  'goal.updated': [/^\/api\/goals/],
  'routine.updated': [/^\/api\/routines/],
  'run.updated': [/^\/api\/runs/, /^\/api\/overview\/ops/, /^\/api\/providers\/usage/, /^\/api\/inbox/],
  'cost.recorded': [/^\/api\/costs/, /^\/api\/overview\/ops/, /^\/api\/providers\/usage/],
  'budget.updated': [/^\/api\/costs/, /^\/api\/overview/, /^\/api\/departments/, /^\/api\/company/, /^\/api\/approvals/, /^\/api\/inbox/],
  'activity.logged': [/^\/api\/activity/, /^\/api\/overview\/ops/],
  'skill.updated': [/^\/api\/skills/],
  'secret.updated': [/^\/api\/secrets/],
  // Giai đoạn 4: tài liệu, hộp thư, kết nối dịch vụ, kênh chat, đánh giá, tài khoản, plugin
  'document.updated': [/^\/api\/documents/, /^\/api\/tasks\/[^/]+\/documents/, /^\/api\/inbox/],
  'inbox.updated': [/^\/api\/inbox/],
  'connection.updated': [/^\/api\/connections/],
  'connector.updated': [/^\/api\/connectors/, /^\/api\/inbox/],
  'eval.updated': [/^\/api\/evals/],
  'user.updated': [/^\/api\/users/, /^\/api\/auth\/me/],
  'plugin.updated': [/^\/api\/plugins/, /^\/api\/skills/, /^\/api\/connections/, /^\/api\/routines/, /^\/api\/departments/],
  'worker.state': [],
};

function LiveBridge({ children }: { children: ReactNode }) {
  const { mutate } = useSWRConfig();
  const [connected, setConnected] = useState(false);
  const listeners = useRef(new Set<Listener>());
  // Hàng chờ làm mới: mẫu khoá cần làm mới (kèm dự án của sự kiện) – gom lại rồi làm mới một lần
  const pending = useRef<{ rules: { re: RegExp | null; projectId: string | null }[]; timer: ReturnType<typeof setTimeout> | null }>({
    rules: [],
    timer: null,
  });

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    const queue = pending.current;

    const flush = () => {
      const p = pending.current;
      p.timer = null;
      const rules = p.rules;
      p.rules = [];
      void mutate(
        (key) => {
          if (typeof key !== 'string' || !key.startsWith('/api/')) return false;
          if (SKIP.some((re) => re.test(key))) return false;
          return rules.some((r) => {
            if (r.re && !r.re.test(key)) return false;
            // Khoá riêng của một dự án chỉ làm mới khi sự kiện thuộc đúng dự án đó
            if (key.startsWith('/api/projects/') && r.projectId) return key.includes(r.projectId);
            return true;
          });
        },
        undefined,
        { revalidate: true },
      );
    };

    const connect = () => {
      if (closed) return;
      es = new EventSource('/api/events');
      es.onopen = () => setConnected(true);
      es.onerror = () => {
        setConnected(false);
        es?.close();
        if (!closed) retry = setTimeout(connect, 3000);
      };
      es.onmessage = (msg) => {
        let ev: LiveEvent;
        try {
          ev = JSON.parse(msg.data);
        } catch {
          return;
        }
        if (ev.type === 'hello') return;
        listeners.current.forEach((l) => l(ev));
        // Chữ đang viết chỉ dành cho người nghe trực tiếp, không cần tải lại dữ liệu.
        if (ev.type === 'task.live' || ev.type === 'task.activity') return;
        const p = pending.current;
        const routes = ROUTES[ev.type];
        if (routes) for (const re of routes) p.rules.push({ re, projectId: ev.projectId ?? null });
        else p.rules.push({ re: null, projectId: ev.projectId ?? null });
        if (!p.timer && p.rules.length) p.timer = setTimeout(flush, 500);
      };
    };
    connect();
    return () => {
      closed = true;
      es?.close();
      if (retry) clearTimeout(retry);
      if (queue.timer) clearTimeout(queue.timer);
    };
  }, [mutate]);

  const subscribe = (l: Listener) => {
    listeners.current.add(l);
    return () => {
      listeners.current.delete(l);
    };
  };

  return <LiveContext.Provider value={{ connected, subscribe }}>{children}</LiveContext.Provider>;
}

export function LiveProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ fetcher, revalidateOnFocus: true, dedupingInterval: 300, keepPreviousData: true }}>
      <LiveBridge>{children}</LiveBridge>
    </SWRConfig>
  );
}

export function useLive() {
  return useContext(LiveContext);
}

export function useLiveEvent(handler: Listener) {
  const { subscribe } = useLive();
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => subscribe((ev) => ref.current(ev)), [subscribe]);
}

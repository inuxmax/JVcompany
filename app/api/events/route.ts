// Luồng sự kiện realtime (Server-Sent Events) cho giao diện.
import { bus } from '@/lib/server/bus';
import { currentCompanyId } from '@/lib/server/db';
import type { AppEvent } from '@/lib/types';

export async function GET(req: Request) {
  // Mỗi trình duyệt chỉ nhận sự kiện của công ty đang mở
  const companyId = await currentCompanyId();
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          cleanup();
        }
      };
      const onEvent = (ev: AppEvent) => {
        if (ev.companyId && ev.companyId !== companyId) return;
        send({ seq: ev.seq, type: ev.type, projectId: ev.projectId, data: ev.data });
      };
      bus.on('event', onEvent);
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          cleanup();
        }
      }, 20_000);
      cleanup = () => {
        bus.off('event', onEvent);
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          /* đã đóng */
        }
      };
      req.signal.addEventListener('abort', () => cleanup());
      send({ type: 'hello' });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

import { listBindings, listConnectors, publicConnector, saveConnector } from '@/lib/server/telegram';
import { failFrom, ok, readJson, route } from '@/lib/server/http';
import type { ChatConnector } from '@/lib/types';

/** Kênh chat bên ngoài (Telegram) kèm các cuộc trò chuyện đã ghép. */
export const GET = route(async () => {
  const [connectors, bindings] = await Promise.all([listConnectors(), listBindings()]);
  return ok({ connectors: connectors.map(publicConnector), bindings });
});

export const POST = route(async (req: Request) => {
  const body = await readJson<Partial<ChatConnector> & { token?: string }>(req);
  try {
    return ok(publicConnector(await saveConnector(null, body)), 201);
  } catch (err) {
    return failFrom(err);
  }
});

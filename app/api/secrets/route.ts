import { createSecret, listSecrets } from '@/lib/server/secrets';
import { failFrom, ok, readJson, route } from '@/lib/server/http';

export const GET = route(async () => ok(await listSecrets()));

export const POST = route(async (req: Request) => {
  const { key, value, description } = await readJson<{ key?: string; value?: string; description?: string }>(req);
  try {
    return ok(await createSecret(key ?? '', value ?? '', description ?? ''), 201);
  } catch (err) {
    return failFrom(err);
  }
});

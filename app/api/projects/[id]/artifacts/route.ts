import { listArtifacts } from '@/lib/server/repo';
import { getCollections } from '@/lib/server/db';
import { type Ctx, ok, route } from '@/lib/server/http';

export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return ok(await listArtifacts(id));
});

export const DELETE = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const artifactId = new URL(req.url).searchParams.get('artifactId');
  const c = await getCollections();
  if (artifactId) await c.artifacts.deleteOne({ _id: artifactId, projectId: id });
  return ok({ ok: true });
});

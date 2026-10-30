import { getWorkflow, updateWorkflow } from '@/lib/server/repo';
import { fail, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';
import type { Workflow } from '@/lib/types';

export const GET = route(async () => ok(await getWorkflow()));

export const PATCH = route(async (req: Request) => {
  const body = await readJson<Partial<Workflow>>(req);
  if (body.phases && (!Array.isArray(body.phases) || !body.phases.length)) return fail(m('Quy trình cần ít nhất một giai đoạn'));
  const patch: Partial<Workflow> = {};
  if (body.name) patch.name = body.name;
  if (body.phases) patch.phases = body.phases;
  return ok(await updateWorkflow('default', patch));
});

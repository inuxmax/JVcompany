import { getSettings, updateSettings } from '@/lib/server/repo';
import { wakeWorker } from '@/lib/server/bus';
import { ok, readJson, route } from '@/lib/server/http';
import type { Settings } from '@/lib/types';
import { isLocale } from '@/lib/i18n/locales';

const EDITABLE: (keyof Settings)[] = [
  'computerControl',
  'defaultPermission',
  'defaultProviderId',
  'concurrency',
  'perProjectConcurrency',
  'maxTasksPerProject',
  'maxDepth',
  'maxRounds',
  'approvalTimeoutMinutes',
  'retry',
  'workerEnabled',
  'language',
  'codeGraph',
];
const NUMERIC = ['concurrency', 'perProjectConcurrency', 'maxTasksPerProject', 'maxDepth', 'maxRounds', 'approvalTimeoutMinutes'] as const;

export const GET = route(async () => ok(await getSettings()));

export const PATCH = route(async (req: Request) => {
  const body = await readJson<Partial<Settings>>(req);
  const patch = Object.fromEntries(Object.entries(body).filter(([k]) => EDITABLE.includes(k as keyof Settings))) as Partial<Settings>;
  if (patch.language !== undefined && !isLocale(patch.language)) delete patch.language;
  for (const k of NUMERIC) {
    if (patch[k] !== undefined) patch[k] = Math.max(1, Math.round(Number(patch[k]) || 1));
  }
  if (patch.retry) {
    patch.retry = {
      baseMinutes: Math.max(0.5, Number(patch.retry.baseMinutes) || 2),
      maxMinutes: Math.max(1, Number(patch.retry.maxMinutes) || 60),
      maxAttempts: Math.max(1, Math.round(Number(patch.retry.maxAttempts) || 12)),
    };
  }
  const s = await updateSettings(patch);
  wakeWorker();
  return ok(s);
});

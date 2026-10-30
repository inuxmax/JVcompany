import os from 'os';
import { displayUri, MONGODB_DB, pingDb } from '@/lib/server/db';
import { control } from '@/lib/server/agent/control';
import { getSettings } from '@/lib/server/repo';
import { ok, route } from '@/lib/server/http';
import type { SystemHealth } from '@/lib/types';

export const GET = route(async () => {
  const db = await pingDb();
  const enabled = db.ok ? (await getSettings()).workerEnabled : false;
  const health: SystemHealth = {
    db: { ...db, uri: displayUri(), name: MONGODB_DB },
    worker: { running: control.started, enabled, activeTasks: control.running.size, startedAt: control.startedAt },
    platform: `${os.type()} ${os.release()} (${process.platform})`,
    version: '2.0.0',
  };
  return ok(health);
});

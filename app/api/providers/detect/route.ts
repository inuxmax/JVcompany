import { detectLocalAgents } from '@/lib/server/agent/detect';
import { ok, route } from '@/lib/server/http';

export const GET = route(async () => ok(await detectLocalAgents()));

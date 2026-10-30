import { TEAM_TEMPLATES, getTeam } from '@/lib/teams';
import { applyTeam } from '@/lib/server/company';
import { saveRoutine } from '@/lib/server/routines';
import { listDepartments } from '@/lib/server/repo';
import { logActivity } from '@/lib/server/activity';
import { fail, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

/** Đội mẫu kèm trạng thái: các phòng đã có / đang bật. */
export const GET = route(async () => {
  const depts = await listDepartments();
  return ok(
    TEAM_TEMPLATES.map((t) => ({
      ...t,
      installed: t.departments.every((id) => depts.some((d) => d._id === id && d.enabled)),
      missing: t.departments.filter((id) => !depts.some((d) => d._id === id)),
    })),
  );
});

/** Cài đội mẫu (thêm vào, không tắt phòng khác) + tạo các lịch định kỳ gợi ý (đang tạm dừng để bạn xem lại). */
export const POST = route(async (req: Request) => {
  const { teamId, withRoutines } = await readJson<{ teamId?: string; withRoutines?: boolean }>(req);
  const team = teamId ? getTeam(teamId) : null;
  if (!team) return fail(m('Không tìm thấy đội mẫu'));
  const r = await applyTeam(team.id);
  let routines = 0;
  if (withRoutines !== false) {
    for (const rt of team.routines ?? []) {
      await saveRoutine({ title: rt.title, instructions: rt.instructions, departmentId: rt.department, status: 'paused', triggers: [{ id: '', kind: 'schedule', enabled: true, cron: rt.cron }] });
      routines++;
    }
  }
  await logActivity({ action: 'team.installed', entityType: 'team', entityId: team.id, summary: `Cài đội mẫu "${team.name}" (${r.created.length} phòng mới, ${routines} lịch định kỳ)` });
  return ok({ ...r, routines });
});

'use client';
import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { OpsOverview } from '@/components/ops-overview';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  FolderKanban,
  Hand,
  Hourglass,
  ListChecks,
  PlugZap,
  Plus,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import type { DashboardStats, Department, FloorView, Message, Project, Provider, QueuedProject, Task, Workflow } from '@/lib/types';
import { PHASE_STATE, findPhase } from '@/lib/catalog';
import { Page, PageHeader } from '@/components/shell';
import { Button, Card, CardHeader, EmptyState, ErrorNote, Skeleton } from '@/components/ui';
import { MessageItem, PhaseDots, ProjectStatusBadge } from '@/components/domain';
import { BuildingLegend, OfficeView } from '@/components/office-view';
import { timeAgo } from '@/lib/client/format';
import { intlLocale, t } from '@/lib/i18n';

interface Overview {
  stats: DashboardStats;
  projects: Project[];
  departments: (Department & { activeTasks: Task[] })[];
  recent: Message[];
  projectNames: Record<string, string>;
  floors: FloorView[];
  queue: QueuedProject[];
}

const noopSubscribe = () => () => {};

function greeting() {
  const h = new Date().getHours();
  return h < 11 ? t('Chào buổi sáng') : h < 14 ? t('Chào buổi trưa') : h < 18 ? t('Chào buổi chiều') : t('Chào buổi tối');
}

function today() {
  return new Date().toLocaleDateString(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
}

function Stat({ label, value, sub, icon: Icon, color, href }: { label: string; value: number | string; sub: string; icon: typeof Activity; color: string; href: string }) {
  return (
    <Link href={href} className="group glass flex items-center gap-3 rounded-[22px] p-3 transition-transform hover:-translate-y-0.5 sm:gap-3.5 sm:p-3.5 sm:pr-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl sm:size-11" style={{ background: `${color}22`, color, boxShadow: `inset 0 0 0 1px ${color}33` }}>
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11.5px] text-muted sm:text-[12.5px]">{label}</span>
        <span className="flex items-baseline gap-2">
          <span className="font-display text-[20px] leading-tight font-semibold tabular-nums sm:text-[24px]">{value}</span>
          <span className="hidden truncate text-[11.5px] text-subtle sm:inline">{sub}</span>
        </span>
      </span>
      <ArrowUpRight className="hidden size-4 shrink-0 text-subtle opacity-0 transition-opacity group-hover:opacity-100 sm:block" />
    </Link>
  );
}

interface Todo {
  key: string;
  href: string;
  icon: typeof Hand;
  color: string;
  title: string;
  sub: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const hello = useSyncExternalStore(noopSubscribe, greeting, () => t('Xin chào'));
  const date = useSyncExternalStore(noopSubscribe, today, () => '');
  const { data, error, isLoading } = useSWR<Overview>('/api/overview', { refreshInterval: 15_000 });
  const { data: workflows } = useSWR<Workflow[]>('/api/workflows');
  const { data: prov } = useSWR<{ providers: Provider[] }>('/api/providers');
  const automatic = (prov?.providers ?? []).filter((p) => p.enabled && p.kind !== 'manual');
  const s = data?.stats;
  const active = (data?.projects ?? []).filter((p) => ['active', 'blocked', 'paused'].includes(p.status));
  const busy = s?.departments.busy ?? 0;

  const todos: Todo[] = [];
  if (data) {
    if (s && s.approvalsPending > 0)
      todos.push({ key: 'ap', href: '/approvals', icon: ShieldCheck, color: '#C9952F', title: t('{n} yêu cầu phê duyệt quyền', { n: s.approvalsPending }), sub: t('Lệnh shell, ghi tệp, điều khiển máy') });
    for (const d of data.departments)
      for (const task of d.activeTasks.filter((x) => x.status === 'waiting_human'))
        todos.push({ key: task._id, href: `/projects/${task.projectId}?task=${task._id}`, icon: Hand, color: '#C06587', title: t('{name} cần bạn chuyển tiếp', { name: t(d.name) }), sub: task.title });
    for (const p of data.projects.filter((x) => x.status === 'blocked' || (x.status === 'active' && x.phaseState === 'awaiting_user')))
      todos.push({
        key: p._id,
        href: `/projects/${p._id}`,
        icon: TriangleAlert,
        color: p.status === 'blocked' ? '#C4483F' : '#8A7DAE',
        title: p.name,
        sub: p.status === 'blocked' ? (p.blockedReason ?? t('Cần xử lý')) : PHASE_STATE[p.phaseState],
      });
    const limited = data.departments.flatMap((d) => d.activeTasks).filter((task) => task.status === 'waiting_limit').length;
    if (limited) todos.push({ key: 'lim', href: '/tasks', icon: Hourglass, color: '#CF6A3D', title: t('{n} nhiệm vụ chờ hạn mức', { n: limited }), sub: t('Sẽ tự chạy lại khi có hạn mức') });
  }

  return (
    <Page wide>
      <PageHeader
        eyebrow={<span suppressHydrationWarning>{date || 'JVCompany' /* i18n-ignore */}</span>}
        title={
          <>
            {hello},{' '}
            <span className="text-accent italic">{busy > 0 ? t('{n} phòng đang làm việc', { n: busy }) : t('văn phòng sẵn sàng')}</span>
          </>
        }
        description={t('Theo dõi các agent làm việc theo thời gian thực, giao việc và quyết định những điều quan trọng.')}
        actions={
          <Link href="/projects/new">
            <Button variant="primary" size="lg" icon={<Plus className="size-4" />}>
              {t('Dự án mới')}
            </Button>
          </Link>
        }
      />
      <ErrorNote error={error} className="mb-4" />

      {prov && automatic.length === 0 && (
        <Card className="mb-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-fg">
            <Sparkles className="size-5" />
          </div>
          <div className="flex-1">
            <div className="font-display text-[16px] font-semibold">{t('Kết nối AI agent đầu tiên')}</div>
            <p className="text-[13px] text-muted">
              {t('API key (Claude, GPT, Gemini, Grok…), gói đăng ký qua ứng dụng desktop (Claude Code, Codex, Gemini CLI, Cursor) hoặc chuyển tiếp qua trình duyệt.')}
            </p>
          </div>
          <Link href="/providers">
            <Button variant="primary" icon={<PlugZap className="size-4" />}>
              {t('Thêm kết nối')}
            </Button>
          </Link>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {isLoading && !s ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[76px]" />)
        ) : (
          <>
            <Stat label={t('Dự án đang chạy')} value={s?.projects.active ?? 0} sub={t('/ {n} dự án', { n: s?.projects.total ?? 0 })} icon={FolderKanban} color="#8A7DAE" href="/projects" />
            <Stat
              label={t('Nhiệm vụ đang xử lý')}
              value={(s?.tasks.running ?? 0) + (s?.tasks.queued ?? 0)}
              sub={t('{n} đang chờ', { n: s?.tasks.waiting ?? 0 })}
              icon={ListChecks}
              color="#3F8A93"
              href="/tasks"
            />
            <Stat label={t('Chờ bạn phê duyệt')} value={s?.approvalsPending ?? 0} sub={t('yêu cầu')} icon={ShieldCheck} color="#C9952F" href="/approvals" />
            <Stat label={t('Kết nối AI sẵn sàng')} value={`${s?.providers.ready ?? 0}/${s?.providers.total ?? 0}`} sub={t('kết nối')} icon={PlugZap} color="#C06587" href="/providers" />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader
            title={t('Toà nhà công ty')}
            description={`${t('{busy}/{total} tầng đang làm dự án', { busy: data?.floors.filter((f) => f.project).length ?? 0, total: data?.floors.length ?? 5 })}${data?.queue.length ? ` · ${t('{n} dự án chờ tầng trống', { n: data.queue.length })}` : ''}. ${t('Bấm vào một tầng để vào xem.')}`}
            actions={
              <Link href="/office" className="flex items-center gap-1 text-[13px] text-muted hover:text-fg">
                {t('Vào toà nhà')} <ArrowRight className="size-3.5" />
              </Link>
            }
          />
          <div className="px-2 pb-2 sm:px-3">
            {data ? (
              <OfficeView
                className="h-[380px] overflow-hidden rounded-[20px] sm:h-[520px]"
                data={{ floors: data.floors, departments: data.departments, workflows: workflows ?? [] }}
                view="tower"
                showSelector={false}
                onViewChange={(v) => router.push(`/office?floor=${v}`)}
                onEnterFloor={(n) => router.push(`/office?floor=${n}`)}
                onSelectDept={(id) => router.push(`/office?dept=${id}`)}
              />
            ) : (
              <Skeleton className="h-[380px] sm:h-[520px]" />
            )}
          </div>
          <div className="border-t border-line px-6 py-3">
            <BuildingLegend />
          </div>
        </Card>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title={t('Cần bạn quyết định')} description={todos.length ? t('{n} việc', { n: todos.length }) : t('Mọi thứ đang ổn')} />
            <div className="space-y-1.5 px-3 pb-4">
              {!data ? (
                <Skeleton className="mx-3 h-20" />
              ) : todos.length === 0 ? (
                <div className="mx-3 rounded-2xl border border-dashed border-line-strong px-4 py-5 text-center text-[13px] text-muted">
                  {t('Không có gì cần bạn xử lý lúc này 🎉')}
                </div>
              ) : (
                todos.slice(0, 6).map((todo) => (
                  <Link key={todo.key} href={todo.href} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-surface-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl" style={{ background: `${todo.color}22`, color: todo.color }}>
                      <todo.icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium">{todo.title}</span>
                      <span className="block truncate text-[12px] text-muted">{todo.sub}</span>
                    </span>
                    <ArrowRight className="size-3.5 shrink-0 text-subtle" />
                  </Link>
                ))
              )}
            </div>
          </Card>

          <Card className="flex min-h-[320px] flex-1 flex-col xl:max-h-[560px]">
            <CardHeader title={t('Trực tiếp')} description={t('Báo cáo, giao việc và sự kiện mới nhất')} icon={<Activity className="size-4 text-accent" />} />
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              {!data ? (
                <Skeleton className="h-40" />
              ) : data.recent.length === 0 ? (
                <EmptyState title={t('Chưa có hoạt động')} description={t('Khi các phòng ban làm việc, báo cáo và giao việc sẽ hiện ở đây.')} />
              ) : (
                data.recent.map((m) => (
                  <div
                    key={m._id}
                    role="link"
                    tabIndex={0}
                    onClick={() => router.push(`/projects/${m.projectId}`)}
                    onKeyDown={(e) => e.key === 'Enter' && router.push(`/projects/${m.projectId}`)}
                    className="cursor-pointer rounded-2xl transition-colors hover:bg-surface-3/60"
                  >
                    <MessageItem message={m} departments={data.departments} projectName={data.projectNames[m.projectId]} compact />
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>

      <OpsOverview />

      <section className="mt-8">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-[22px] font-semibold tracking-tight">{t('Dự án đang hoạt động')}</h2>
            <p className="text-[13px] text-muted">{t('Tiến độ theo quy trình 7 giai đoạn')}</p>
          </div>
          <Link href="/projects" className="flex items-center gap-1 text-[13px] text-muted hover:text-fg">
            {t('Tất cả dự án')} <ArrowRight className="size-3.5" />
          </Link>
        </div>
        {!data ? (
          <Skeleton className="h-36" />
        ) : active.length === 0 ? (
          <Card>
            <EmptyState
              icon={<FolderKanban className="size-6" />}
              title={t('Chưa có dự án nào đang chạy')}
              description={t('Tạo dự án, chọn thư mục trên máy và để các phòng ban AI bắt tay vào việc.')}
              action={
                <Link href="/projects/new">
                  <Button variant="primary" icon={<Plus className="size-4" />}>
                    {t('Tạo dự án')}
                  </Button>
                </Link>
              }
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {active.map((p) => {
              const phase = findPhase(workflows, p.currentPhase);
              return (
                <Link key={p._id} href={`/projects/${p._id}`} className="group">
                  <Card className="h-full p-5 transition-transform group-hover:-translate-y-0.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-display text-[17px] font-semibold">{p.name}</div>
                        <div className="truncate text-[12.5px] text-muted">
                          {phase ? t(phase.name) : ''} · {PHASE_STATE[p.phaseState]} · {timeAgo(p.updatedAt)}
                        </div>
                      </div>
                      <ProjectStatusBadge status={p.status} />
                    </div>
                    <div className="mt-4">
                      <PhaseDots project={p} workflow={workflows?.find((w) => w._id === p.workflowId)} />
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </Page>
  );
}

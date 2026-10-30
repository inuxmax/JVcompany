'use client';
import { Suspense, use, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR, { mutate } from 'swr';
import {
  ArrowLeft,
  Ban,
  Check,
  FolderOpen,
  MessageSquare,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Rocket,
  SkipForward,
  Trash2,
  Undo2,
  ListChecks,
  FileText,
  Folder,
  TriangleAlert,
  Building2,
  Network,
} from 'lucide-react';
import type { Approval, Department, PermissionLevel, Project, Task, Workflow } from '@/lib/types';
import { DIRECTOR_WORKFLOW_ID, PERMISSION_LEVELS, PHASE_STATE } from '@/lib/catalog';
import { api, desktop } from '@/lib/client/api';
import { timeAgo, tint } from '@/lib/client/format';
import { t } from '@/lib/i18n';
import { Page } from '@/components/shell';
import { Badge, Button, Card, DeptAvatar, ErrorNote, Field, Input, Modal, Segmented, Skeleton, Switch, Textarea, confirmDialog, toast } from '@/components/ui';
import { FolderField, PhaseStepper, ProjectStatusBadge, WorkflowPicker } from '@/components/domain';
import { ApprovalCard } from '@/components/approval-card';
import { ArtifactsPanel, ChatPanel, FilesPanel, TaskBoard } from '@/components/project-panels';
import { CodeGraphPanel } from '@/components/code-graph';
import { TaskDrawer } from '@/components/task-drawer';

interface Detail {
  project: Project;
  workflow: Workflow;
  tasks: Task[];
  approvals: Approval[];
}

type Tab = 'chat' | 'tasks' | 'artifacts' | 'files' | 'graph';

function EditProjectModal({ project, open, onClose }: { project: Project; open: boolean; onClose: () => void }) {
  const { data: workflows } = useSWR<Workflow[]>('/api/workflows');
  const [form, setForm] = useState({
    name: project.name,
    goal: project.goal,
    description: project.description,
    path: project.path,
    autopilot: project.autopilot,
    permission: project.permission,
    workflowId: project.workflowId,
  });
  const [busy, setBusy] = useState(false);
  const running = project.status === 'active' || project.status === 'blocked';
  const save = async () => {
    if (form.workflowId !== project.workflowId && running) {
      const next = workflows?.find((w) => w._id === form.workflowId);
      const ok = await confirmDialog({
        title: t('Chuyển sang "{name}"?', { name: next ? t(next.name) : t('chế độ mới') }),
        message: t('Việc đang làm của dự án sẽ dừng và dự án bắt đầu lại theo chế độ mới. Tài liệu và hội thoại cũ vẫn được giữ.'),
        confirmLabel: t('Chuyển chế độ'),
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await api.patch(`/api/projects/${project._id}`, form);
      await mutate(`/api/projects/${project._id}`);
      toast.success(t('Đã lưu dự án'));
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t('Cài đặt dự án')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Hủy')}
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            {t('Lưu')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('Tên dự án')}>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label={t('Mục tiêu')}>
          <Input value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} />
        </Field>
        <Field label={t('Mô tả / yêu cầu')}>
          <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="min-h-[140px]" />
        </Field>
        <Field label={t('Thư mục dự án')}>
          <FolderField value={form.path} onChange={(p) => setForm({ ...form, path: p })} />
        </Field>
        <Field label={t('Cách làm việc')}>
          {workflows ? <WorkflowPicker workflows={workflows} value={form.workflowId} onChange={(id) => setForm({ ...form, workflowId: id })} /> : null}
        </Field>
        <Field label={t('Quyền hạn của agent')}>
          <Segmented<PermissionLevel>
            value={form.permission}
            onChange={(v) => setForm({ ...form, permission: v })}
            options={PERMISSION_LEVELS.map((p) => ({ value: p.id, label: p.label }))}
          />
          <p className="mt-1.5 text-[12px] text-muted">{PERMISSION_LEVELS.find((p) => p.id === form.permission)?.description}</p>
        </Field>
        <div className="flex items-center justify-between rounded-xl border border-line p-3">
          <div>
            <div className="text-[13.5px] font-medium">{form.workflowId === DIRECTOR_WORKFLOW_ID ? t('Tự hoàn tất khi có báo cáo') : t('Tự động chuyển giai đoạn')}</div>
            <div className="text-[12.5px] text-muted">
              {form.workflowId === DIRECTOR_WORKFLOW_ID ? t('Tắt để bạn xem báo cáo của giám đốc rồi tự bấm Hoàn tất.') : t('Tắt để bạn tự bấm chuyển sau khi giai đoạn đạt.')}
            </div>
          </div>
          <Switch checked={form.autopilot} onChange={(v) => setForm({ ...form, autopilot: v })} />
        </div>
      </div>
    </Modal>
  );
}

function RejectModal({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (notes: string) => Promise<void> }) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('Yêu cầu làm lại giai đoạn')}
      description={t('Phản hồi của bạn sẽ được gửi tới phòng chủ trì để sửa.')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Hủy')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!notes.trim()}
            onClick={async () => {
              setBusy(true);
              await onSubmit(notes);
              setBusy(false);
              setNotes('');
            }}
          >
            {t('Gửi yêu cầu')}
          </Button>
        </>
      }
    >
      <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('Cần sửa gì? Càng cụ thể càng tốt…')} className="min-h-[160px]" autoFocus />
    </Modal>
  );
}

function ProjectInner({ id }: { id: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const taskId = params.get('task');
  const tab = (params.get('tab') as Tab) || 'chat';
  const { data, error } = useSWR<Detail>(`/api/projects/${id}`);
  const { data: departments } = useSWR<Department[]>('/api/departments');
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const setQuery = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    router.replace(`/projects/${id}${q.toString() ? `?${q}` : ''}`, { scroll: false });
  };

  const action = async (name: string, notes?: string) => {
    setBusy(name);
    try {
      await api.post(`/api/projects/${id}/action`, { action: name, notes });
      await mutate(`/api/projects/${id}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const openFolder = async () => {
    try {
      const d = desktop();
      if (d && data?.project.path) await d.revealPath(data.project.path);
      else await api.post(`/api/projects/${id}/open`);
    } catch (e) {
      toast.error(e);
    }
  };

  const remove = async () => {
    const ok = await confirmDialog({
      title: t('Xoá dự án này?'),
      message: t('Toàn bộ nhiệm vụ, hội thoại và tài liệu của dự án sẽ bị xoá. Tệp trong thư mục dự án trên máy vẫn được giữ nguyên.'),
      confirmLabel: t('Xoá dự án'),
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.del(`/api/projects/${id}`);
      router.push('/projects');
    } catch (e) {
      toast.error(e);
    }
  };

  if (error) {
    return (
      <Page>
        <ErrorNote error={error} />
        <Link href="/projects" className="mt-4 inline-block text-[13px] text-muted hover:text-fg">
          ← {t('Về danh sách dự án')}
        </Link>
      </Page>
    );
  }
  if (!data || !departments) {
    return (
      <Page wide>
        <Skeleton className="mb-4 h-20" />
        <Skeleton className="mb-4 h-28" />
        <Skeleton className="h-[480px]" />
      </Page>
    );
  }

  const { project, workflow, tasks, approvals } = data;
  const phase = workflow.phases.find((p) => p.id === project.currentPhase);
  const lead = departments.find((d) => d._id === phase?.lead);
  const perm = PERMISSION_LEVELS.find((p) => p.id === project.permission);
  const approvers = (phase?.requiredApprovals ?? []).map((a) => departments.find((d) => d._id === a)).filter(Boolean) as Department[];
  const openTasks = tasks.filter((task) => !['done', 'failed', 'cancelled'].includes(task.status)).length;
  const started = project.status !== 'draft';

  return (
    <Page wide>
      <div className="mb-5">
        <Link href="/projects" className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
          <ArrowLeft className="size-3.5" /> {t('Dự án')}
        </Link>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[26px] leading-tight font-semibold tracking-tight">{project.name}</h1>
              <ProjectStatusBadge status={project.status} />
              {perm && <Badge color={perm.color}>{perm.label}</Badge>}
              {project.autopilot && <Badge color="#8A7DAE">{t('Tự động chuyển giai đoạn')}</Badge>}
              {project.floorId && (
                <Link href={`/office?floor=${project.floorId.replace('floor-', '')}`}>
                  <Badge color="#C4532A">{t('Tầng {n}', { n: project.floorId.replace('floor-', '') })}</Badge>
                </Link>
              )}
            </div>
            {project.goal && <p className="mt-1.5 max-w-3xl text-[14px] text-muted">{project.goal}</p>}
            <button type="button" onClick={openFolder} className="mt-2 inline-flex max-w-full items-center gap-1.5 font-mono text-[12px] text-subtle hover:text-accent">
              <FolderOpen className="size-3.5 shrink-0" />
              <span className="truncate">{project.path ?? t('Không gian làm việc riêng (chưa gắn thư mục)')}</span>
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {project.status === 'draft' && (
              <Button variant="primary" onClick={() => action('start')} loading={busy === 'start'} icon={<Rocket className="size-4" />}>
                {t('Khởi động')}
              </Button>
            )}
            {(project.status === 'active' || project.status === 'waiting_floor') && (
              <Button
                variant="outline"
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: t('Dừng dự án?'),
                    message: t('Mọi phòng đang làm sẽ ngừng ngay và tầng được trả lại. Bấm "Tiếp tục" để giao lại từ giai đoạn hiện tại – tài liệu và hội thoại vẫn giữ.'),
                    confirmLabel: t('Dừng dự án'),
                    tone: 'danger',
                  });
                  if (ok) action('stop');
                }}
                loading={busy === 'stop'}
                icon={<Pause className="size-4" />}
              >
                {t('Dừng')}
              </Button>
            )}
            {(project.status === 'paused' || project.status === 'blocked') && (
              <Button variant="primary" onClick={() => action('resume')} loading={busy === 'resume'} icon={<Play className="size-4" />}>
                {t('Tiếp tục')}
              </Button>
            )}
            {(project.status === 'completed' || project.status === 'cancelled') && (
              <Button variant="outline" onClick={() => action('start')} loading={busy === 'start'} icon={<RotateCcw className="size-4" />}>
                {t('Chạy lại từ đầu')}
              </Button>
            )}
            <Button variant="ghost" onClick={() => setEditing(true)} icon={<Pencil className="size-4" />}>
              {t('Cài đặt')}
            </Button>
            {started && project.status !== 'cancelled' && project.status !== 'completed' && (
              <Button
                variant="ghost"
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: t('Huỷ dự án?'),
                    message: t('Các nhiệm vụ đang chạy sẽ dừng và tầng đang làm được trả lại cho dự án khác.'),
                    confirmLabel: t('Huỷ dự án'),
                    cancelLabel: t('Không'),
                    tone: 'danger',
                  });
                  if (ok) action('cancel');
                }}
                icon={<Ban className="size-4" />}
              >
                {t('Hủy')}
              </Button>
            )}
            <Button variant="ghost" onClick={remove} icon={<Trash2 className="size-4" />} aria-label={t('Xóa dự án')} />
          </div>
        </div>
      </div>

      {project.status === 'waiting_floor' && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl border border-line bg-surface-2 px-4 py-3 text-[13px]">
          <Building2 className="mt-0.5 size-4 shrink-0 text-accent" />
          <div className="flex-1">
            {t('Cả 5 tầng đang bận.')} <b>{t('Dự án đang xếp hàng và sẽ tự chạy khi có tầng trống.')}</b>{' '}
            <Link href="/office?floor=tower" className="text-accent underline">
              {t('Xem toà nhà')}
            </Link>
          </div>
        </div>
      )}

      {project.blockedReason && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-[13px] text-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div className="flex-1">{project.blockedReason}</div>
        </div>
      )}

      <Card className="mb-5 p-4">
        <PhaseStepper project={project} workflow={workflow} departments={departments} />
        {phase && project.status !== 'completed' && (
          <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              {lead && <DeptAvatar icon={lead.icon} color={lead.color} busy={project.phaseState === 'working' && project.status === 'active'} />}
              <div className="min-w-0">
                <div className="text-[14px] font-semibold">
                  {t(phase.name)} <span className="font-normal text-muted">· {PHASE_STATE[project.phaseState]}</span>
                </div>
                <div className="text-[12.5px] text-muted">
                  {t('{name} chủ trì', { name: lead ? t(lead.name) : '' })} · {t('Đầu ra: {list}', { list: phase.outputs.map((o) => t(o)).join(', ') })}
                </div>
                {approvers.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px]">
                    <span className="text-subtle">{t('Phê duyệt:')}</span>
                    {approvers.map((a) => {
                      const ap = project.approvals[a._id];
                      const color = ap ? (ap.decision === 'approve' ? '#5C9A68' : '#C4483F') : '#958B7E';
                      return (
                        <span key={a._id} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ background: tint(color, 0.14), color }} title={ap?.notes}>
                          {ap ? (ap.decision === 'approve' ? <Check className="size-3" /> : <Undo2 className="size-3" />) : null}
                          {t(a.name).replace('Phòng ', '') /* i18n-ignore: bỏ tiền tố tên phòng tiếng Việt */}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            {started && project.status !== 'cancelled' && (
              <div className="flex flex-wrap gap-2">
                {project.phaseState === 'awaiting_user' && project.status !== 'blocked' ? (
                  <Button variant="primary" size="sm" onClick={() => action('advance')} loading={busy === 'advance'} icon={<SkipForward className="size-3.5" />}>
                    {workflow.phases[workflow.phases.length - 1]?.id === phase.id ? t('Hoàn tất dự án') : t('Chuyển giai đoạn')}
                  </Button>
                ) : project.phaseState === 'working' && project.status !== 'blocked' ? null : (
                  <Button
                    variant="success"
                    size="sm"
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: t('Duyệt giai đoạn "{name}"?', { name: t(phase.name) }),
                        message: t('Dự án sẽ chuyển sang giai đoạn tiếp theo ngay sau khi duyệt.'),
                        confirmLabel: t('Duyệt & chuyển tiếp'),
                        tone: 'success',
                      });
                      if (ok) action('approve_phase');
                    }}
                    loading={busy === 'approve_phase'}
                    icon={<Check className="size-3.5" />}
                  >
                    {t('Duyệt giai đoạn')}
                  </Button>
                )}
                {(project.phaseState !== 'working' || project.status === 'blocked') && (
                  <Button variant="outline" size="sm" onClick={() => setRejecting(true)} icon={<Undo2 className="size-3.5" />}>
                    {t('Yêu cầu làm lại')}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: t('Chạy lại giai đoạn này?'),
                      message: t('Các nhiệm vụ hiện tại của giai đoạn sẽ bị huỷ và giai đoạn bắt đầu lại từ đầu.'),
                      confirmLabel: t('Chạy lại'),
                      tone: 'danger',
                    });
                    if (ok) action('restart_phase');
                  }}
                  icon={<RotateCcw className="size-3.5" />}
                >
                  {t('Chạy lại giai đoạn')}
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      {approvals.length > 0 && (
        <div className="mb-5 space-y-3">
          <h3 className="text-[14px] font-semibold text-warn">{t('Cần bạn phê duyệt ({n})', { n: approvals.length })}</h3>
          <div className="grid gap-3 xl:grid-cols-2">
            {approvals.map((a) => (
              <ApprovalCard key={a._id} approval={a} department={departments.find((d) => d._id === a.departmentId)} />
            ))}
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented<Tab>
          value={tab}
          onChange={(v) => setQuery({ tab: v === 'chat' ? null : v })}
          options={[
            { value: 'chat', label: <span className="flex items-center gap-1.5"><MessageSquare className="size-3.5" />{t('Hội thoại')}</span> },
            { value: 'tasks', label: <span className="flex items-center gap-1.5"><ListChecks className="size-3.5" />{t('Nhiệm vụ')}</span>, count: openTasks || undefined },
            { value: 'artifacts', label: <span className="flex items-center gap-1.5"><FileText className="size-3.5" />{t('Tài liệu')}</span> },
            { value: 'files', label: <span className="flex items-center gap-1.5"><Folder className="size-3.5" />{t('Tệp')}</span> },
            { value: 'graph', label: <span className="flex items-center gap-1.5"><Network className="size-3.5" />{t('Bản đồ mã')}</span> },
          ]}
        />
        <span className="text-[12px] text-subtle">{t('Cập nhật {time}', { time: timeAgo(project.updatedAt) })}</span>
      </div>

      {tab === 'chat' && (
        <ChatPanel
          project={project}
          departments={departments}
          tasks={tasks}
          defaultDept={phase?.lead ?? 'director'}
          onOpenTask={(tid) => setQuery({ task: tid })}
        />
      )}
      {tab === 'tasks' && <TaskBoard tasks={tasks} departments={departments} onOpenTask={(tid) => setQuery({ task: tid })} />}
      {tab === 'artifacts' && <ArtifactsPanel projectId={id} departments={departments} />}
      {tab === 'files' && <FilesPanel projectId={id} />}
      {tab === 'graph' && <CodeGraphPanel projectId={id} />}

      {taskId && <TaskDrawer taskId={taskId} departments={departments} onClose={() => setQuery({ task: null })} onOpenTask={(tid) => setQuery({ task: tid })} />}
      {editing && <EditProjectModal project={project} open={editing} onClose={() => setEditing(false)} />}
      <RejectModal
        open={rejecting}
        onClose={() => setRejecting(false)}
        onSubmit={async (notes) => {
          await action('reject_phase', notes);
          setRejecting(false);
        }}
      />
    </Page>
  );
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense>
      <ProjectInner id={id} />
    </Suspense>
  );
}

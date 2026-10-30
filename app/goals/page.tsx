'use client';
// Mục tiêu dạng cây: mục tiêu công ty → nhóm → cá nhân → việc. Dự án gắn mục tiêu; agent nhận chuỗi mục tiêu ("vì sao") khi làm việc.
import { useState } from 'react';
import Link from 'next/link';
import useSWR, { mutate } from 'swr';
import clsx from 'clsx';
import { ChevronRight, Pencil, Plus, Target, Trash2 } from 'lucide-react';
import type { Department, Goal, GoalLevel, GoalStatus, ProjectStatus } from '@/lib/types';
import { PROJECT_STATUS } from '@/lib/catalog';
import { m, t } from '@/lib/i18n';
import { api } from '@/lib/client/api';
import { Page, PageHeader } from '@/components/shell';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Skeleton, Textarea, confirmDialog, toast } from '@/components/ui';

type GoalRow = Goal & { projects: { _id: string; name: string; status: ProjectStatus }[] };

const GOAL_LEVEL: Record<GoalLevel, { label: string; color: string }> = {
  company: { label: m('Công ty'), color: '#B8862B' },
  team: { label: m('Nhóm'), color: '#4A86BD' },
  agent: { label: m('Cá nhân'), color: '#5C9A68' },
  task: { label: m('Việc'), color: '#958B7E' },
};
const GOAL_STATUS: Record<GoalStatus, { label: string; color: string }> = {
  planned: { label: m('Dự kiến'), color: '#958B7E' },
  active: { label: m('Đang theo đuổi'), color: '#4A86BD' },
  achieved: { label: m('Đã đạt'), color: '#5C9A68' },
  cancelled: { label: m('Đã huỷ'), color: '#7A7268' },
};

function GoalEditor({ goal, parentId, goals, departments, onClose }: { goal?: GoalRow | null; parentId?: string | null; goals: GoalRow[]; departments: Department[]; onClose: () => void }) {
  const [form, setForm] = useState({
    title: goal?.title ?? '',
    description: goal?.description ?? '',
    level: goal?.level ?? (parentId ? 'team' : 'company'),
    status: goal?.status ?? 'active',
    parentId: goal?.parentId ?? parentId ?? '',
    ownerDepartmentId: goal?.ownerDepartmentId ?? '',
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...form, parentId: form.parentId || null, ownerDepartmentId: form.ownerDepartmentId || null };
      if (goal) await api.patch(`/api/goals/${goal._id}`, body);
      else await api.post('/api/goals', body);
      await mutate('/api/goals');
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={goal ? t('Sửa mục tiêu') : t('Thêm mục tiêu')}
      description={t('Mục tiêu đo lường được, vd: “Đạt 1.000 người dùng trả phí trong quý 4”.')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Huỷ')}
          </Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!form.title.trim()}>
            {t('Lưu')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('Tên mục tiêu')}>
          <Input autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label={t('Mô tả / cách đo')}>
          <Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Cấp')}>
            <Select value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value as GoalLevel })}>
              {Object.entries(GOAL_LEVEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {t(v.label)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('Trạng thái')}>
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as GoalStatus })}>
              {Object.entries(GOAL_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {t(v.label)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('Thuộc mục tiêu')}>
            <Select value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
              <option value="">{t('(mục tiêu gốc)')}</option>
              {goals
                .filter((g) => g._id !== goal?._id)
                .map((g) => (
                  <option key={g._id} value={g._id}>
                    {g.title}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t('Phòng phụ trách')}>
            <Select value={form.ownerDepartmentId} onChange={(e) => setForm({ ...form, ownerDepartmentId: e.target.value })}>
              <option value="">{t('(chưa giao)')}</option>
              {departments
                .filter((d) => d.enabled)
                .map((d) => (
                  <option key={d._id} value={d._id}>
                    {t(d.name)}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function GoalNode({ goal, all, depth, departments, onEdit, onAdd }: { goal: GoalRow; all: GoalRow[]; depth: number; departments: Department[]; onEdit: (g: GoalRow) => void; onAdd: (parentId: string) => void }) {
  const [open, setOpen] = useState(true);
  const kids = all.filter((g) => g.parentId === goal._id);
  const owner = departments.find((d) => d._id === goal.ownerDepartmentId);
  const remove = async () => {
    const ok = await confirmDialog({ title: t('Xoá mục tiêu?'), message: t('"{title}" sẽ bị xoá; mục tiêu con chuyển lên cấp trên.', { title: goal.title }), confirmLabel: t('Xoá'), tone: 'danger' });
    if (!ok) return;
    try {
      await api.del(`/api/goals/${goal._id}`);
      await mutate('/api/goals');
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div className={clsx(depth > 0 && 'ml-4 border-l border-line pl-4 sm:ml-6 sm:pl-5')}>
      <div className="group my-1.5 flex items-start gap-2 rounded-2xl border border-line bg-surface-solid/70 p-3">
        <button type="button" onClick={() => setOpen((o) => !o)} className={clsx('mt-0.5 rounded p-0.5 text-subtle', !kids.length && 'invisible')} aria-label={t('Mở/thu')}>
          <ChevronRight className={clsx('size-4 transition-transform', open && 'rotate-90')} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={clsx('text-[14.5px] font-semibold', goal.status === 'cancelled' && 'text-muted line-through')}>{goal.title}</span>
            <Badge color={GOAL_LEVEL[goal.level].color}>{t(GOAL_LEVEL[goal.level].label)}</Badge>
            <Badge color={GOAL_STATUS[goal.status].color} dot>
              {t(GOAL_STATUS[goal.status].label)}
            </Badge>
            {owner && <span className="text-[12px] text-muted">· {t(owner.name)}</span>}
          </div>
          {goal.description && <p className="mt-1 text-[13px] text-muted">{goal.description}</p>}
          {goal.projects.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {goal.projects.map((p) => (
                <Link key={p._id} href={`/projects/${p._id}`} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[12px] hover:border-line-strong">
                  <span className="size-1.5 rounded-full" style={{ background: PROJECT_STATUS[p.status].color }} />
                  {p.name}
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-0.5 opacity-60 group-hover:opacity-100">
          <Button size="xs" variant="ghost" onClick={() => onAdd(goal._id)} icon={<Plus className="size-3.5" />} aria-label={t('Thêm mục tiêu con')} />
          <Button size="xs" variant="ghost" onClick={() => onEdit(goal)} icon={<Pencil className="size-3.5" />} aria-label={t('Sửa')} />
          <Button size="xs" variant="ghost" onClick={remove} icon={<Trash2 className="size-3.5" />} aria-label={t('Xoá')} />
        </div>
      </div>
      {open && kids.map((k) => <GoalNode key={k._id} goal={k} all={all} depth={depth + 1} departments={departments} onEdit={onEdit} onAdd={onAdd} />)}
    </div>
  );
}

export default function GoalsPage() {
  const { data } = useSWR<GoalRow[]>('/api/goals');
  const { data: departments } = useSWR<Department[]>('/api/departments');
  const [editing, setEditing] = useState<{ goal?: GoalRow | null; parentId?: string | null } | null>(null);
  const goals = data ?? [];
  const roots = goals.filter((g) => !g.parentId || !goals.some((x) => x._id === g.parentId));
  return (
    <Page>
      <PageHeader
        eyebrow={t('Công ty')}
        title={t('Mục tiêu')}
        description={t('Mọi dự án và nhiệm vụ đều hướng về mục tiêu. Agent nhận chuỗi mục tiêu khi làm việc để hiểu “vì sao”.')}
        actions={
          <Button variant="primary" onClick={() => setEditing({ parentId: null })} icon={<Plus className="size-4" />}>
            {t('Thêm mục tiêu')}
          </Button>
        }
      />
      {!data ? (
        <Skeleton className="h-48" />
      ) : !goals.length ? (
        <Card>
          <EmptyState
            icon={<Target className="size-6" />}
            title={t('Chưa có mục tiêu')}
            description={t('Đặt một mục tiêu công ty đo lường được, rồi chia thành mục tiêu nhóm cho từng phòng.')}
            action={
              <Button variant="primary" onClick={() => setEditing({ parentId: null })} icon={<Plus className="size-4" />}>
                {t('Thêm mục tiêu công ty')}
              </Button>
            }
          />
        </Card>
      ) : (
        <div>
          {roots.map((g) => (
            <GoalNode key={g._id} goal={g} all={goals} depth={0} departments={departments ?? []} onEdit={(x) => setEditing({ goal: x })} onAdd={(pid) => setEditing({ parentId: pid })} />
          ))}
        </div>
      )}
      {editing && <GoalEditor goal={editing.goal} parentId={editing.parentId} goals={goals} departments={departments ?? []} onClose={() => setEditing(null)} />}
    </Page>
  );
}

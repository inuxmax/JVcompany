'use client';
import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR, { mutate } from 'swr';
import clsx from 'clsx';
import { ArrowRight, Box, Building2, CheckCircle2, MessagesSquare, Plus, RotateCcw, Save, Send, Settings2, ShieldCheck, Trash2, UserRound, Users } from 'lucide-react';
import type { Department, Effort, FloorView, ModelTier, PermissionLevel, Project, Provider, QueuedProject, Task, Workflow } from '@/lib/types';
import { DEPARTMENT_ICONS, PHASE_STATE, TASK_STATUS, EFFORT_LEVELS, MODEL_TIERS, PERMISSION_LEVELS, PROVIDER_KIND_LABEL, findPhase, getPreset, liveModels, resolveModel } from '@/lib/catalog';
import { ModelPicker } from '@/components/model-picker';
import { api } from '@/lib/client/api';
import { tint, timeAgo } from '@/lib/client/format';
import { formatNumber, getLocale, t } from '@/lib/i18n';
import { Page, PageHeader } from '@/components/shell';
import {
  Badge,
  Button,
  Card,
  DeptAvatar,
  DeptIcon,
  Drawer,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  Segmented,
  Select,
  Skeleton,
  Switch,
  Textarea,
  confirmDialog,
  toast,
} from '@/components/ui';
import { TaskStatusBadge, WaitingLimitNote } from '@/components/domain';
import { BuildingLegend, OfficeView } from '@/components/office-view';
import { OfficeChat } from '@/components/office-chat';
import type { BuildingViewMode } from '@/components/building';
import { floorOwnership } from '@/components/building/ownership';

type DeptRow = Department & { activeTasks: Task[]; doneCount: number };

/** Tên tầng giữa câu: tiếng Việt viết thường ("giám đốc tầng 1"); ngôn ngữ khác dùng tên đã dịch. */
function floorInline(name: string): string {
  return getLocale() === 'vi' ? name.toLowerCase() : t(name);
}

function resolvedProvider(d: Department, providers: Provider[], defaultId: string | null): { provider: Provider | null; auto: boolean } {
  const enabled = providers.filter((p) => p.enabled);
  if (d.providerId) return { provider: enabled.find((p) => p._id === d.providerId) ?? null, auto: false };
  for (const type of d.preferredProviderTypes) {
    const p = enabled.find((x) => x.type === type && x.kind !== 'manual');
    if (p) return { provider: p, auto: true };
  }
  const def = enabled.find((p) => p._id === defaultId) ?? enabled.find((p) => p.kind !== 'manual') ?? enabled[0] ?? null;
  return { provider: def, auto: true };
}

function modelFor(d: Department, p: Provider | null): string {
  return p ? resolveModel(d, p) : '';
}

function DeptCard({ d, all, providers, defaultId, onOpen }: { d: DeptRow; all: DeptRow[]; providers: Provider[]; defaultId: string | null; onOpen: () => void }) {
  const running = d.activeTasks.find((tk) => tk.status === 'running');
  const { provider, auto } = resolvedProvider(d, providers, defaultId);
  const model = modelFor(d, provider);
  const targets = all.filter((x) => d.canDelegateTo.includes(x._id));
  return (
    <div className="group/card relative min-w-0">
      <button
        type="button"
        onClick={onOpen}
        className={clsx(
          'group glass relative flex h-full w-full flex-col overflow-hidden rounded-[26px] p-5 text-left transition-all hover:-translate-y-0.5 hover:border-line-strong',
          !d.enabled && 'opacity-55',
          running ? 'border-transparent' : 'border-line',
        )}
        style={running ? { boxShadow: `0 0 0 1px ${tint(d.color, 0.5)}, 0 12px 40px -18px ${tint(d.color, 0.6)}` } : undefined}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-20 opacity-70" style={{ background: `linear-gradient(180deg, ${tint(d.color, 0.12)}, transparent)` }} />
        <div className="relative flex items-start gap-3">
          <DeptAvatar icon={d.icon} color={d.color} size="lg" busy={Boolean(running)} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-[15px] font-semibold" style={{ color: d.color }}>
                {t(d.name)}
              </h3>
              {d.canApprove && <ShieldCheck className="size-3.5 shrink-0 text-subtle" aria-label={t('Có quyền phê duyệt')} />}
            </div>
            <div className="truncate text-[12.5px] text-muted">{t(d.title)}</div>
          </div>
        </div>
        <p className="relative mt-3 line-clamp-2 min-h-[40px] text-[13px] text-muted">{t(d.description)}</p>

        <div className="relative mt-3 rounded-2xl border border-line bg-surface-2 px-3 py-2 text-[12.5px]">
          {running ? (
            <div className="flex items-center gap-2">
              <span className="size-1.5 shrink-0 animate-jv-pulse rounded-full" style={{ background: d.color }} />
              <span className="truncate">{t('Đang làm: {title}', { title: running.title })}</span>
            </div>
          ) : d.activeTasks.length ? (
            <div className="text-muted">{t('{n} nhiệm vụ đang chờ', { n: d.activeTasks.length })}</div>
          ) : (
            <div className="text-subtle">{t('Đang rảnh · {n} việc đã xong', { n: d.doneCount })}</div>
          )}
        </div>

        <div className="relative mt-3 flex items-center justify-between gap-2">
          <div className="min-w-0 text-[12px]">
            {provider ? (
              <div className="flex items-center gap-1.5">
                <span className="size-2 shrink-0 rounded-full" style={{ background: getPreset(provider.type).color }} />
                <span className="truncate font-medium">{provider.name}</span>
              </div>
            ) : (
              <span className="text-danger">{t('Chưa có kết nối AI')}</span>
            )}
            <div className="truncate text-subtle">
              {auto ? `${t('Tự động')} · ` : ''}
              {model || t('model mặc định')}
            </div>
          </div>
          {targets.length > 0 && (
            <div className="flex shrink-0 items-center gap-1" title={t('Giao việc cho: {names}', { names: targets.map((x) => t(x.name)).join(', ') })}>
              <ArrowRight className="size-3 text-subtle" />
              <div className="flex -space-x-1.5">
                {targets.slice(0, 4).map((x) => (
                  <span
                    key={x._id}
                    className="flex size-6 items-center justify-center rounded-full ring-2 ring-surface"
                    style={{ background: tint(x.color, 0.25), color: x.color }}
                  >
                    <DeptIcon name={x.icon} className="size-3" />
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </button>
      <IconButton
        label={t('Xoá {name}', { name: t(d.name) })}
        onClick={() => void removeDepartment(d)}
        className="absolute top-3 right-3 bg-[var(--surface-solid)]/85 opacity-0 shadow-sm group-hover/card:opacity-100 hover:text-danger focus-visible:opacity-100 max-sm:opacity-100"
      >
        <Trash2 className="size-4" />
      </IconButton>
    </div>
  );
}

/** Xoá phòng ban (khỏi cả 5 tầng). Trả về true nếu đã xoá. */
async function removeDepartment(d: Pick<Department, '_id' | 'name'>): Promise<boolean> {
  const ok = await confirmDialog({
    title: t('Xoá {name}?', { name: t(d.name) }),
    message: t('Vị trí này sẽ biến mất khỏi cả 5 tầng. Các nhiệm vụ cũ vẫn được giữ lại.'),
    confirmLabel: t('Xoá phòng ban'),
    tone: 'danger',
  });
  if (!ok) return false;
  try {
    await api.del(`/api/departments/${d._id}`);
    await mutate('/api/departments');
    toast.success(t('Đã xoá {name}', { name: t(d.name) }));
    return true;
  } catch (e) {
    toast.error(e);
    return false;
  }
}

type Tab = 'profile' | 'ai' | 'prompt' | 'permissions' | 'tasks';

/** Chỉ so sánh các trường cấu hình (bỏ dữ liệu hoạt động thay đổi liên tục). */
function editable(d: Department): string {
  const { activeTasks: _a, doneCount: _d, updatedAt: _u, createdAt: _c, ...rest } = d as DeptRow;
  void _a;
  void _d;
  void _u;
  void _c;
  return JSON.stringify(rest);
}

function DeptEditor({ dept, all, providers, defaultId, onClose }: { dept: DeptRow; all: DeptRow[]; providers: Provider[]; defaultId: string | null; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('profile');
  const [form, setForm] = useState<Department>(dept);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof Department>(k: K, v: Department[K]) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = editable(form) !== editable(dept);
  const selected = providers.find((p) => p._id === form.providerId) ?? null;
  const effective = resolvedProvider(form, providers, defaultId);
  const modelOptions = Array.from(new Set([...(effective.provider?.models ?? []), ...(effective.provider ? getPreset(effective.provider.type).models : [])]));

  const save = async () => {
    setSaving(true);
    try {
      const { activeTasks: _a, doneCount: _d, ...payload } = form as DeptRow;
      void _a;
      void _d;
      await api.patch(`/api/departments/${dept._id}`, payload);
      await mutate('/api/departments');
      toast.success(t('Đã lưu cấu hình phòng ban'));
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    const ok = await confirmDialog({
      title: t('Khôi phục mặc định?'),
      message: t('Prompt, mô tả và quyền của phòng này sẽ trở về cấu hình gốc.'),
      confirmLabel: t('Khôi phục'),
    });
    if (!ok) return;
    try {
      const d = await api.patch<Department>(`/api/departments/${dept._id}`, { reset: true });
      setForm({ ...form, ...d });
      await mutate('/api/departments');
      toast.success(t('Đã khôi phục mặc định'));
    } catch (e) {
      toast.error(e);
    }
  };

  const remove = async () => {
    if (await removeDepartment(dept)) onClose();
  };

  return (
    <Drawer
      open
      onClose={onClose}
      width="max-w-3xl"
      title={
        <div className="flex items-center gap-3">
          <DeptAvatar icon={form.icon} color={form.color} />
          <div className="min-w-0">
            <div className="truncate">{t(form.name)}</div>
            <div className="truncate text-[12.5px] font-normal text-muted">{t(form.title)}</div>
          </div>
        </div>
      }
      subtitle={t('Thiết lập chung – áp dụng cho cả 5 tầng')}
      actions={
        <>
          <IconButton label={t('Xoá phòng ban')} onClick={remove} className="hover:text-danger">
            <Trash2 className="size-4" />
          </IconButton>
          <Button variant="primary" size="sm" onClick={save} loading={saving} disabled={!dirty} icon={<Save className="size-4" />}>
            {t('Lưu')}
          </Button>
        </>
      }
    >
      <div className="sticky top-0 z-10 border-b border-line bg-surface/95 px-5 py-3 backdrop-blur">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'profile', label: t('Hồ sơ') },
            { value: 'ai', label: t('AI & Mô hình') },
            { value: 'prompt', label: t('Prompt vị trí') },
            { value: 'permissions', label: t('Quyền & Giao việc') },
            { value: 'tasks', label: t('Nhiệm vụ'), count: dept.activeTasks.length },
          ]}
        />
      </div>

      <div className="space-y-5 px-5 py-5">
        {tab === 'profile' && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('Tên phòng ban')} required>
                <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
              </Field>
              <Field label={t('Vị trí / chức danh')}>
                <Input value={form.title} onChange={(e) => set('title', e.target.value)} />
              </Field>
            </div>
            <Field label={t('Mô tả')}>
              <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} className="min-h-[72px]" />
            </Field>
            <Field label={t('Trách nhiệm chính')} hint={t('Mỗi dòng một trách nhiệm.')}>
              <Textarea
                value={form.responsibilities.join('\n')}
                onChange={(e) => set('responsibilities', e.target.value.split('\n'))}
                onBlur={(e) =>
                  set(
                    'responsibilities',
                    e.target.value
                      .split('\n')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  )
                }
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
              <Field label={t('Biểu tượng')}>
                <div className="flex flex-wrap gap-1.5">
                  {DEPARTMENT_ICONS.map((ic) => (
                    <button
                      key={ic}
                      type="button"
                      onClick={() => set('icon', ic)}
                      className={clsx(
                        'flex size-9 items-center justify-center rounded-lg border transition-colors',
                        form.icon === ic ? 'border-accent bg-accent/10 text-accent' : 'border-line text-muted hover:text-fg',
                      )}
                      aria-label={ic}
                    >
                      <DeptIcon name={ic} className="size-4" />
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={t('Màu')}>
                <input
                  type="color"
                  value={form.color}
                  onChange={(e) => set('color', e.target.value.toUpperCase())}
                  className="h-10 w-20 cursor-pointer rounded-xl border border-line-strong bg-transparent p-1"
                />
              </Field>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-line p-3">
              <div>
                <div className="text-[13.5px] font-medium">{t('Phòng đang hoạt động')}</div>
                <div className="text-[12.5px] text-muted">{t('Tắt để không nhận nhiệm vụ mới.')}</div>
              </div>
              <Switch checked={form.enabled} onChange={(v) => set('enabled', v)} />
            </div>
          </>
        )}

        {tab === 'ai' && (
          <>
            <Field label={t('Kết nối AI')} hint={t('“Tự động” sẽ dùng kết nối phù hợp nhất theo thứ tự ưu tiên của phòng, rồi tới kết nối mặc định.')}>
              <Select value={form.providerId ?? ''} onChange={(e) => set('providerId', e.target.value || null)}>
                <option value="">{t('Tự động ({name})', { name: effective.auto && effective.provider ? effective.provider.name : t('chưa có') })}</option>
                {providers.map((p) => (
                  <option key={p._id} value={p._id} disabled={!p.enabled}>
                    {p.name} · {t(PROVIDER_KIND_LABEL[p.kind])}
                    {!p.enabled ? ` (${t('đang tắt')})` : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('Hạng mô hình')} hint={t('Mỗi kết nối tự ánh xạ sang model cụ thể (ví dụ Claude: Opus / Sonnet / Haiku).')}>
              <Segmented<ModelTier> value={form.tier} onChange={(v) => set('tier', v)} options={MODEL_TIERS.map((tier) => ({ value: tier.id, label: t(tier.label) }))} />
            </Field>
            <Field
              label={t('Model cụ thể (tùy chọn)')}
              hint={
                effective.provider
                  ? t('Đang dùng: {model}. Danh sách lấy từ trang Kết nối AI (bấm "Kiểm tra" để cập nhật).', { model: modelFor(form, effective.provider) || '—' })
                  : t('Chưa có kết nối nào.')
              }
            >
              <ModelPicker
                value={form.model}
                onChange={(v) => set('model', v.trim())}
                live={effective.provider ? liveModels(effective.provider) : []}
                suggested={modelOptions}
                emptyLabel={t('Theo hạng ({model})', { model: modelFor({ ...form, model: '' }, effective.provider) || '—' })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('Mức nỗ lực suy luận')} hint={t('Áp dụng cho Claude API (effort).')}>
                <Select value={form.effort} onChange={(e) => set('effort', e.target.value as Effort)}>
                  {EFFORT_LEVELS.map((e) => (
                    <option key={e.id} value={e.id}>
                      {t(e.label)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('Số lượt công cụ tối đa / nhiệm vụ')}>
                <Input type="number" min={3} max={200} value={form.maxTurns} onChange={(e) => set('maxTurns', Number(e.target.value) || 30)} />
              </Field>
            </div>
            <Field label={t('Kết nối dự phòng')} hint={t('Khi kết nối chính hết hạn mức, nhiệm vụ tự chuyển sang các kết nối này theo thứ tự.')}>
              <div className="space-y-1.5">
                {providers.length === 0 && <div className="text-[13px] text-muted">{t('Chưa có kết nối nào.')}</div>}
                {providers
                  .filter((p) => p._id !== form.providerId)
                  .map((p) => {
                    const on = form.fallbackProviderIds.includes(p._id);
                    return (
                      <label key={p._id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-line px-3 py-2 hover:bg-surface-2">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => set('fallbackProviderIds', on ? form.fallbackProviderIds.filter((x) => x !== p._id) : [...form.fallbackProviderIds, p._id])}
                          className="size-4 accent-[var(--accent)]"
                        />
                        <span className="flex-1 text-[13px]">{p.name}</span>
                        <span className="text-[11.5px] text-subtle">{t(PROVIDER_KIND_LABEL[p.kind])}</span>
                      </label>
                    );
                  })}
              </div>
            </Field>
            {selected && !selected.enabled && <div className="text-[13px] text-warn">{t('Kết nối đã chọn đang bị tắt.')}</div>}
          </>
        )}

        {tab === 'prompt' && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="max-w-xl text-[13px] text-muted">
                {t('Prompt chuẩn của vị trí này. Hệ thống tự bổ sung sơ đồ tổ chức, môi trường, quyền hạn, bối cảnh dự án và cách nộp kết quả.')}
              </p>
              <Button variant="outline" size="sm" onClick={reset} icon={<RotateCcw className="size-3.5" />}>
                {t('Khôi phục mặc định')}
              </Button>
            </div>
            <Textarea
              value={form.systemPrompt}
              onChange={(e) => set('systemPrompt', e.target.value)}
              className="min-h-[520px] font-mono text-[12.5px] leading-relaxed"
              spellCheck={false}
            />
            <div className="text-right text-[12px] text-subtle">{t('{n} ký tự', { n: formatNumber(form.systemPrompt.length) })}</div>
          </>
        )}

        {tab === 'permissions' && (
          <>
            <Field label={t('Quyền tối đa của phòng')} hint={t('Quyền thực tế = mức thấp hơn giữa quyền của dự án và quyền tối đa này.')}>
              <div className="grid gap-2 sm:grid-cols-2">
                {PERMISSION_LEVELS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => set('maxPermission', p.id as PermissionLevel)}
                    className={clsx(
                      'rounded-xl border p-3 text-left transition-colors',
                      form.maxPermission === p.id ? 'border-transparent ring-2' : 'border-line hover:border-line-strong',
                    )}
                    style={form.maxPermission === p.id ? { background: tint(p.color, 0.08), boxShadow: `0 0 0 2px ${p.color}` } : undefined}
                  >
                    <div className="text-[13.5px] font-semibold" style={{ color: p.color }}>
                      {t(p.label)}
                    </div>
                    <div className="mt-0.5 text-[12px] text-muted">{t(p.description)}</div>
                  </button>
                ))}
              </div>
            </Field>
            <div className="flex items-center justify-between rounded-xl border border-line p-3">
              <div>
                <div className="text-[13.5px] font-medium">{t('Có quyền phê duyệt giai đoạn')}</div>
                <div className="text-[12.5px] text-muted">{t('Dùng trong các giai đoạn yêu cầu phòng này duyệt.')}</div>
              </div>
              <Switch checked={form.canApprove} onChange={(v) => set('canApprove', v)} />
            </div>
            <Field label={t('Được giao việc cho')} hint={t('Agent của phòng này chỉ có thể giao nhiệm vụ cho các phòng được chọn.')}>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {all
                  .filter((x) => x._id !== form._id)
                  .map((x) => {
                    const on = form.canDelegateTo.includes(x._id);
                    return (
                      <label key={x._id} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line px-3 py-2 hover:bg-surface-2">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => set('canDelegateTo', on ? form.canDelegateTo.filter((y) => y !== x._id) : [...form.canDelegateTo, x._id])}
                          className="size-4 accent-[var(--accent)]"
                        />
                        <DeptAvatar icon={x.icon} color={x.color} size="sm" />
                        <span className="truncate text-[13px]">{t(x.name)}</span>
                      </label>
                    );
                  })}
              </div>
            </Field>
            <div className="border-t border-line pt-4">
              <Button variant="danger" size="sm" onClick={remove} icon={<Trash2 className="size-3.5" />}>
                {t('Xóa phòng ban')}
              </Button>
            </div>
          </>
        )}

        {tab === 'tasks' &&
          (dept.activeTasks.length === 0 ? (
            <EmptyState icon={<CheckCircle2 className="size-5" />} title={t('Không có nhiệm vụ đang mở')} description={t('{n} nhiệm vụ đã hoàn thành.', { n: dept.doneCount })} />
          ) : (
            <div className="space-y-2">
              {dept.activeTasks.map((tk) => (
                <a key={tk._id} href={`/projects/${tk.projectId}?task=${tk._id}`} className="block rounded-xl border border-line p-3 hover:bg-surface-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13.5px] font-medium">{tk.title}</span>
                    <TaskStatusBadge status={tk.status} />
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[12px] text-subtle">
                    <span>{t('tạo {time}', { time: timeAgo(tk.createdAt) })}</span>
                    <WaitingLimitNote task={tk} />
                  </div>
                </a>
              ))}
            </div>
          ))}
      </div>
    </Drawer>
  );
}

function NewDeptModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const d = await api.post<Department>('/api/departments', { name, title, description });
      await mutate('/api/departments');
      onCreated(d._id);
      setName('');
      setTitle('');
      setDescription('');
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
      title={t('Thêm phòng ban')}
      description={t('Ví dụ: Phòng Marketing, Phòng Dữ liệu, Phòng Pháp chế…')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Hủy')}
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!name.trim()}>
            {t('Tạo phòng')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('Tên phòng')} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Phòng Marketing')} autoFocus />
        </Field>
        <Field label={t('Vị trí / chức danh')}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('Trưởng phòng Marketing')} />
        </Field>
        <Field label={t('Mô tả')}>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('Phụ trách chiến lược tiếp thị, nội dung…')} />
        </Field>
      </div>
    </Modal>
  );
}

function FloorPanel({
  floor,
  floors,
  queue,
  depts,
  workflows,
  onPickFloor,
  onOpenDept,
  onAssign,
  onOpenStaff,
}: {
  floor: FloorView | null;
  floors: FloorView[];
  queue: QueuedProject[];
  depts: DeptRow[];
  workflows?: Workflow[];
  onPickFloor: (n: number) => void;
  onOpenDept: (id: string) => void;
  onAssign: () => void;
  onOpenStaff: () => void;
}) {
  if (!floor) {
    return (
      <div className="p-5">
        <h3 className="text-[16px] font-semibold">{t('Toà nhà 5 tầng')}</h3>
        <p className="mt-1 text-[12.5px] text-muted">{t('Mỗi tầng nhận trọn một dự án. Hết tầng trống thì dự án mới xếp hàng.')}</p>
        <div className="mt-4 space-y-1.5">
          {floors.map((f) => (
            <button key={f._id} type="button" onClick={() => onPickFloor(f.number)} className="flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left hover:bg-surface-3">
              <span
                className={clsx(
                  'flex size-8 items-center justify-center rounded-xl font-display font-semibold',
                  f.project ? 'bg-accent text-accent-fg' : 'bg-surface-3 text-muted',
                )}
              >
                {f.number}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium">{f.project ? f.project.name : f.enabled ? t('Trống') : t('Đang tắt')}</span>
                <span className="block truncate text-[12px] text-muted">{f.project ? t(PHASE_STATE[f.project.phaseState]) : t('Sẵn sàng nhận dự án')}</span>
              </span>
            </button>
          ))}
        </div>
        <QueueList queue={queue} />
      </div>
    );
  }
  const projectId = floor.project?._id ?? null;
  const phase = findPhase(workflows, floor.project?.currentPhase);
  // Việc hiện ở tầng này: của dự án trên tầng + việc không thuộc tầng nào (chat trực tiếp, việc chung công ty…)
  const { owns, hostsFloating } = floorOwnership(floor, floors, depts);
  return (
    <div className="p-5">
      <div className="flex items-center gap-3">
        <span
          className={clsx(
            'flex size-10 items-center justify-center rounded-2xl font-display text-[18px] font-semibold',
            projectId ? 'bg-accent text-accent-fg' : 'bg-surface-3 text-muted',
          )}
        >
          {floor.number}
        </span>
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold">{t(floor.name)}</h3>
          <div className="truncate text-[12.5px] text-muted">
            {projectId ? t('Đang làm dự án') : hostsFloating ? t('Đang xử lý việc trực tiếp / việc chung') : floor.enabled ? t('Trống – nhân viên đang nghỉ') : t('Tầng đang tắt')}
          </div>
        </div>
      </div>
      {floor.project && (
        <Link href={`/projects/${floor.project._id}`} className="mt-4 block rounded-2xl border border-line bg-surface-2 px-3.5 py-3 hover:border-line-strong">
          <div className="truncate text-[14px] font-semibold">{floor.project.name}</div>
          <div className="text-[12px] text-muted">
            {phase ? t('Giai đoạn {name}', { name: t(phase.name) }) : ''} · {t(PHASE_STATE[floor.project.phaseState])}
          </div>
        </Link>
      )}
      <div className="mt-4 rounded-2xl border border-accent/30 bg-accent/5 p-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-fg">
            <UserRound className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold">{t('Bạn · CEO')}</div>
            <div className="truncate text-[11.5px] text-muted">{floor.project ? t('Nhắn giám đốc tầng giao thêm việc') : t('Tầng đang trống – giao dự án cho tầng này')}</div>
          </div>
        </div>
        <Button size="sm" variant="primary" className="mt-2.5 w-full" onClick={onAssign} icon={<Send className="size-3.5" />} disabled={!floor.enabled}>
          {floor.project ? t('Nhắn giám đốc tầng') : t('Giao dự án cho {floor}', { floor: t(floor.name) })}
        </Button>
      </div>
      <div className="mt-4 mb-2 flex items-center justify-between gap-2">
        <span className="text-[11.5px] font-semibold tracking-wider text-subtle uppercase">{t('Nhân sự · chung cho 5 tầng')}</span>
        <button type="button" onClick={onOpenStaff} className="flex items-center gap-1 text-[12px] text-muted hover:text-fg">
          <Settings2 className="size-3.5" />
          {t('Thiết lập')}
        </button>
      </div>
      <div className="space-y-1">
        {depts
          .filter((d) => d.enabled)
          .map((d) => {
            const tasks = d.activeTasks.filter((tk) => owns(tk.projectId));
            const running = tasks.find((tk) => tk.status === 'running');
            const top = running ?? tasks[0];
            return (
              <button key={d._id} type="button" onClick={() => onOpenDept(d._id)} className="flex w-full items-center gap-2.5 rounded-2xl px-2 py-1.5 text-left hover:bg-surface-3">
                <DeptAvatar icon={d.icon} color={d.color} size="sm" busy={Boolean(running)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{d._id === 'director' ? t('Giám đốc {floor}', { floor: floorInline(floor.name) }) : t(d.name)}</span>
                  <span className="block truncate text-[11.5px] text-muted">{top ? `${t(TASK_STATUS[top.status].label)}: ${top.title}` : t('Rảnh')}</span>
                </span>
              </button>
            );
          })}
      </div>
      <QueueList queue={queue} />
    </div>
  );
}

/** Đầu khu Nhân sự: giải thích thiết lập chung + các vai trò cố định. */
function StaffIntro({ count }: { count: number }) {
  const fixed = [
    { name: t('Bạn · CEO'), note: t('Đi thang máy giữa các tầng, giao dự án, nhắn giám đốc tầng') },
    { name: t('CEO tổng (AI)'), note: t('Tự đi thăm các tầng đang làm dự án') },
    { name: t('Lễ tân'), note: t('Trực sảnh mỗi tầng') },
    { name: t('Giám đốc tầng'), note: t('Chính là phòng Giám Đốc – chủ trì họp, giao việc') },
  ];
  return (
    <Card className="mb-5 p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-surface-3 text-accent">
          <Users className="size-5" />
        </span>
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold">{t('Nhân sự chung cho cả 5 tầng')}</h3>
          <p className="mt-0.5 text-[13px] text-muted">
            {t('Mỗi tầng có cùng các vị trí bên dưới (mỗi phòng một người). Sửa, thêm hay xoá ở đây là áp dụng cho mọi tầng – không cần thiết lập từng tầng.')}
            {count > 8 && ` ${t('Mỗi tầng có 8 khu bàn; phòng thứ 9 trở đi làm việc ở sofa/ghế lười.')}`}
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {fixed.map((f) => (
          <div key={f.name} className="rounded-2xl border border-line bg-surface-2/60 px-3 py-2">
            <div className="text-[13px] font-medium">{f.name}</div>
            <div className="text-[12px] text-muted">{f.note}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Bạn (CEO) giao việc cho một tầng: tầng trống → giao dự án; tầng đang làm → nhắn giám đốc tầng. */
function AssignModal({ floor, depts, onClose, onAssigned }: { floor: FloorView; depts: DeptRow[]; onClose: () => void; onAssigned: () => void }) {
  const project = floor.project;
  const { data: projects } = useSWR<Project[]>(project ? null : '/api/projects');
  const candidates = (projects ?? []).filter((p) => !p.floorId && (p.status === 'draft' || p.status === 'waiting_floor' || p.status === 'paused'));
  const [pick, setPick] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const director = depts.find((d) => d._id === 'director' && d.enabled) ?? depts.find((d) => d.enabled);
  const chosen = candidates.find((p) => p._id === pick) ?? null;

  const submit = async () => {
    setBusy(true);
    try {
      if (project) {
        if (!director) throw new Error(t('Chưa có phòng ban nào để nhận tin nhắn.'));
        await api.post(`/api/projects/${project._id}/messages`, { departmentId: director._id, content: text.trim() });
        toast.success(t('Đã gửi cho giám đốc {floor}', { floor: floorInline(floor.name) }));
      } else {
        if (!chosen) return;
        const r = await api.post<Project>(`/api/projects/${chosen._id}/action`, { action: chosen.status === 'draft' ? 'start' : 'resume', floorId: floor._id });
        await mutate('/api/floors');
        if (r.floorId === floor._id) toast.success(t('Đã giao "{name}" cho {floor}', { name: chosen.name, floor: t(floor.name) }));
        else if (r.floorId) toast.success(t('{floor} vừa có việc khác – "{name}" chuyển sang tầng {n}', { floor: t(floor.name), name: chosen.name, n: r.floorId.replace('floor-', '') }));
        else toast.success(t('"{name}" đang xếp hàng chờ tầng trống', { name: chosen.name }));
      }
      onAssigned();
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
      title={project ? t('Nhắn giám đốc {floor}', { floor: floorInline(floor.name) }) : t('Giao dự án cho {floor}', { floor: t(floor.name) })}
      description={
        project
          ? t('Tầng đang làm "{project}". Tin nhắn gửi tới {name} để giao thêm việc hoặc đổi hướng.', { project: project.name, name: director ? t(director.name) : t('giám đốc tầng') })
          : t('Chọn một dự án đang chờ – tầng này nhận và bắt đầu ngay, bạn sẽ lên phòng họp giao việc.')
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Hủy')}
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={project ? !text.trim() : !chosen} icon={<Send className="size-4" />}>
            {project ? t('Gửi') : t('Giao việc')}
          </Button>
        </>
      }
    >
      {project ? (
        <Field label={t('Nội dung')}>
          <Textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Ví dụ: Ưu tiên làm trang đăng nhập trước, báo cáo tiến độ cuối ngày.')} />
        </Field>
      ) : !projects ? (
        <Skeleton className="h-28" />
      ) : candidates.length === 0 ? (
        <EmptyState
          title={t('Chưa có dự án nào đang chờ')}
          description={t('Tạo dự án mới rồi giao cho tầng này.')}
          action={
            <Link href="/projects/new" className="text-[13px] font-medium text-accent underline">
              {t('Tạo dự án mới')}
            </Link>
          }
        />
      ) : (
        <div className="space-y-1.5">
          {candidates.map((p) => (
            <label
              key={p._id}
              className={clsx(
                'flex cursor-pointer items-center gap-3 rounded-2xl border px-3 py-2.5',
                pick === p._id ? 'border-accent bg-accent/5' : 'border-line hover:bg-surface-2',
              )}
            >
              <input type="radio" name="assign-project" checked={pick === p._id} onChange={() => setPick(p._id)} className="size-4 accent-[var(--accent)]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium">{p.name}</span>
                <span className="block truncate text-[12px] text-muted">
                  {p.status === 'draft' ? t('Bản nháp – chưa chạy') : p.status === 'waiting_floor' ? t('Đang chờ tầng trống') : t('Đang tạm dừng')}
                </span>
              </span>
            </label>
          ))}
          <Link href="/projects/new" className="mt-2 inline-block text-[12.5px] text-muted underline hover:text-fg">
            {t('Hoặc tạo dự án mới')}
          </Link>
        </div>
      )}
    </Modal>
  );
}

function QueueList({ queue }: { queue: QueuedProject[] }) {
  if (!queue.length) return null;
  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="mb-2 text-[11.5px] font-semibold tracking-wider text-subtle uppercase">{t('Hàng chờ tầng trống ({n})', { n: queue.length })}</div>
      {queue.map((q) => (
        <Link key={q._id} href={`/projects/${q._id}`} className="flex items-center gap-2 rounded-xl px-2 py-1 text-[13px] hover:bg-surface-3">
          <span className="text-subtle">#{q.position}</span>
          <span className="truncate">{q.name}</span>
        </Link>
      ))}
    </div>
  );
}

// Cuộc trò chuyện đang mở – nhớ trong trình duyệt để chuyển trang rồi quay lại vẫn thấy đúng cuộc đó.
const LAST_THREAD_KEY = 'jv.chatThread';
function readLastThread(): string | null {
  try {
    return localStorage.getItem(LAST_THREAD_KEY);
  } catch {
    return null;
  }
}
function writeLastThread(id: string | null) {
  try {
    if (id) localStorage.setItem(LAST_THREAD_KEY, id);
    else localStorage.removeItem(LAST_THREAD_KEY);
  } catch {
    /* trình duyệt chặn lưu – chỉ nhớ trong phiên này */
  }
}

function OfficeInner() {
  const router = useRouter();
  const params = useSearchParams();
  const openId = params.get('dept');
  const { data: depts } = useSWR<DeptRow[]>('/api/departments');
  const { data: prov } = useSWR<{ providers: Provider[]; defaultProviderId: string | null }>('/api/providers');
  const { data: building } = useSWR<{ floors: FloorView[]; queue: QueuedProject[] }>('/api/floors');
  const { data: workflows } = useSWR<Workflow[]>('/api/workflows');
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [presentUntil, setPresentUntil] = useState(0);
  const [panel, setPanel] = useState<'chat' | 'floor'>('chat');
  const savedChatW = useSyncExternalStore(subscribeChatW, readChatW, () => CHAT_W_DEFAULT);
  const [dragW, setDragW] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const chatW = dragW ?? savedChatW;
  const maxChatW = () => (gridRef.current?.getBoundingClientRect().width ?? 1600) * 0.7;
  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return;
    const move = (ev: PointerEvent) => {
      const w = Math.min(Math.max(rect.right - ev.clientX - 12, CHAT_W_MIN), rect.width * 0.7);
      dragRef.current = w;
      setDragW(w);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (dragRef.current) writeChatW(dragRef.current);
      dragRef.current = null;
      setDragW(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  const chatWide = chatW > 760;
  const toggleChatWide = () => writeChatW(chatWide ? CHAT_W_DEFAULT : Math.max(860, maxChatW() * 0.75));
  // Gom các thay đổi URL trong cùng một lượt (vd chọn cuộc trò chuyện + chuyển tầng): mỗi lần gọi dựa trên lần
  // trước chưa kịp áp dụng, nên lần sau không ghi đè lần trước.
  const pendingQ = useRef<URLSearchParams | null>(null);
  useEffect(() => {
    pendingQ.current = null;
  }, [params]);
  const patchQuery = (patch: Record<string, string | null>) => {
    const q = pendingQ.current ?? new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) q.delete(k);
      else q.set(k, v);
    }
    pendingQ.current = q;
    router.replace(`/office${q.toString() ? `?${q}` : ''}`, { scroll: false });
  };
  const threadId = params.get('chat');
  /** Tầng đang làm dự án này (null nếu dự án không ở tầng nào). */
  const floorOf = (projectId: string | null) => (projectId ? (building?.floors.find((f) => f.project?._id === projectId)?.number ?? null) : null);
  /** Mở một cuộc trò chuyện → cảnh 3D chuyển tới tầng đang làm dự án đó. */
  const setThread = (id: string | null) => {
    writeLastThread(id);
    const n = floorOf(id);
    patchQuery(n ? { chat: id, floor: String(n) } : { chat: id });
  };
  // Quay lại trang Toà nhà (vd từ menu) → mở lại đúng cuộc trò chuyện đang xem lần trước
  const { data: projectList } = useSWR<{ _id: string }[]>('/api/projects');
  useEffect(() => {
    if (threadId) {
      writeLastThread(threadId);
      return;
    }
    const last = readLastThread();
    if (!last || !projectList) return;
    if (!projectList.some((p) => p._id === last)) {
      writeLastThread(null);
      return;
    }
    const q = new URLSearchParams(params.toString());
    q.set('chat', last);
    router.replace(`/office?${q}`, { scroll: false });
  }, [threadId, projectList, params, router]);
  const view = params.get('view') === 'grid' ? 'grid' : '3d';
  const floorParam = params.get('floor');
  const firstBusy = building?.floors.find((f) => f.project)?.number ?? 1;
  // Chưa chọn tầng → tầng của cuộc trò chuyện đang mở, nếu không thì tầng bận đầu tiên
  const buildingView: BuildingViewMode = floorParam === 'tower' ? 'tower' : floorParam ? Number(floorParam) : (floorOf(threadId) ?? firstBusy);
  /** Chỉ chuyển cảnh 3D (giữ nguyên cuộc trò chuyện). */
  const setBuildingView = (v: BuildingViewMode) => patchQuery({ floor: String(v) });
  /** Bạn chọn một tầng → khung trò chuyện chuyển sang dự án đang chạy ở tầng đó (tầng trống: cuộc trò chuyện mới cho tầng đó). */
  const pickFloor = (v: BuildingViewMode) => {
    if (typeof v !== 'number') return setBuildingView(v);
    const pid = building?.floors.find((f) => f.number === v)?.project?._id ?? null;
    writeLastThread(pid);
    patchQuery({ floor: String(v), chat: pid });
  };
  // Đang xem một tầng trống → yêu cầu mới ưu tiên giao cho đúng tầng này
  const viewedFloor = typeof buildingView === 'number' ? building?.floors.find((f) => f.number === buildingView) : undefined;
  const preferFloor = viewedFloor && viewedFloor.enabled && !viewedFloor.project ? viewedFloor.number : null;
  const providers = prov?.providers ?? [];
  const busy = useMemo(() => (depts ?? []).filter((d) => d.activeTasks.some((tk) => tk.status === 'running')).length, [depts]);
  const open = depts?.find((d) => d._id === openId) ?? null;
  const setOpen = (id: string | null) => patchQuery({ dept: id });
  const setView = (v: '3d' | 'grid') => patchQuery({ view: v === 'grid' ? 'grid' : null });

  return (
    <Page full>
      <PageHeader
        title={t('Toà nhà')}
        description={t('Công ty 5 tầng – mỗi tầng một đội làm trọn một dự án. Nhắn yêu cầu ở khung Trò chuyện: CEO tổng giao cho tầng đang trống và các phòng trả lời ngay tại đó.')}
        actions={
          <>
            {depts && (
              <Badge color="#5C9A68" dot pulse={busy > 0}>
                {t('{busy}/{total} phòng đang làm việc', { busy, total: depts.filter((d) => d.enabled).length })}
              </Badge>
            )}
            <Segmented<'3d' | 'grid'>
              value={view}
              onChange={setView}
              options={[
                {
                  value: '3d',
                  label: (
                    <span className="flex items-center gap-1.5">
                      <Box className="size-3.5" />
                      {t('Toà nhà 3D')}
                    </span>
                  ),
                },
                {
                  value: 'grid',
                  label: (
                    <span className="flex items-center gap-1.5">
                      <Users className="size-3.5" />
                      {t('Nhân sự')}
                    </span>
                  ),
                },
              ]}
            />
            <Button variant="primary" onClick={() => setCreating(true)} icon={<Plus className="size-4" />}>
              {t('Thêm phòng ban')}
            </Button>
          </>
        }
      />
      {view === '3d' && depts && building ? (
        <div ref={gridRef} className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_var(--chat-w)]" style={{ '--chat-w': `${Math.round(chatW)}px` } as React.CSSProperties}>
          <Card className="min-w-0 overflow-hidden">
            <div className="p-2 sm:p-3">
              <OfficeView
                className="h-[440px] overflow-hidden rounded-[20px] sm:h-[calc(100dvh-270px)] sm:min-h-[560px]"
                data={{ floors: building.floors, departments: depts, workflows: workflows ?? [] }}
                view={buildingView}
                onViewChange={pickFloor}
                onSelectDept={(id) => setOpen(id)}
                onSelectMe={() => typeof buildingView === 'number' && setAssigning(true)}
                presentUntil={presentUntil}
              />
            </div>
            <div className="border-t border-line px-6 py-3">
              <BuildingLegend />
            </div>
          </Card>
          {/* Cột phải: trò chuyện (mặc định) / thông tin tầng – cao bằng khung 3D */}
          <div className="relative min-h-[640px] xl:min-h-0">
            {/* Thanh kéo đổi độ rộng khung chat (màn hình rộng) */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t('Kéo để đổi độ rộng khung chat')}
              title={t('Kéo để đổi độ rộng khung chat')}
              onPointerDown={startResize}
              onDoubleClick={() => writeChatW(CHAT_W_DEFAULT)}
              className="group absolute inset-y-0 -left-[18px] z-10 hidden w-3 cursor-col-resize xl:block"
            >
              <span className="absolute inset-y-10 left-1/2 w-1 -translate-x-1/2 rounded-full bg-line-strong opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
            <Card className="flex h-[640px] flex-col overflow-hidden xl:absolute xl:inset-0 xl:h-auto">
              <div className="border-b border-line p-2">
                <Segmented<'chat' | 'floor'>
                  value={panel}
                  onChange={setPanel}
                  className="w-full [&>button]:flex-1"
                  options={[
                    { value: 'chat', label: <span className="flex items-center justify-center gap-1.5"><MessagesSquare className="size-3.5" />{t('Trò chuyện')}</span> },
                    {
                      value: 'floor',
                      label: (
                        <span className="flex items-center justify-center gap-1.5">
                          <Building2 className="size-3.5" />
                          {typeof buildingView === 'number' ? t('Tầng {n}', { n: buildingView }) : t('Các tầng')}
                        </span>
                      ),
                    },
                  ]}
                />
              </div>
              {panel === 'chat' ? (
                <div className="min-h-0 flex-1">
                  <OfficeChat
                    departments={depts}
                    floors={building.floors}
                    threadId={threadId}
                    onThread={setThread}
                    onAssigned={(n) => {
                      setBuildingView(n);
                      setPresentUntil(Date.now() + 25_000);
                    }}
                    onGoFloor={(n) => setBuildingView(n)}
                    preferFloor={preferFloor}
                    wide={chatWide}
                    onToggleWide={toggleChatWide}
                  />
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <FloorPanel
                    floor={typeof buildingView === 'number' ? (building.floors.find((f) => f.number === buildingView) ?? null) : null}
                    floors={building.floors}
                    queue={building.queue}
                    depts={depts}
                    workflows={workflows}
                    onPickFloor={(n) => pickFloor(n)}
                    onOpenDept={(id) => setOpen(id)}
                    onAssign={() => setAssigning(true)}
                    onOpenStaff={() => setView('grid')}
                  />
                </div>
              )}
            </Card>
          </div>
        </div>
      ) : view === '3d' || !depts ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[250px]" />
          ))}
        </div>
      ) : (
        <>
          <StaffIntro count={depts.filter((d) => d.enabled).length} />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {depts.map((d) => (
              <DeptCard key={d._id} d={d} all={depts} providers={providers} defaultId={prov?.defaultProviderId ?? null} onOpen={() => setOpen(d._id)} />
            ))}
          </div>
        </>
      )}
      {open && depts && <DeptEditor key={open._id} dept={open} all={depts} providers={providers} defaultId={prov?.defaultProviderId ?? null} onClose={() => setOpen(null)} />}
      {assigning && typeof buildingView === 'number' && building?.floors.find((f) => f.number === buildingView) && (
        <AssignModal
          floor={building.floors.find((f) => f.number === buildingView)!}
          depts={depts ?? []}
          onClose={() => setAssigning(false)}
          onAssigned={() => setPresentUntil(Date.now() + 25_000)}
        />
      )}
      <NewDeptModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          setOpen(id);
        }}
      />
    </Page>
  );
}

// Độ rộng khung chat (kéo thanh chia hoặc bấm mở rộng) – nhớ trong trình duyệt.
const CHAT_W_KEY = 'jv.chatWidth';
const CHAT_W_DEFAULT = 600;
const CHAT_W_MIN = 360;
function subscribeChatW(cb: () => void) {
  window.addEventListener('jv-chat-width', cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener('jv-chat-width', cb);
    window.removeEventListener('storage', cb);
  };
}
function readChatW(): number {
  try {
    const v = Number(localStorage.getItem(CHAT_W_KEY));
    return v >= CHAT_W_MIN ? v : CHAT_W_DEFAULT;
  } catch {
    return CHAT_W_DEFAULT;
  }
}
function writeChatW(v: number) {
  try {
    localStorage.setItem(CHAT_W_KEY, String(Math.round(v)));
  } catch {
    /* trình duyệt chặn lưu – chỉ dùng trong phiên này */
  }
  window.dispatchEvent(new Event('jv-chat-width'));
}

export default function OfficePage() {
  return (
    <Suspense>
      <OfficeInner />
    </Suspense>
  );
}

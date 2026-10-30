'use client';
// Bộ đánh giá agent: lưu đầu vào mẫu theo phòng ban, chạy (cấu hình hiện tại hoặc kết nối / model khác), chấm tự động và so sánh.
import { useMemo, useState } from 'react';
import useSWR, { mutate } from 'swr';
import clsx from 'clsx';
import { CircleCheck, CircleX, FlaskConical, Loader2, Play, Plus, Save, Square, Trash2, X } from 'lucide-react';
import type { Department, EvalCase, EvalCheck, EvalRun, EvalSuite, Provider } from '@/lib/types';
import { getPreset, liveModels } from '@/lib/catalog';
import { api } from '@/lib/client/api';
import { dateTime, timeAgo } from '@/lib/client/format';
import { Page, PageHeader } from '@/components/shell';
import { Badge, Button, Card, DeptAvatar, EmptyState, Field, Input, Markdown, Modal, Select, Skeleton, Textarea, confirmDialog, toast } from '@/components/ui';
import { ModelPicker } from '@/components/model-picker';
import { localize, t } from '@/lib/i18n';

const CHECK_LABEL: Record<EvalCheck['kind'], string> = localize({
  contains: 'Có chứa',
  not_contains: 'Không chứa',
  regex: 'Khớp biểu thức',
  max_chars: 'Tối đa ký tự',
  judge: 'Phòng chấm theo tiêu chí',
});

const newCase = (n: number): EvalCase => ({ id: `new-${Date.now()}-${n}`, name: t('Mẫu {n}', { n }), input: '', checks: [] });

export default function EvalsPage() {
  const { data: departments } = useSWR<Department[]>('/api/departments');
  const [deptId, setDeptId] = useState('');
  const dept = departments?.find((d) => d._id === deptId) ?? departments?.find((d) => d.enabled);
  const { data: suites } = useSWR<EvalSuite[]>(dept ? `/api/evals?departmentId=${dept._id}` : null);
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const current = selected === 'new' ? null : (suites?.find((s) => s._id === selected) ?? suites?.[0] ?? null);
  const editing = selected === 'new' || Boolean(current);

  return (
    <Page wide>
      <PageHeader
        eyebrow={t('Vận hành')}
        title={t('Đánh giá agent')}
        description={t('Lưu các đầu vào mẫu cho từng phòng, chạy lại sau mỗi lần đổi prompt, kỹ năng hay mô hình, rồi so sánh kết quả giữa các lượt.')}
        icon={<FlaskConical className="size-7 text-accent" />}
        actions={
          <div className="w-64">
            <Select value={dept?._id ?? ''} onChange={(e) => (setDeptId(e.target.value), setSelected(null))}>
              {(departments ?? []).map((d) => (
                <option key={d._id} value={d._id}>
                  {t(d.name)}
                  {!d.enabled ? ` ${t('(đang tắt)')}` : ''}
                </option>
              ))}
            </Select>
          </div>
        }
      />
      {!departments || !dept ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="space-y-2">
            <div className="flex items-center gap-3 rounded-3xl border border-line p-3">
              <DeptAvatar icon={dept.icon} color={dept.color} size="sm" />
              <div className="min-w-0">
                <div className="truncate text-[14px] font-semibold">{t(dept.name)}</div>
                <div className="truncate text-[12px] text-muted">{t(dept.title)}</div>
              </div>
            </div>
            {(suites ?? []).map((s) => (
              <button
                key={s._id}
                type="button"
                onClick={() => setSelected(s._id)}
                className={clsx('w-full rounded-2xl border px-3 py-2.5 text-left', current?._id === s._id && selected !== 'new' ? 'border-accent/50 bg-accent/5' : 'border-line hover:bg-surface-2')}
              >
                <div className="truncate text-[13.5px] font-medium">{s.name}</div>
                <div className="text-[12px] text-muted">{t('{n} mẫu · sửa {time}', { n: s.cases.length, time: timeAgo(s.updatedAt) })}</div>
              </button>
            ))}
            <Button variant="outline" className="w-full" onClick={() => setSelected('new')} icon={<Plus className="size-4" />}>
              {t('Bộ đánh giá mới')}
            </Button>
          </div>
          <div className="min-w-0">
            {!editing ? (
              <Card>
                <EmptyState
                  icon={<FlaskConical className="size-6" />}
                  title={t('Chưa có bộ đánh giá cho {name}', { name: t(dept.name) })}
                  description={t('Thêm vài yêu cầu tiêu biểu phòng này hay nhận, kèm tiêu chí đạt (có chứa / không chứa / biểu thức / độ dài, hoặc nhờ một phòng chấm).')}
                  action={<Button variant="primary" onClick={() => setSelected('new')}>{t('Tạo bộ đánh giá')}</Button>}
                />
              </Card>
            ) : (
              <SuiteView key={current?._id ?? 'new'} suite={current} dept={dept} departments={departments} onSaved={(id) => setSelected(id)} onDeleted={() => setSelected(null)} />
            )}
          </div>
        </div>
      )}
    </Page>
  );
}

function SuiteView({ suite, dept, departments, onSaved, onDeleted }: { suite: EvalSuite | null; dept: Department; departments: Department[]; onSaved: (id: string) => void; onDeleted: () => void }) {
  const [name, setName] = useState(suite?.name ?? '');
  const [description, setDescription] = useState(suite?.description ?? '');
  const [judge, setJudge] = useState(suite?.judgeDepartmentId ?? '');
  const [cases, setCases] = useState<EvalCase[]>(suite?.cases.length ? suite.cases : [newCase(1)]);
  const [busy, setBusy] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const dirty = !suite || name !== suite.name || description !== suite.description || (judge || null) !== (suite.judgeDepartmentId ?? null) || JSON.stringify(cases) !== JSON.stringify(suite.cases);

  const save = async () => {
    setBusy(true);
    try {
      const body = { departmentId: dept._id, name, description, judgeDepartmentId: judge || null, cases: cases.map((c) => ({ ...c, id: c.id.startsWith('new-') ? undefined : c.id })) };
      const s = suite ? await api.patch<EvalSuite>(`/api/evals/${suite._id}`, body) : await api.post<EvalSuite>('/api/evals', body);
      await mutate(`/api/evals?departmentId=${dept._id}`);
      await mutate(`/api/evals/${s._id}`);
      setCases(s.cases);
      toast.success(t('Đã lưu bộ đánh giá'));
      onSaved(s._id);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!suite || !(await confirmDialog({ title: t('Xoá bộ đánh giá "{name}"?', { name: suite.name }), message: t('Các lượt chạy đã lưu cũng bị xoá.'), confirmLabel: t('Xoá'), tone: 'danger' }))) return;
    await api.del(`/api/evals/${suite._id}`);
    await mutate(`/api/evals?departmentId=${dept._id}`);
    onDeleted();
  };
  const setCase = (i: number, patch: Partial<EvalCase>) => setCases((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="grid gap-3 md:grid-cols-[1fr_240px]">
          <Field label={t('Tên bộ đánh giá')} required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('vd Viết tóm tắt dự án')} />
          </Field>
          <Field label={t('Phòng chấm tiêu chí AI')} hint={t('Dùng cho tiêu chí “Phòng chấm”.')}>
            <Select value={judge} onChange={(e) => setJudge(e.target.value)}>
              <option value="">{t('Phòng Giám Đốc (mặc định)')}</option>
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
        <Field label={t('Mô tả')} className="mt-3">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('Bộ này kiểm tra điều gì')} />
        </Field>
        <div className="mt-4 space-y-3">
          {cases.map((c, i) => (
            <div key={c.id} className="rounded-2xl border border-line p-3">
              <div className="mb-2 flex items-center gap-2">
                <Input value={c.name} onChange={(e) => setCase(i, { name: e.target.value })} className="h-9 max-w-xs text-[13px] font-medium" />
                <Button size="xs" variant="ghost" className="ml-auto text-danger" onClick={() => setCases((cs) => cs.filter((_, j) => j !== i))} icon={<Trash2 className="size-3" />}>
                  {t('Bỏ mẫu')}
                </Button>
              </div>
              <Textarea value={c.input} onChange={(e) => setCase(i, { input: e.target.value })} className="min-h-[80px] text-[13px]" placeholder={t('Yêu cầu gửi cho {name}…', { name: t(dept.name) })} />
              <div className="mt-2 space-y-1.5">
                {c.checks.map((k, ki) => (
                  <div key={ki} className="flex flex-wrap items-center gap-1.5">
                    <div className="w-52 shrink-0">
                      <Select value={k.kind} onChange={(e) => setCase(i, { checks: c.checks.map((x, xi) => (xi === ki ? { ...x, kind: e.target.value as EvalCheck['kind'] } : x)) })} className="h-8 text-[12.5px]">
                        {(Object.keys(CHECK_LABEL) as EvalCheck['kind'][]).map((kk) => (
                          <option key={kk} value={kk}>
                            {CHECK_LABEL[kk]}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Input
                      value={k.value}
                      onChange={(e) => setCase(i, { checks: c.checks.map((x, xi) => (xi === ki ? { ...x, value: e.target.value } : x)) })}
                      placeholder={k.kind === 'judge' ? t('vd Có nêu ít nhất 3 rủi ro và cách giảm thiểu') : k.kind === 'max_chars' ? '1500' : t('chữ / mẫu cần kiểm')}
                      className="h-8 min-w-[220px] flex-1 text-[12.5px]"
                    />
                    <button type="button" aria-label={t('Bỏ tiêu chí')} className="text-subtle hover:text-danger" onClick={() => setCase(i, { checks: c.checks.filter((_, xi) => xi !== ki) })}>
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
                <Button size="xs" variant="ghost" onClick={() => setCase(i, { checks: [...c.checks, { kind: 'contains', value: '' }] })} icon={<Plus className="size-3" />}>
                  {t('Thêm tiêu chí')}
                </Button>
              </div>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => setCases((cs) => [...cs, newCase(cs.length + 1)])} icon={<Plus className="size-3.5" />}>
            {t('Thêm mẫu')}
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          {suite && (
            <Button variant="ghost" className="text-danger" onClick={remove} icon={<Trash2 className="size-4" />}>
              {t('Xoá bộ')}
            </Button>
          )}
          <Button variant="outline" className="ml-auto" loading={busy} disabled={!dirty || !name.trim()} onClick={save} icon={<Save className="size-4" />}>
            {t('Lưu')}
          </Button>
          <Button variant="primary" disabled={!suite || dirty} onClick={() => setRunOpen(true)} icon={<Play className="size-4" />}>
            {t('Chạy đánh giá')}
          </Button>
        </div>
        {suite && dirty && <p className="mt-2 text-right text-[12px] text-subtle">{t('Lưu thay đổi trước khi chạy.')}</p>}
      </Card>
      {suite && <Runs suite={suite} />}
      {runOpen && suite && <RunDialog suite={suite} dept={dept} onClose={() => setRunOpen(false)} />}
    </div>
  );
}

function RunDialog({ suite, dept, onClose }: { suite: EvalSuite; dept: Department; onClose: () => void }) {
  const { data: providers } = useSWR<Provider[]>('/api/providers');
  const usable = (providers ?? []).filter((p) => p.enabled && p.kind !== 'manual');
  const [mode, setMode] = useState<'current' | 'other'>('current');
  const [providerId, setProviderId] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const provider = usable.find((p) => p._id === providerId);
  const run = async () => {
    setBusy(true);
    try {
      await api.post(`/api/evals/${suite._id}/run`, mode === 'other' ? { providerId, model } : {});
      await mutate(`/api/evals/${suite._id}`);
      toast.success(t('Đã bắt đầu – kết quả hiện dần bên dưới'));
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
      title={t('Chạy "{name}"', { name: suite.name })}
      description={t('{n} mẫu, mỗi mẫu là một lượt chạy thật của {name} (chỉ đọc, không giao việc) – có tốn hạn mức / chi phí của kết nối AI.', { n: suite.cases.length, name: t(dept.name) })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Huỷ')}
          </Button>
          <Button variant="primary" loading={busy} disabled={mode === 'other' && !providerId} onClick={run} icon={<Play className="size-4" />}>
            {t('Chạy')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="flex items-start gap-2 text-[13.5px]">
          <input type="radio" checked={mode === 'current'} onChange={() => setMode('current')} className="mt-1" />
          <span>
            <b>{t('Cấu hình hiện tại của phòng')}</b>
            <span className="block text-[12.5px] text-muted">{t('Đúng prompt, kỹ năng, kết nối và mô hình phòng đang dùng.')}</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-[13.5px]">
          <input type="radio" checked={mode === 'other'} onChange={() => setMode('other')} className="mt-1" />
          <span>
            <b>{t('Thử với kết nối / mô hình khác')}</b>
            <span className="block text-[12.5px] text-muted">{t('Giữ prompt và kỹ năng của phòng, chỉ đổi kết nối AI để so sánh.')}</span>
          </span>
        </label>
        {mode === 'other' && (
          <div className="grid gap-3 pl-6 sm:grid-cols-2">
            <Field label={t('Kết nối AI')}>
              <Select value={providerId} onChange={(e) => (setProviderId(e.target.value), setModel(''))}>
                <option value="">{t('Chọn…')}</option>
                {usable.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            {provider && (
              <Field label={t('Mô hình')}>
                <ModelPicker value={model} onChange={setModel} live={liveModels(provider)} suggested={getPreset(provider.type).models ?? []} emptyLabel={t('Mặc định của kết nối')} />
              </Field>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function Runs({ suite }: { suite: EvalSuite }) {
  const { data } = useSWR<{ suite: EvalSuite; runs: EvalRun[] }>(`/api/evals/${suite._id}`, { refreshInterval: (d) => (d?.runs.some((r) => r.status === 'running') ? 4000 : 0) });
  const runs = useMemo(() => data?.runs ?? [], [data]);
  const [pick, setPick] = useState<string[]>([]);
  const compare = useMemo(() => runs.filter((r) => pick.includes(r._id)), [runs, pick]);
  const shown = compare.length ? compare : runs.slice(0, 1);
  const act = async (r: EvalRun, del: boolean) => {
    if (del && !(await confirmDialog({ title: t('Xoá lượt đánh giá này?'), confirmLabel: t('Xoá'), tone: 'danger' }))) return;
    await (del ? api.del(`/api/evals/runs/${r._id}`) : api.patch(`/api/evals/runs/${r._id}`, {}));
    await mutate(`/api/evals/${suite._id}`);
  };
  if (!runs.length) return <Card className="p-5 text-[13px] text-muted">{t('Chưa chạy lần nào.')}</Card>;
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[15px] font-semibold">{t('Các lượt chạy')}</h3>
        <span className="text-[12px] text-subtle">{t('Đánh dấu 2 lượt trở lên để so sánh')}</span>
      </div>
      <div className="divide-y divide-line rounded-2xl border border-line">
        {runs.map((r) => (
          <label key={r._id} className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2.5 text-[13px]">
            <input type="checkbox" checked={pick.includes(r._id)} onChange={(e) => setPick((p) => (e.target.checked ? [...p, r._id] : p.filter((x) => x !== r._id)))} />
            <span className="min-w-0 flex-1 truncate">{r.label}</span>
            <span className="font-mono text-[11px] text-subtle" title={t('Dấu vân tay prompt + kỹ năng lúc chạy')}>
              #{r.promptHash}
            </span>
            {r.status === 'running' ? (
              <Badge color="#4A86BD">
                <Loader2 className="size-3 animate-spin" /> {t('Đang chạy {done}/{total}', { done: r.results.filter((x) => x.status === 'done' || x.status === 'failed').length, total: r.total })}
              </Badge>
            ) : r.status === 'cancelled' ? (
              <Badge color="#958B7E">{t('Đã dừng')}</Badge>
            ) : (
              <Badge color={r.passed === r.total ? '#5C9A68' : r.passed ? '#C9952F' : '#C4483F'}>
                {t('Đạt {passed}/{total}', { passed: r.passed, total: r.total })}
              </Badge>
            )}
            {r.costUsd > 0 && <span className="text-[12px] text-subtle">${r.costUsd.toFixed(4)}</span>}
            <span className="text-[12px] text-subtle" title={dateTime(r.startedAt)}>
              {timeAgo(r.startedAt)}
            </span>
            {r.status === 'running' ? (
              <Button size="xs" variant="ghost" onClick={(e) => (e.preventDefault(), void act(r, false))} icon={<Square className="size-3" />}>
                {t('Dừng')}
              </Button>
            ) : (
              <Button size="xs" variant="ghost" className="text-danger" onClick={(e) => (e.preventDefault(), void act(r, true))} icon={<Trash2 className="size-3" />} aria-label={t('Xoá lượt')} />
            )}
          </label>
        ))}
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] text-[13px]">
          <thead>
            <tr className="text-left text-[11.5px] tracking-wider text-subtle uppercase">
              <th className="py-2 pr-3 font-semibold">{t('Mẫu')}</th>
              {shown.map((r) => (
                <th key={r._id} className="py-2 pr-3 font-semibold">
                  {r.label}
                  <div className="font-normal normal-case">{timeAgo(r.startedAt)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {suite.cases.map((c) => (
              <tr key={c.id} className="align-top">
                <td className="py-2.5 pr-3 font-medium">{c.name}</td>
                {shown.map((r) => {
                  const res = r.results.find((x) => x.caseId === c.id);
                  return (
                    <td key={r._id} className="py-2.5 pr-3">
                      {!res ? <span className="text-subtle">—</span> : <ResultCell res={res} />}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ResultCell({ res }: { res: EvalRun['results'][number] }) {
  const [open, setOpen] = useState(false);
  if (res.status === 'running' || res.status === 'judging')
    return (
      <span className="inline-flex items-center gap-1 text-muted">
        <Loader2 className="size-3.5 animate-spin" /> {res.status === 'judging' ? t('Đang chấm') : t('Đang chạy')}
      </span>
    );
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-left">
        {res.passed ? <CircleCheck className="size-4 text-ok" /> : <CircleX className="size-4 text-danger" />}
        <span className={res.passed ? 'text-ok' : 'text-danger'}>{res.passed ? t('Đạt') : res.error ? t('Lỗi') : t('Không đạt')}</span>
        {res.durationMs ? <span className="text-[11.5px] text-subtle">{Math.round(res.durationMs / 1000)}s</span> : null}
      </button>
      <div className="mt-1 space-y-0.5">
        {res.checks.map((k, i) => (
          <div key={i} className={clsx('text-[11.5px]', k.passed === false ? 'text-danger' : k.passed ? 'text-ok' : 'text-subtle')}>
            {k.passed === false ? '✗' : k.passed ? '✓' : '·'} {CHECK_LABEL[k.kind]}: {k.value.slice(0, 40)}
          </div>
        ))}
      </div>
      {open && (
        <Modal open onClose={() => setOpen(false)} size="lg" title={t('Câu trả lời')}>
          {res.error && <div className="mb-3 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">{res.error}</div>}
          <Markdown>{res.output || t('_(không có nội dung)_')}</Markdown>
          {res.checks.some((k) => k.note) && (
            <div className="mt-4 space-y-2 border-t border-line pt-3">
              {res.checks
                .filter((k) => k.note)
                .map((k, i) => (
                  <div key={i} className="text-[12.5px]">
                    <b>{CHECK_LABEL[k.kind]}</b> ({k.value.slice(0, 60)}): <span className="text-muted">{k.note}</span>
                  </div>
                ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

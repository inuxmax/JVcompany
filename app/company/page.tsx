'use client';
// Công ty & dữ liệu: thông tin công ty, kho bí mật, đội mẫu, xuất / nhập công ty, chạy lại thiết lập ban đầu.
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR, { mutate } from 'swr';
import { Building2, Download, KeyRound, Lock, Plus, RefreshCw, RotateCcw, Trash2, Upload, Users } from 'lucide-react';
import type { Company, Secret } from '@/lib/types';
import type { TeamTemplate } from '@/lib/teams';
import { DEPT_INFO } from '@/lib/teams';
import { api } from '@/lib/client/api';
import { t, tc } from '@/lib/i18n';
import { timeAgo } from '@/lib/client/format';
import { Page, PageHeader } from '@/components/shell';
import { Badge, Button, Card, CardHeader, DeptAvatar, Field, Input, Modal, Segmented, Skeleton, Switch, Textarea, confirmDialog, toast } from '@/components/ui';

type Tab = 'info' | 'secrets' | 'teams' | 'data';

function CompanyInfo() {
  const router = useRouter();
  const { data } = useSWR<Company>('/api/company');
  const [form, setForm] = useState<Partial<Company> | null>(null);
  const [busy, setBusy] = useState(false);
  if (!data) return <Skeleton className="h-64" />;
  const f = { ...data, ...form };
  const set = (p: Partial<Company>) => setForm({ ...form, ...p });
  const save = async () => {
    setBusy(true);
    try {
      await api.patch('/api/company', { name: f.name, mission: f.mission, issuePrefix: f.issuePrefix, budgetMonthlyUsd: Number(f.budgetMonthlyUsd) || 0, requireApprovalForNewAgents: f.requireApprovalForNewAgents });
      await mutate('/api/company');
      setForm(null);
      toast.success(t('Đã lưu thông tin công ty'));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const resume = async () => {
    await api.patch('/api/company', { resume: true });
    await mutate('/api/company');
  };
  const rerun = async () => {
    const ok = await confirmDialog({ title: t('Chạy lại thiết lập ban đầu?'), message: t('Mở lại màn hình thiết lập 4 bước. Dữ liệu hiện có được giữ nguyên.'), confirmLabel: t('Chạy lại') });
    if (!ok) return;
    await api.post('/api/setup', { step: 'restart' });
    await mutate('/api/setup');
    router.push('/setup');
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        <CardHeader title={t('Thông tin công ty')} icon={<Building2 className="size-4" />} />
        <div className="space-y-4 px-6 pb-6">
          {data.status === 'paused' && (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-warn/10 px-3 py-2 text-[13px] text-warn">
              <span>{data.pauseReason ? t('Công ty đang tạm dừng: {reason}', { reason: data.pauseReason }) : t('Công ty đang tạm dừng')}</span>
              <Button size="xs" variant="primary" onClick={resume}>
                {t('Tiếp tục hoạt động')}
              </Button>
            </div>
          )}
          <Field label={t('Tên công ty')}>
            <Input value={f.name ?? ''} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label={t('Sứ mệnh / mục tiêu lớn')}>
            <Textarea rows={3} value={f.mission ?? ''} onChange={(e) => set({ mission: e.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('Tiền tố mã nhiệm vụ')} hint={t('Nhiệm vụ mới có mã {code}', { code: `${f.issuePrefix || 'JV'}-${(data.issueCounter ?? 0) + 1}` })}>
              <Input value={f.issuePrefix ?? ''} onChange={(e) => set({ issuePrefix: e.target.value.toUpperCase().slice(0, 6) })} className="font-mono" />
            </Field>
            <Field label={t('Ngân sách mỗi tháng (USD)')} hint={t('0 = không giới hạn')}>
              <Input type="number" min={0} value={String(f.budgetMonthlyUsd ?? 0)} onChange={(e) => set({ budgetMonthlyUsd: Number(e.target.value) })} />
            </Field>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5 text-[13px]">
            <span>
              <b>{t('Tuyển nhân sự mới phải được bạn duyệt')}</b>
              <span className="block text-[12px] text-muted">{t('Khi giám đốc đề nghị tuyển phòng mới, phòng chỉ hoạt động sau khi bạn duyệt.')}</span>
            </span>
            <Switch checked={Boolean(f.requireApprovalForNewAgents)} onChange={(v) => set({ requireApprovalForNewAgents: v })} label={t('Bắt buộc duyệt')} />
          </label>
          <div className="flex justify-end">
            <Button variant="primary" onClick={save} loading={busy} disabled={!form}>
              {t('Lưu')}
            </Button>
          </div>
        </div>
      </Card>
      <Card className="h-fit p-5 text-[13px]">
        <div className="font-semibold">{t('Thiết lập ban đầu')}</div>
        <p className="mt-1 text-muted">{t('Chạy lại trình hướng dẫn 4 bước: tên công ty, đội ngũ, kết nối mô hình, dự án làm quen.')}</p>
        <Button className="mt-3" size="sm" variant="outline" onClick={rerun} icon={<RotateCcw className="size-3.5" />}>
          {t('Chạy lại thiết lập')}
        </Button>
      </Card>
    </div>
  );
}

function Secrets() {
  const { data } = useSWR<Secret[]>('/api/secrets');
  const [adding, setAdding] = useState(false);
  const [rotating, setRotating] = useState<Secret | null>(null);
  const [form, setForm] = useState({ key: '', value: '', description: '' });
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      await api.post('/api/secrets', form);
      await mutate('/api/secrets');
      setAdding(false);
      setForm({ key: '', value: '', description: '' });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const rotate = async () => {
    setBusy(true);
    try {
      await api.patch(`/api/secrets/${rotating!._id}`, { value: form.value });
      await mutate('/api/secrets');
      setRotating(null);
      setForm({ key: '', value: '', description: '' });
      toast.success(t('Đã xoay vòng – lượt chạy sau dùng giá trị mới'));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (s: Secret) => {
    await api.patch(`/api/secrets/${s._id}`, { status: s.status === 'active' ? 'disabled' : 'active' });
    await mutate('/api/secrets');
  };
  const remove = async (s: Secret) => {
    const ok = await confirmDialog({ title: t('Xoá bí mật {key}?', { key: s.key }), message: t('Phòng ban / kết nối đang dùng "secret:{key}" sẽ báo lỗi khi chạy.', { key: s.key }), confirmLabel: t('Xoá'), tone: 'danger' });
    if (!ok) return;
    await api.del(`/api/secrets/${s._id}`);
    await mutate('/api/secrets');
  };
  return (
    <Card>
      <CardHeader
        title={t('Kho bí mật')}
        description={
          <>
            {t('Mã hoá AES-256-GCM trên máy bạn. Dùng trong biến môi trường của phòng ban hoặc kết nối:')} <code className="font-mono">TEN_BIEN=secret:KHOA</code>. {t('Giá trị không bao giờ hiện lại và được che trong nhật ký.')}
          </>
        }
        icon={<Lock className="size-4" />}
        actions={
          <Button size="sm" variant="primary" onClick={() => setAdding(true)} icon={<Plus className="size-3.5" />}>
            {t('Thêm')}
          </Button>
        }
      />
      <div className="space-y-2 px-6 pb-6">
        {!data ? (
          <Skeleton className="h-20" />
        ) : !data.length ? (
          <p className="text-[13px] text-muted">{t('Chưa có bí mật nào.')}</p>
        ) : (
          data.map((s) => (
            <div key={s._id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2.5 text-[13px]">
              <KeyRound className="size-4 text-accent" />
              <code className="font-mono font-semibold">{s.key}</code>
              <span className="font-mono text-[12px] text-subtle">{s.preview}</span>
              <Badge color={s.status === 'active' ? '#5C9A68' : '#958B7E'} dot>
                {s.status === 'active' ? t('Đang dùng') : t('Tắt')}
              </Badge>
              <span className="text-[12px] text-subtle">v{s.currentVersion}</span>
              {s.description && <span className="min-w-0 flex-1 truncate text-muted">{s.description}</span>}
              <span className="ml-auto text-[12px] text-subtle">{s.lastUsedAt ? t('Dùng {time}', { time: timeAgo(s.lastUsedAt) }) : t('Chưa dùng')}</span>
              <Button size="xs" variant="ghost" onClick={() => setRotating(s)} icon={<RefreshCw className="size-3.5" />}>
                {t('Xoay vòng')}
              </Button>
              <Button size="xs" variant="ghost" onClick={() => toggle(s)}>
                {s.status === 'active' ? tc('action', 'Tắt') : tc('action', 'Bật')}
              </Button>
              <Button size="xs" variant="ghost" onClick={() => remove(s)} icon={<Trash2 className="size-3.5" />} aria-label={t('Xoá')} />
            </div>
          ))
        )}
      </div>
      <Modal
        open={adding || Boolean(rotating)}
        onClose={() => {
          setAdding(false);
          setRotating(null);
        }}
        title={rotating ? t('Xoay vòng {key}', { key: rotating.key }) : t('Thêm bí mật')}
        footer={
          <Button variant="primary" onClick={rotating ? rotate : create} loading={busy} disabled={!form.value || (!rotating && !form.key)}>
            {t('Lưu')}
          </Button>
        }
      >
        <div className="space-y-3">
          {!rotating && (
            <Field label={t('Tên (chữ IN HOA)')}>
              <Input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })} placeholder="GITHUB_TOKEN" className="font-mono" />
            </Field>
          )}
          <Field label={t('Giá trị')}>
            <Input type="password" autoComplete="off" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className="font-mono" />
          </Field>
          {!rotating && (
            <Field label={t('Ghi chú')}>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t('Token GitHub cho Phòng Dev')} />
            </Field>
          )}
        </div>
      </Modal>
    </Card>
  );
}

function Teams() {
  const { data } = useSWR<(TeamTemplate & { installed: boolean; missing: string[] })[]>('/api/teams');
  const [busy, setBusy] = useState<string | null>(null);
  const install = async (team: TeamTemplate) => {
    const ok = await confirmDialog({
      title: t('Cài đội "{name}"?', { name: t(team.name) }),
      message: team.routines?.length
        ? t('Bật {n} phòng (tạo phòng còn thiếu) và thêm {k} lịch định kỳ gợi ý (đang tạm dừng để bạn xem lại). Không tắt phòng nào đang có.', { n: team.departments.length, k: team.routines.length })
        : t('Bật {n} phòng (tạo phòng còn thiếu). Không tắt phòng nào đang có.', { n: team.departments.length }),
      confirmLabel: t('Cài đội'),
    });
    if (!ok) return;
    setBusy(team.id);
    try {
      await api.post('/api/teams', { teamId: team.id });
      await Promise.all([mutate('/api/teams'), mutate('/api/departments'), mutate('/api/routines')]);
      toast.success(t('Đã cài {name}', { name: t(team.name) }));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  if (!data) return <Skeleton className="h-48" />;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {data.map((team) => (
        <Card key={team.id} className="flex flex-col p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Users className="size-4 text-accent" />
            <span className="text-[14.5px] font-semibold">{t(team.name)}</span>
            <Badge color="#958B7E">{t(team.category)}</Badge>
            {team.installed && <Badge color="#5C9A68">{t('Đã có đủ')}</Badge>}
          </div>
          <p className="mt-1 text-[12.5px] text-muted">{t(team.description)}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {team.departments.map((id) => {
              const d = DEPT_INFO[id];
              return d ? (
                <span key={id} className="flex items-center gap-1 rounded-full border border-line py-0.5 pr-2 pl-0.5 text-[11.5px]">
                  <DeptAvatar icon={d.icon} color={d.color} size="sm" className="!size-5 !rounded-full" />
                  {/* i18n-ignore: chỉ bỏ tiền tố "Phòng " của tên tiếng Việt gốc */}
                  {t(d.name).replace('Phòng ', '')}
                  {team.missing.includes(id) && <span className="text-accent">+</span>}
                </span>
              ) : null;
            })}
          </div>
          {team.routines?.length ? <p className="mt-2 text-[12px] text-subtle">{t('Lịch gợi ý: {list}', { list: team.routines.map((r) => t(r.title)).join(', ') })}</p> : null}
          <div className="mt-auto pt-3">
            <Button size="sm" variant={team.installed ? 'ghost' : 'outline'} onClick={() => install(team)} loading={busy === team.id}>
              {team.installed ? t('Cài lại') : t('Cài đội này')}
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

interface ImportReport {
  applied: boolean;
  departments: { id: string; name: string; action: string; newId?: string }[];
  skills: { key: string; action: string }[];
  goals: number;
  routines: number;
  envInputs: { key: string; department: string; kind: string; portability: string }[];
}

function DataTab() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pkg, setPkg] = useState<unknown>(null);
  const [strategy, setStrategy] = useState<'rename' | 'skip' | 'replace'>('rename');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      setPkg(j);
      setReport(await api.post<ImportReport>('/api/portability/import', { package: j, strategy, apply: false }));
    } catch (e) {
      toast.error(e instanceof SyntaxError ? t('Tệp không phải JSON hợp lệ') : e);
    }
  };
  const preview = async (s: typeof strategy) => {
    setStrategy(s);
    if (pkg) setReport(await api.post<ImportReport>('/api/portability/import', { package: pkg, strategy: s, apply: false }));
  };
  const apply = async () => {
    setBusy(true);
    try {
      const r = await api.post<ImportReport>('/api/portability/import', { package: pkg, strategy, apply: true });
      setReport(r);
      await Promise.all([mutate('/api/departments'), mutate('/api/skills'), mutate('/api/goals'), mutate('/api/routines')]);
      toast.success(t('Đã nhập gói công ty'));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const ACTION: Record<string, string> = { create: t('Tạo mới'), rename: t('Đổi tên'), skip: t('Bỏ qua'), replace: t('Thay thế') };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <div className="flex items-center gap-2 font-semibold">
          <Download className="size-4 text-accent" /> {t('Xuất công ty')}
        </div>
        <p className="mt-1 text-[13px] text-muted">{t('Gói JSON gồm công ty, mục tiêu, phòng ban (prompt, cấp trên, kỹ năng, heartbeat), quy trình, kỹ năng, lịch định kỳ. Không gồm API key, giá trị bí mật, lịch sử chat và đường dẫn trên máy.')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href="/api/portability/export" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-[13px] font-semibold text-accent-fg">
            <Download className="size-3.5" /> {t('Tải gói công ty')}
          </a>
          <a href="/api/portability/export?projects=1" className="inline-flex h-9 items-center rounded-full border border-line px-4 text-[13px]">
            {t('Kèm danh sách dự án')}
          </a>
          <a href="/api/export" className="inline-flex h-9 items-center rounded-full border border-line px-4 text-[13px] text-muted">
            {t('Sao lưu toàn bộ dữ liệu')}
          </a>
        </div>
      </Card>
      <Card className="p-5">
        <div className="flex items-center gap-2 font-semibold">
          <Upload className="size-4 text-accent" /> {t('Nhập công ty')}
        </div>
        <p className="mt-1 text-[13px] text-muted">{t('Xem trước rồi mới áp dụng. Sau khi nhập: heartbeat tắt, lịch định kỳ tạm dừng để bạn kiểm tra.')}</p>
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} icon={<Upload className="size-3.5" />}>
            {t('Chọn tệp gói (.json)')}
          </Button>
          {Boolean(pkg) && (
            <Segmented
              value={strategy}
              onChange={(v) => void preview(v)}
              options={[
                { value: 'rename', label: t('Trùng: đổi tên') },
                { value: 'skip', label: t('Trùng: bỏ qua') },
                { value: 'replace', label: t('Trùng: thay thế') },
              ]}
            />
          )}
        </div>
        {report && (
          <div className="mt-4 space-y-2 text-[12.5px]">
            <div className="font-medium">
              {report.applied ? t('✅ Đã nhập') : t('Xem trước')}:{' '}
              {t('{departments} phòng · {skills} kỹ năng · {goals} mục tiêu · {routines} lịch', { departments: report.departments.length, skills: report.skills.length, goals: report.goals, routines: report.routines })}
            </div>
            <div className="max-h-48 space-y-1 overflow-auto rounded-xl border border-line p-2">
              {report.departments.map((d) => (
                <div key={d.id} className="flex justify-between gap-2">
                  <span>{t(d.name)}</span>
                  <span className="text-muted">
                    {ACTION[d.action] ?? d.action}
                    {d.newId ? ` → ${d.newId}` : ''}
                  </span>
                </div>
              ))}
            </div>
            {report.envInputs.length > 0 && <div className="text-warn">{t('Cần nhập lại {n} biến môi trường: {list}', { n: report.envInputs.length, list: report.envInputs.map((e) => e.key).join(', ') })}</div>}
            {!report.applied && (
              <Button size="sm" variant="primary" onClick={apply} loading={busy}>
                {t('Áp dụng')}
              </Button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

export default function CompanyPage() {
  const [tab, setTab] = useState<Tab>('info');
  return (
    <Page>
      <PageHeader eyebrow={t('Công ty')} title={t('Công ty & dữ liệu')} description={t('Thông tin công ty, kho bí mật, đội mẫu dựng sẵn và xuất / nhập toàn bộ cấu hình công ty.')} />
      <div className="mb-5">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'info', label: t('Thông tin') },
            { value: 'secrets', label: t('Kho bí mật') },
            { value: 'teams', label: t('Đội mẫu') },
            { value: 'data', label: t('Xuất / Nhập') },
          ]}
        />
      </div>
      {tab === 'info' && <CompanyInfo />}
      {tab === 'secrets' && <Secrets />}
      {tab === 'teams' && <Teams />}
      {tab === 'data' && <DataTab />}
    </Page>
  );
}

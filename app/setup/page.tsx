'use client';
// Màn hình thiết lập ban đầu (khi cơ sở dữ liệu còn trống): tên công ty → đội ngũ → kết nối mô hình → bắt đầu.
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR, { mutate } from 'swr';
import clsx from 'clsx';
import { ArrowLeft, ArrowRight, Building2, Check, Globe, KeyRound, Laptop, PlugZap, Rocket, Sparkles, Users } from 'lucide-react';
import type { Company, Provider, ProviderAuthMode, ProviderType } from '@/lib/types';
import { getPreset, type ProviderPreset } from '@/lib/catalog';
import { DEPT_INFO, TEAM_TEMPLATES } from '@/lib/teams';
import { api } from '@/lib/client/api';
import { m, t } from '@/lib/i18n';
import { Badge, Button, DeptAvatar, Field, Input, Segmented, Spinner, Textarea, toast } from '@/components/ui';
import { EnvTestView, checkText } from '@/components/env-test';

interface SetupResp {
  needsSetup: boolean;
  company: Company | null;
  providers: Provider[];
  defaultProviderId: string | null;
  departments: { _id: string; name: string; title: string; icon: string; color: string }[];
  onboardingProjectId: string | null;
}

interface Detected {
  type: ProviderType;
  label: string;
  path: string;
  version: string;
  auth: 'present' | 'absent' | 'unknown';
}

const STEPS = [
  { title: m('Tên công ty'), icon: Building2 },
  { title: m('Đội ngũ đầu tiên'), icon: Users },
  { title: m('Kết nối mô hình'), icon: PlugZap },
  { title: m('Bắt đầu'), icon: Rocket },
];

const DRAFT_KEY = 'jv.setupDraft';
type Draft = { step: number; name: string; mission: string; teamId: string; leadTitle: string };

function readDraft(): Partial<Draft> {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') as Partial<Draft>;
  } catch {
    return {};
  }
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex gap-2 lg:flex-col lg:gap-1">
      {STEPS.map((s, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <li key={s.title} className={clsx('flex items-center gap-3 rounded-2xl px-2 py-2 lg:px-3', active && 'bg-surface-solid shadow-sm ring-1 ring-line')}>
            <span
              className={clsx(
                'flex size-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold',
                done ? 'bg-accent text-accent-fg' : active ? 'bg-[#25211c] text-[#E0B44A]' : 'bg-surface-3 text-subtle',
              )}
            >
              {done ? <Check className="size-4" /> : i + 1}
            </span>
            <span className={clsx('hidden text-[13.5px] font-medium sm:inline', active ? 'text-fg' : 'text-muted')}>{t(s.title)}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------- Bước 3: kết nối mô hình ----------------

const API_CHOICES: ProviderType[] = ['anthropic', 'openai', 'gemini', 'deepseek', 'openrouter'];

function ModelStep({ data, onReady }: { data: SetupResp; onReady: (providerId: string | null) => void }) {
  const { data: detected, isLoading } = useSWR<Detected[]>('/api/providers/detect', { revalidateOnFocus: false });
  const [choice, setChoice] = useState<ProviderType | null>(null);
  const [authMode, setAuthMode] = useState<ProviderAuthMode>('subscription');
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<Provider | null>(null);
  const [useApi, setUseApi] = useState(false);

  const existing = (type: ProviderType) => data.providers.find((p) => p.type === type);
  const preset: ProviderPreset | null = choice ? getPreset(choice) : null;
  const cliTiles = useMemo(() => {
    const found = (detected ?? []).filter((d) => getPreset(d.type).kind === 'cli');
    // CLI phổ biến chưa cài vẫn hiện (mờ) để bạn biết có thể dùng
    const common: ProviderType[] = ['claude-code', 'codex', 'gemini-cli', 'cursor-agent'];
    return [...found.map((d) => ({ type: d.type, detected: d })), ...common.filter((t) => !found.some((d) => d.type === t)).map((t) => ({ type: t, detected: null as Detected | null }))];
  }, [detected]);

  const pick = (type: ProviderType) => {
    setChoice(type);
    setTested(existing(type) ?? null);
    setAuthMode(getPreset(type).kind === 'api' ? 'api_key' : (existing(type)?.authMode ?? 'subscription'));
    setApiKey('');
  };

  const test = async () => {
    if (!choice || !preset) return;
    setTesting(true);
    try {
      const prev = existing(choice);
      const body = {
        type: choice,
        authMode: preset.kind === 'cli' ? authMode : undefined,
        apiKey: apiKey.trim() || undefined,
        makeDefault: true,
        probe: true,
      };
      let p: Provider;
      if (prev) {
        await api.patch(`/api/providers/${prev._id}`, { ...body, makeDefault: true });
        p = (await api.post<{ provider: Provider }>(`/api/providers/${prev._id}/test`, { probe: true })).provider;
      } else {
        p = await api.post<Provider>('/api/providers', body);
      }
      setTested(p);
      await mutate('/api/setup');
    } catch (e) {
      toast.error(e);
    } finally {
      setTesting(false);
    }
  };

  const manual = existing('web-manual');
  const ok = tested?.envTest ? tested.envTest.status !== 'fail' : Boolean(tested?.status?.ok);
  useEffect(() => {
    onReady(choice === 'web-manual' ? (manual?._id ?? null) : ok && tested ? tested._id : null);
  }, [choice, ok, tested, manual, onReady]);

  const tile = (type: ProviderType, extra?: { detected?: Detected | null; disabled?: boolean }) => {
    const p = getPreset(type);
    const d = extra?.detected;
    const added = existing(type);
    return (
      <button
        key={type}
        type="button"
        disabled={extra?.disabled}
        onClick={() => pick(type)}
        className={clsx(
          'flex items-start gap-3 rounded-2xl border p-3 text-left transition-all',
          choice === type ? 'border-accent bg-accent/6 ring-2 ring-accent/30' : 'border-line hover:border-line-strong hover:bg-surface-2',
          extra?.disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
        )}
      >
        <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-semibold">
            {p.label}
            {d?.auth === 'present' && <Badge color="#5C9A68">{t('Đã đăng nhập')}</Badge>}
            {d?.auth === 'absent' && <Badge color="#C9952F">{t('Chưa đăng nhập')}</Badge>}
            {added?.envTest?.status === 'pass' && <Badge color="#5C9A68">{t('Đã kiểm tra')}</Badge>}
          </span>
          <span className="block truncate text-[12px] text-muted">{d ? d.version || d.path : extra?.disabled ? t('Chưa cài trên máy') : p.vendor}</span>
        </span>
      </button>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[13px] font-medium text-muted">{useApi ? t('Dùng API key') : t('Dùng gói đăng ký trên máy (Claude Pro/Max, ChatGPT, Google…)')}</div>
        <button type="button" onClick={() => setUseApi((v) => !v)} className="text-[12.5px] font-medium text-accent hover:underline">
          {useApi ? t('Dùng gói đăng ký') : t('Dùng API key thay thế')}
        </button>
      </div>
      {!useApi ? (
        isLoading ? (
          <div className="flex items-center gap-2 py-6 text-[13px] text-muted">
            <Spinner /> {t('Đang quét các agent CLI trên máy…')}
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">{cliTiles.map((t) => tile(t.type, { detected: t.detected, disabled: !t.detected }))}</div>
        )
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">{API_CHOICES.map((t) => tile(t))}</div>
      )}
      <button
        type="button"
        onClick={() => pick('web-manual')}
        className={clsx('flex w-full items-center gap-3 rounded-2xl border border-dashed p-3 text-left text-[13px]', choice === 'web-manual' ? 'border-accent bg-accent/6' : 'border-line text-muted hover:border-line-strong')}
      >
        <Globe className="size-4 shrink-0" />
        {t('Chưa có gì cả? Dùng ChatGPT / Claude.ai trên trình duyệt – bạn tự chuyển tiếp prompt (thêm kết nối khác sau).')}
      </button>

      {preset && choice !== 'web-manual' && (
        <div className="space-y-3 rounded-2xl border border-line bg-surface-2/50 p-4">
          <div className="text-[12.5px] text-muted">{t(preset.setup)}</div>
          {preset.kind === 'cli' && preset.apiKeyEnv && (
            <Segmented<ProviderAuthMode>
              value={authMode}
              onChange={setAuthMode}
              options={[
                { value: 'subscription', label: t('Gói đăng ký (đăng nhập CLI)') },
                { value: 'api_key', label: 'API key' },
              ]}
            />
          )}
          {(preset.kind === 'api' || authMode === 'api_key') && (
            <Field label={preset.kind === 'cli' ? preset.apiKeyEnv : 'API key'} hint={existing(choice!)?.hasApiKey ? t('Đã lưu ({preview}). Để trống để giữ nguyên.', { preview: existing(choice!)?.apiKeyPreview }) : t('Khóa chỉ lưu trên máy bạn.')}>
              <Input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" className="font-mono" />
            </Field>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={test} loading={testing} icon={preset.kind === 'cli' ? <Laptop className="size-4" /> : <KeyRound className="size-4" />}>
              {testing ? t('Đang kiểm tra (agent trả lời thử)…') : t('Kiểm tra môi trường')}
            </Button>
            {tested && <span className={clsx('text-[12.5px]', ok ? 'text-ok' : 'text-danger')}>{checkText(tested.status?.message ?? '', tested.status?.messageI18n)}</span>}
          </div>
          {tested?.envTest && <EnvTestView result={tested.envTest} defaultOpen />}
        </div>
      )}
    </div>
  );
}

// ---------------- Trang ----------------

export default function SetupPage() {
  const router = useRouter();
  const { data } = useSWR<SetupResp>('/api/setup', { revalidateOnFocus: false });
  const [step, setStep] = useState(() => (typeof window === 'undefined' ? 0 : (readDraft().step ?? 0)));
  const [name, setName] = useState(() => (typeof window === 'undefined' ? '' : (readDraft().name ?? '')));
  const [mission, setMission] = useState(() => (typeof window === 'undefined' ? '' : (readDraft().mission ?? '')));
  const [teamId, setTeamId] = useState(() => (typeof window === 'undefined' ? 'full' : (readDraft().teamId ?? 'full')));
  const [leadTitle, setLeadTitle] = useState(() => (typeof window === 'undefined' ? '' : (readDraft().leadTitle ?? '')));
  const [providerId, setProviderId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Đang rời trang sau khi bấm "Bắt đầu" (đừng tự chuyển về trang chủ)
  const [leaving, setLeaving] = useState(false);

  // Lưu bản nháp (không lưu key) để tải lại trang không mất bước đang làm
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ step, name, mission, teamId, leadTitle }));
    } catch {
      /* trình duyệt chặn lưu */
    }
  }, [step, name, mission, teamId, leadTitle]);

  // Đã thiết lập xong (vd mở /setup sau này) → về trang chủ
  useEffect(() => {
    if (data && !data.needsSetup && !busy && !leaving) router.replace('/');
  }, [data, busy, leaving, router]);

  const companyName = name.trim() || data?.company?.name || '';
  const team = TEAM_TEMPLATES.find((t) => t.id === teamId) ?? TEAM_TEMPLATES[0];

  const next = async () => {
    setBusy(true);
    try {
      if (step === 0) {
        if (!name.trim()) {
          toast.error(t('Nhập tên công ty'));
          return;
        }
        await api.post('/api/setup', { step: 'company', name, mission });
      } else if (step === 1) {
        // i18n-ignore: chức danh mặc định lưu vào CSDL bằng tiếng Việt gốc (giao diện dịch khi hiển thị)
        await api.post('/api/setup', { step: 'team', teamId, leadTitle: teamId === 'solo' ? leadTitle || 'Chánh văn phòng' : undefined });
      } else if (step === 2) {
        if (providerId) await api.post('/api/setup', { step: 'model', providerId });
      } else {
        setLeaving(true);
        const r = await api.post<{ projectId: string }>('/api/setup', { step: 'finish' });
        try {
          localStorage.removeItem(DRAFT_KEY);
        } catch {
          /* bỏ qua */
        }
        await mutate('/api/setup');
        router.replace(`/office?chat=${r.projectId}`);
        return;
      }
      setStep((s) => s + 1);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const canNext = step === 0 ? Boolean(name.trim()) : step === 2 ? Boolean(providerId) : true;
  const tested = data?.providers.find((p) => p._id === (providerId ?? data.defaultProviderId));

  return (
    <div className="min-h-screen px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-10">
        <aside className="space-y-6">
          <div className="flex items-center gap-2.5">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-[#25211c] text-[#E0B44A]">
              <Sparkles className="size-5" />
            </span>
            <div>
              {/* i18n-ignore: tên sản phẩm */}
              <div className="font-display text-[18px] font-semibold">JVCompany</div>
              <div className="text-[12px] text-muted">{t('Thiết lập ban đầu')}</div>
            </div>
          </div>
          {/* Bước lưu nháp chỉ hiện sau khi tải xong (tránh lệch với bản dựng phía server) */}
          <Stepper step={data ? step : 0} />
          <p className="hidden text-[12.5px] leading-relaxed text-muted lg:block">
            {t('Bạn là chủ công ty. Các phòng ban là nhân viên AI: bạn giao mục tiêu, giám đốc chia việc, các phòng làm và báo cáo lại – bạn duyệt và theo dõi chi phí.')}
          </p>
        </aside>

        <section className="glass rounded-[30px] p-5 sm:p-8">
          {!data ? (
            <div className="flex items-center gap-2 py-16 text-muted">
              <Spinner /> {t('Đang tải…')}
            </div>
          ) : (
            <>
              {step === 0 && (
                <div className="space-y-5">
                  <div>
                    <h1 className="font-display text-[28px] font-semibold">{t('Công ty của bạn tên là gì?')}</h1>
                    <p className="mt-1 text-[14px] text-muted">{t('Tên hiện ở toà nhà và trong lời chào của các nhân viên AI.')}</p>
                  </div>
                  <Field label={t('Tên công ty')}>
                    <Input
                      autoFocus
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && name.trim()) void next();
                      }}
                      placeholder={t('VD: Công ty Phần mềm Ánh Dương')}
                      className="text-[15px]"
                    />
                  </Field>
                  <Field label={t('Sứ mệnh / mục tiêu lớn (tuỳ chọn)')} hint={t('Dòng đầu trở thành mục tiêu gốc của công ty – mọi dự án và nhiệm vụ đều hướng về đây.')}>
                    <Textarea
                      value={mission}
                      onChange={(e) => setMission(e.target.value)}
                      rows={3}
                      placeholder={t('VD: Ra mắt ứng dụng ghi chú AI số 1 Việt Nam trong 6 tháng\nTập trung người dùng văn phòng, ưu tiên tốc độ và quyền riêng tư.')}
                    />
                  </Field>
                </div>
              )}

              {step === 1 && (
                <div className="space-y-5">
                  <div>
                    <h1 className="font-display text-[28px] font-semibold">{t('Chọn đội ngũ đầu tiên')}</h1>
                    <p className="mt-1 text-[14px] text-muted">{t('Có thể thêm/bớt phòng ban hoặc cài thêm đội mẫu bất cứ lúc nào.')}</p>
                  </div>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {TEAM_TEMPLATES.map((tm) => (
                      <button
                        key={tm.id}
                        type="button"
                        onClick={() => setTeamId(tm.id)}
                        className={clsx(
                          'flex flex-col gap-2 rounded-2xl border p-3.5 text-left transition-all',
                          teamId === tm.id ? 'border-accent bg-accent/6 ring-2 ring-accent/30' : 'border-line hover:border-line-strong hover:bg-surface-2',
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <span className="text-[14px] font-semibold">{t(tm.name)}</span>
                          <Badge color="#958B7E">{t(tm.category)}</Badge>
                        </span>
                        <span className="text-[12.5px] text-muted">{t(tm.description)}</span>
                        <span className="flex flex-wrap gap-1">
                          {tm.departments.map((id) => {
                            const d = DEPT_INFO[id];
                            return d ? <DeptAvatar key={id} icon={d.icon} color={d.color} size="sm" className="!size-7" /> : null;
                          })}
                        </span>
                      </button>
                    ))}
                  </div>
                  {teamId === 'solo' && (
                    <Field label={t('Chức danh trợ lý của bạn')}>
                      <Input value={leadTitle} onChange={(e) => setLeadTitle(e.target.value)} placeholder={t('Chánh văn phòng')} />
                    </Field>
                  )}
                </div>
              )}

              {step === 2 && (
                <div className="space-y-5">
                  <div>
                    <h1 className="font-display text-[28px] font-semibold">{t('Kết nối mô hình AI')}</h1>
                    <p className="mt-1 text-[14px] text-muted">{t('JVCompany làm việc bằng gói đăng ký hoặc API key của bạn. Chọn một kết nối và kiểm tra để tiếp tục.')}</p>
                  </div>
                  <ModelStep data={data} onReady={setProviderId} />
                </div>
              )}

              {step === 3 && (
                <div className="space-y-5">
                  <div>
                    <h1 className="font-display text-[28px] font-semibold">{t('Mọi thứ đã sẵn sàng!')}</h1>
                    <p className="mt-1 text-[14px] text-muted">
                      {t('{name} có {n} phòng ban. Giám đốc sẽ chào bạn và hỏi bạn muốn bắt đầu thế nào.', { name: companyName, n: team.departments.length })}
                    </p>
                  </div>
                  <div className="space-y-2 rounded-2xl border border-line p-4 text-[13.5px]">
                    <div className="flex items-center gap-2">
                      <Building2 className="size-4 text-muted" /> <b>{companyName}</b>
                      {mission.trim() && <span className="truncate text-muted">· {mission.split('\n')[0]}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="size-4 text-muted" /> {t(team.name)}
                      <span className="flex gap-1">
                        {team.departments.map((id) => {
                          const d = DEPT_INFO[id];
                          return d ? <DeptAvatar key={id} icon={d.icon} color={d.color} size="sm" className="!size-6" /> : null;
                        })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <PlugZap className="size-4 text-muted" /> {tested ? `${tested.name} · ${checkText(tested.status?.message ?? '', tested.status?.messageI18n)}` : t('Kết nối mặc định')}
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-8 flex items-center justify-between gap-3 border-t border-line pt-5">
                {step > 0 ? (
                  <Button variant="ghost" onClick={() => setStep((s) => s - 1)} icon={<ArrowLeft className="size-4" />}>
                    {t('Quay lại')}
                  </Button>
                ) : (
                  <span />
                )}
                <Button variant="primary" onClick={next} loading={busy} disabled={!canNext} icon={step === 3 ? <Rocket className="size-4" /> : <ArrowRight className="size-4" />}>
                  {step === 3 ? t('Bắt đầu') : t('Tiếp tục')}
                </Button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}


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
import { LanguageSwitch } from '@/components/language-switch';
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
  { title: m('Tên công ty'), hint: m('Tên và sứ mệnh') },
  { title: m('Đội ngũ đầu tiên'), hint: m('Chọn phòng ban AI') },
  { title: m('Kết nối mô hình'), hint: m('Gói đăng ký hoặc API key') },
  { title: m('Bắt đầu'), hint: m('Giám đốc chào bạn') },
];

/** Gợi ý sứ mệnh (bấm để điền). */
const MISSION_IDEAS = [m('Ra mắt sản phẩm SaaS đầu tiên trong 3 tháng'), m('Tự động hoá lập trình và kiểm thử cho đội nhỏ'), m('Làm website và app cho cửa hàng của tôi')];

const DRAFT_KEY = 'jv.setupDraft';
type Draft = { step: number; name: string; mission: string; teamId: string; leadTitle: string };

function readDraft(): Partial<Draft> {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') as Partial<Draft>;
  } catch {
    return {};
  }
}

function Logo({ inverted }: { inverted?: boolean }) {
  return (
    <span
      className={clsx(
        'relative flex size-10 shrink-0 items-center justify-center rounded-2xl font-display text-[18px] font-semibold italic',
        inverted ? 'bg-[#f3efe6] text-[#1f1a14]' : 'bg-[#1f1a14] text-[#f3efe6] dark:bg-[#f3efe6] dark:text-[#1f1a14]',
      )}
    >
      jv
      <span className="absolute -right-1 -bottom-1 size-3.5 rounded-[5px] border-2 border-bg bg-accent" style={inverted ? { borderColor: '#1f1a14' } : undefined} />
    </span>
  );
}

/** Các bước dọc trên panel mực: số / dấu tích, tên bước, mô tả ngắn, đường nối giữa các bước. */
function Stepper({ step }: { step: number }) {
  return (
    <ol>
      {STEPS.map((s, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <li key={s.title} className="relative flex gap-3.5 py-2">
            {i < STEPS.length - 1 && (
              <span className={clsx('absolute top-10 -bottom-2 left-4 w-px -translate-x-1/2 transition-colors duration-500', done ? 'bg-[#e07a4f]' : 'bg-white/12')} />
            )}
            <span
              className={clsx(
                'relative flex size-8 shrink-0 items-center justify-center rounded-full text-[12.5px] font-semibold transition-colors duration-300',
                done ? 'bg-[#e07a4f] text-[#1a0f08]' : active ? 'bg-[#f3efe6] text-[#1f1a14]' : 'border border-white/15 text-white/45',
              )}
            >
              {done ? <Check className="size-4" /> : i + 1}
            </span>
            <span className="min-w-0 pt-0.5">
              <span className={clsx('block text-[14px] font-semibold', active ? 'text-white' : done ? 'text-white/80' : 'text-white/45')}>{t(s.title)}</span>
              <span className={clsx('block text-[12.5px]', active ? 'text-white/60' : 'text-white/35')}>{t(s.hint)}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Toà nhà thu nhỏ: biển trên nóc hiện tên công ty đang gõ, mỗi phòng ban sáng một ô cửa (từ tầng dưới lên). */
function BuildingPreview({ name, lit }: { name: string; lit: number }) {
  const FLOORS = 5;
  const COLS = 6;
  return (
    <div className="flex flex-col items-center" aria-hidden="true">
      <div className="max-w-[220px] truncate rounded-lg bg-[#f3efe6] px-3.5 py-1.5 font-display text-[13px] font-semibold tracking-[0.14em] text-[#1f1a14] uppercase">
        {name}
      </div>
      <div className="flex w-[124px] justify-between px-6">
        <span className="h-3 w-px bg-white/25" />
        <span className="h-3 w-px bg-white/25" />
      </div>
      <div className="h-1.5 w-[196px] rounded-t-sm bg-white/20" />
      <div className="grid w-[184px] gap-1.5 border-x border-white/15 bg-white/[0.04] p-2.5" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}>
        {Array.from({ length: FLOORS * COLS }, (_, i) => {
          const fromBottom = (FLOORS - 1 - Math.floor(i / COLS)) * COLS + (i % COLS);
          return <span key={i} className={clsx('h-2 rounded-[2px] transition-colors duration-500', fromBottom < lit ? 'bg-[#E0B44A]' : 'bg-white/[0.08]')} />;
        })}
      </div>
      <div className="flex w-[184px] justify-center border-x border-white/15 bg-white/[0.04] pb-0">
        <span className="h-5 w-7 rounded-t-md border-x border-t border-white/20 bg-white/[0.06]" />
      </div>
      <div className="h-px w-[280px] bg-white/20" />
    </div>
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

  // Bản nháp (localStorage) chỉ dùng sau khi tải xong dữ liệu – trước đó giống hệt bản dựng phía server (tránh lệch hydrate)
  const shownStep = data ? step : 0;
  const signName = (data && name.trim()) || data?.company?.name || t('Công ty của bạn');
  const shownTeam = data ? team : TEAM_TEMPLATES[0];

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Panel mực: thương hiệu, các bước, xem trước toà nhà */}
      <aside className="hidden shrink-0 flex-col justify-between gap-6 overflow-y-auto bg-[#1f1a14] px-10 py-8 text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-[420px] xl:w-[460px] dark:border-r dark:border-line dark:bg-[#0f0d0b]">
        <div className="flex items-center gap-3">
          <Logo inverted />
          <div>
            {/* i18n-ignore: tên sản phẩm */}
            <div className="font-display text-[19px] font-semibold">JVCompany</div>
            <div className="text-[11.5px] font-semibold tracking-[0.16em] text-white/45 uppercase">{t('Thiết lập ban đầu')}</div>
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <h2 className="font-display text-[34px] leading-[1.08] font-semibold">{t('Dựng công ty AI của bạn')}</h2>
            <p className="mt-3 text-[13.5px] leading-relaxed text-white/60 [@media(max-height:860px)]:hidden">
              {t('Bạn là chủ công ty. Các phòng ban là nhân viên AI: bạn giao mục tiêu, giám đốc chia việc, các phòng làm và báo cáo lại – bạn duyệt và theo dõi chi phí.')}
            </p>
          </div>
          {/* Bước lưu nháp chỉ hiện sau khi tải xong (tránh lệch với bản dựng phía server) */}
          <Stepper step={shownStep} />
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-4 text-[11px] font-semibold tracking-[0.16em] text-white/40 uppercase">{t('Xem trước')}</div>
          <BuildingPreview name={signName} lit={shownTeam.departments.length} />
          <div className="mt-4 space-y-2 text-[12.5px] text-white/70">
            <div className="flex items-center gap-2">
              <Users className="size-3.5 shrink-0 text-white/40" />
              <span className="truncate">{t(shownTeam.name)}</span>
              <span className="ml-auto flex -space-x-1.5">
                {shownTeam.departments.slice(0, 6).map((id) => {
                  const d = DEPT_INFO[id];
                  return d ? <DeptAvatar key={id} icon={d.icon} color={d.color} size="sm" className="!size-6 ring-2 ring-[#1f1a14] dark:ring-[#0f0d0b]" /> : null;
                })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <PlugZap className="size-3.5 shrink-0 text-white/40" />
              <span className="truncate">{tested ? getPreset(tested.type).label : t('Chưa kết nối')}</span>
              {tested && <span className="ml-auto size-2 shrink-0 rounded-full bg-[#6faf7f]" />}
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 px-5 py-4 sm:px-10 sm:py-6">
          <div className="flex items-center gap-2.5 lg:invisible">
            <Logo />
            {/* i18n-ignore: tên sản phẩm */}
            <span className="font-display text-[17px] font-semibold">JVCompany</span>
          </div>
          <LanguageSwitch placement="down" />
        </header>

        <div className="flex flex-1 flex-col px-5 pb-10 sm:px-10">
          <section className="mx-auto my-auto w-full max-w-[620px] py-4">
            <div className="mb-7">
              <div className="mb-2.5 flex items-center justify-between text-[12.5px] font-medium text-muted">
                <span>{t('Bước {n}/{total}', { n: shownStep + 1, total: STEPS.length })}</span>
                <span>{t(STEPS[shownStep].title)}</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {STEPS.map((s, i) => (
                  <span key={s.title} className={clsx('h-1.5 rounded-full transition-colors duration-500', i <= shownStep ? 'bg-accent' : 'bg-surface-3')} />
                ))}
              </div>
            </div>

            {!data ? (
              <div className="flex items-center gap-2 py-16 text-muted">
                <Spinner /> {t('Đang tải…')}
              </div>
            ) : (
              <>
                <div key={step} className="animate-jv-in">
                  {step === 0 && (
                    <div className="space-y-6">
                      <div>
                        <h1 className="font-display text-[30px] leading-tight font-semibold sm:text-[36px]">{t('Công ty của bạn tên là gì?')}</h1>
                        <p className="mt-2 text-[15px] text-muted">{t('Tên hiện ở toà nhà và trong lời chào của các nhân viên AI.')}</p>
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
                          className="h-12 text-[16px]"
                        />
                      </Field>
                      <div className="space-y-2.5">
                        <Field label={t('Sứ mệnh / mục tiêu lớn (tuỳ chọn)')} hint={t('Dòng đầu trở thành mục tiêu gốc của công ty – mọi dự án và nhiệm vụ đều hướng về đây.')}>
                          <Textarea
                            value={mission}
                            onChange={(e) => setMission(e.target.value)}
                            rows={3}
                            placeholder={t('VD: Ra mắt ứng dụng ghi chú AI số 1 Việt Nam trong 6 tháng\nTập trung người dùng văn phòng, ưu tiên tốc độ và quyền riêng tư.')}
                          />
                        </Field>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="mr-1 flex items-center gap-1 text-[12px] font-medium text-subtle">
                            <Sparkles className="size-3.5" /> {t('Gợi ý')}
                          </span>
                          {MISSION_IDEAS.map((idea) => (
                            <button
                              key={idea}
                              type="button"
                              onClick={() => setMission(t(idea))}
                              className="rounded-full border border-line bg-surface px-3 py-1 text-[12.5px] text-muted transition-colors hover:border-accent hover:text-accent"
                            >
                              {t(idea)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {step === 1 && (
                    <div className="space-y-6">
                      <div>
                        <h1 className="font-display text-[30px] leading-tight font-semibold sm:text-[36px]">{t('Chọn đội ngũ đầu tiên')}</h1>
                        <p className="mt-2 text-[15px] text-muted">{t('Có thể thêm/bớt phòng ban hoặc cài thêm đội mẫu bất cứ lúc nào.')}</p>
                      </div>
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        {TEAM_TEMPLATES.map((tm) => (
                          <button
                            key={tm.id}
                            type="button"
                            onClick={() => setTeamId(tm.id)}
                            className={clsx(
                              'relative flex flex-col gap-2 rounded-2xl border bg-surface p-4 text-left transition-all',
                              teamId === tm.id ? 'border-accent ring-2 ring-accent/30' : 'border-line hover:border-line-strong hover:bg-surface-2',
                            )}
                          >
                            {teamId === tm.id && (
                              <span className="absolute top-3 right-3 flex size-5 items-center justify-center rounded-full bg-accent text-accent-fg">
                                <Check className="size-3" />
                              </span>
                            )}
                            <span className="flex items-center gap-2 pr-6">
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
                    <div className="space-y-6">
                      <div>
                        <h1 className="font-display text-[30px] leading-tight font-semibold sm:text-[36px]">{t('Kết nối mô hình AI')}</h1>
                        <p className="mt-2 text-[15px] text-muted">{t('JVCompany làm việc bằng gói đăng ký hoặc API key của bạn. Chọn một kết nối và kiểm tra để tiếp tục.')}</p>
                      </div>
                      <ModelStep data={data} onReady={setProviderId} />
                    </div>
                  )}

                  {step === 3 && (
                    <div className="space-y-6">
                      <div>
                        <span className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-accent/12 text-accent">
                          <Rocket className="size-6" />
                        </span>
                        <h1 className="font-display text-[30px] leading-tight font-semibold sm:text-[36px]">{t('Mọi thứ đã sẵn sàng!')}</h1>
                        <p className="mt-2 text-[15px] text-muted">
                          {t('{name} có {n} phòng ban. Giám đốc sẽ chào bạn và hỏi bạn muốn bắt đầu thế nào.', { name: companyName, n: team.departments.length })}
                        </p>
                      </div>
                      <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface text-[13.5px]">
                        <div className="flex items-center gap-3 p-4">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-muted">
                            <Building2 className="size-4" />
                          </span>
                          <span className="min-w-0">
                            <b className="block truncate">{companyName}</b>
                            {mission.trim() && <span className="block truncate text-[12.5px] text-muted">{mission.split('\n')[0]}</span>}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 p-4">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-muted">
                            <Users className="size-4" />
                          </span>
                          <span className="min-w-0 flex-1 truncate">{t(team.name)}</span>
                          <span className="flex -space-x-1.5">
                            {team.departments.map((id) => {
                              const d = DEPT_INFO[id];
                              return d ? <DeptAvatar key={id} icon={d.icon} color={d.color} size="sm" className="!size-7 ring-2 ring-surface" /> : null;
                            })}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 p-4">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-muted">
                            <PlugZap className="size-4" />
                          </span>
                          <span className="min-w-0 truncate">
                            {tested ? `${getPreset(tested.type).label} · ${checkText(tested.status?.message ?? '', tested.status?.messageI18n)}` : t('Kết nối mặc định')}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-9 flex items-center justify-between gap-3 border-t border-line pt-6">
                  {step > 0 ? (
                    <Button variant="ghost" onClick={() => setStep((s) => s - 1)} icon={<ArrowLeft className="size-4" />}>
                      {t('Quay lại')}
                    </Button>
                  ) : (
                    <span className="hidden text-[12.5px] text-subtle sm:inline">{t('Nhấn Enter để tiếp tục')}</span>
                  )}
                  <Button variant="primary" className="ml-auto" onClick={next} loading={busy} disabled={!canNext} icon={step === 3 ? <Rocket className="size-4" /> : <ArrowRight className="size-4" />}>
                    {step === 3 ? t('Bắt đầu') : t('Tiếp tục')}
                  </Button>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}


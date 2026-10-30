'use client';
import { useState, type ReactNode } from 'react';
import useSWR, { mutate } from 'swr';
import clsx from 'clsx';
import {
  Activity,
  CircleAlert,
  Coins,
  Cpu,
  Gauge,
  Globe,
  Hourglass,
  KeyRound,
  Laptop,
  Network,
  Pencil,
  PlugZap,
  Plus,
  RefreshCw,
  ScanSearch,
  Star,
  Trash2,
  TimerReset,
  Users,
  Wallet,
} from 'lucide-react';
import type { AdapterField, Department, Provider, ProviderAuthMode, ProviderKind, ProviderQuota, ProviderType, ProviderUsage, UsageBucket } from '@/lib/types';
import { PROVIDER_KIND_LABEL, PROVIDER_PRESETS, WEB_TARGETS, getPreset, modelAvailable, type ProviderPreset } from '@/lib/catalog';
import { api } from '@/lib/client/api';
import { clock, compact, dateTime, timeAgo, tint, useNow } from '@/lib/client/format';
import { Page, PageHeader } from '@/components/shell';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Segmented, Select, Skeleton, Spinner, Switch, confirmDialog, toast } from '@/components/ui';
import { ModelPicker } from '@/components/model-picker';
import { EnvTestView, checkText } from '@/components/env-test';
import { formatNumber, localize, localizedContent, t, tc } from '@/lib/i18n';
import type { LocalizedText } from '@/lib/i18n/format';

/** Câu trạng thái đã lưu sau lần kiểm tra gần nhất, theo ngôn ngữ giao diện (dữ liệu cũ không có khoá → thử t()). */
function statusMessage(p: Provider): string {
  return p.status ? checkText(p.status.message, p.status.messageI18n) : '';
}

interface Resp {
  providers: Provider[];
  defaultProviderId: string | null;
}

interface ModelsResp {
  ok: boolean;
  models: string[];
  message: string;
  /** Khoá dịch của message (máy chủ tạo bằng sysMsg). */
  i18n?: LocalizedText;
}

interface Detected {
  type: ProviderType;
  label: string;
  command: string;
  path: string;
  version: string;
  models?: string[];
  auth?: 'present' | 'absent' | 'unknown';
}

const KIND_ICON: Record<ProviderKind, typeof KeyRound> = { api: KeyRound, cli: Laptop, gateway: Network, manual: Globe };
const KIND_DESC: Record<ProviderKind, string> = localize({
  api: 'Gọi trực tiếp qua API key – hỗ trợ đầy đủ công cụ: đọc/ghi tệp, chạy lệnh, điều khiển máy tính.',
  cli: 'Dùng gói đăng ký (Claude Pro/Max, ChatGPT Plus/Pro, Google, Cursor…) hoặc API key qua ứng dụng/CLI cài trên máy. Agent làm việc trực tiếp trong thư mục dự án.',
  gateway: 'Thuê agent đang chạy ở máy hoặc dịch vụ khác: Hermes Gateway, OpenClaw, Cursor Cloud, hoặc bất kỳ webhook HTTP nào.',
  manual: 'Dùng gói đăng ký trên web: hệ thống soạn prompt chuẩn, bạn dán vào ChatGPT/Claude.ai/Gemini/Grok và dán kết quả lại.',
});

type FormState = {
  name: string;
  baseUrl: string;
  apiKey: string;
  command: string;
  extraArgs: string;
  promptMode: 'stdin' | 'arg' | 'file';
  webUrl: string;
  defaultModel: string;
  makeDefault: boolean;
  authMode: ProviderAuthMode;
  env: string;
  headers: string;
  cwd: string;
  timeoutSec: string;
  options: Record<string, string | number | boolean>;
  secretOptions: Record<string, string>;
};

/** "KEY=giá trị" mỗi dòng ⇄ object. */
function toLines(m?: Record<string, string>): string {
  return Object.entries(m ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}
function fromLines(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of s.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/** Dữ liệu gửi lên API từ form (dùng chung cho thêm / sửa). */
function payload(preset: ProviderPreset, form: FormState) {
  return {
    name: form.name,
    baseUrl: form.baseUrl,
    apiKey: form.apiKey,
    command: form.command,
    extraArgs: form.extraArgs.split(/\s+/).filter(Boolean),
    promptMode: form.promptMode,
    webUrl: form.webUrl,
    defaultModel: form.defaultModel,
    makeDefault: form.makeDefault,
    authMode: preset.kind === 'cli' ? form.authMode : undefined,
    env: preset.kind === 'cli' ? fromLines(form.env) : undefined,
    headers: preset.kind === 'gateway' ? fromLines(form.headers) : undefined,
    cwd: preset.kind === 'cli' ? form.cwd : undefined,
    timeoutSec: Number(form.timeoutSec) || 0,
    options: form.options,
    secretOptions: form.secretOptions,
  };
}

function initialForm(preset: ProviderPreset, p?: Provider): FormState {
  return {
    name: p?.name ?? preset.label,
    baseUrl: p?.baseUrl ?? preset.baseUrl ?? '',
    apiKey: '',
    command: p?.command ?? preset.command ?? '',
    extraArgs: (p?.extraArgs ?? []).join(' '),
    promptMode: p?.promptMode ?? 'stdin',
    webUrl: p?.webUrl ?? preset.webUrl ?? '',
    defaultModel: p?.defaultModel ?? preset.defaultModel ?? '',
    makeDefault: false,
    authMode: p?.authMode ?? 'subscription',
    env: toLines(p?.env),
    headers: toLines(p?.headers),
    cwd: p?.cwd ?? '',
    timeoutSec: p?.timeoutSec ? String(p.timeoutSec) : '',
    options: {
      ...Object.fromEntries((preset.fields ?? []).filter((f) => f.type !== 'secret').map((f) => [f.key, p?.options?.[f.key] ?? f.default ?? (f.type === 'toggle' ? false : '')])),
      ...(preset.type === 'http-webhook' ? { callbackBaseUrl: p?.options?.callbackBaseUrl ?? '' } : {}),
    },
    secretOptions: {},
  };
}

/** Một ô cấu hình riêng của loại kết nối. */
function AdapterFieldInput({ field, form, setForm, saved }: { field: AdapterField; form: FormState; setForm: (f: FormState) => void; saved: boolean }) {
  const v = form.options[field.key];
  const setOpt = (val: string | number | boolean) => setForm({ ...form, options: { ...form.options, [field.key]: val } });
  if (field.type === 'toggle') {
    return (
      <label className="flex cursor-pointer items-center gap-2 text-[13px]">
        <input type="checkbox" checked={Boolean(v)} onChange={(e) => setOpt(e.target.checked)} className="size-4 accent-[var(--accent)]" />
        {field.label}
        {field.help && <span className="font-mono text-[11.5px] text-subtle">{field.help}</span>}
      </label>
    );
  }
  return (
    <Field label={field.label} hint={field.type === 'secret' && saved ? t('Đã lưu. Để trống để giữ nguyên.') : field.help}>
      {field.type === 'select' ? (
        <Select value={String(v ?? '')} onChange={(e) => setOpt(e.target.value)}>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ) : field.type === 'textarea' ? (
        <textarea
          value={String(v ?? '')}
          onChange={(e) => setOpt(e.target.value)}
          placeholder={field.placeholder}
          rows={3}
          className="w-full rounded-xl border border-line bg-surface px-3 py-2 font-mono text-[12.5px] outline-none focus:border-line-strong"
        />
      ) : field.type === 'secret' ? (
        <Input
          type="password"
          autoComplete="off"
          value={form.secretOptions[field.key] ?? ''}
          onChange={(e) => setForm({ ...form, secretOptions: { ...form.secretOptions, [field.key]: e.target.value } })}
          placeholder={saved ? '••••••••' : field.placeholder}
          className="font-mono"
        />
      ) : (
        <Input
          type={field.type === 'number' ? 'number' : 'text'}
          value={String(v ?? '')}
          onChange={(e) => setOpt(e.target.value)}
          placeholder={field.placeholder}
          className="font-mono text-[12.5px]"
        />
      )}
    </Field>
  );
}

function ProviderForm({ preset, form, setForm, editing }: { preset: ProviderPreset; form: FormState; setForm: (f: FormState) => void; editing?: Provider }) {
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm({ ...form, [k]: v });
  const isApi = preset.kind === 'api';
  // Sửa kết nối API đã có khóa: tự tải danh sách model mới nhất khi mở hộp thoại.
  const auto = useSWR<ModelsResp>(
    isApi && editing && (editing.hasApiKey || !preset.needsApiKey) ? `provider-models:${editing._id}` : null,
    () => api.post<ModelsResp>('/api/providers/models', { id: editing!._id }),
    { revalidateOnFocus: false },
  );
  const [fetched, setFetched] = useState<ModelsResp | null>(null);
  const [loading, setLoading] = useState(false);
  const result = fetched ?? auto.data ?? null;
  const live = isApi ? (result?.models.length ? result.models : (editing?.models ?? [])) : (fetched?.models ?? []);
  const loadModels = async () => {
    setLoading(true);
    try {
      const r = await api.post<ModelsResp>('/api/providers/models', {
        id: editing?._id,
        type: preset.type,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey,
        command: form.command,
        authMode: form.authMode,
      });
      setFetched(r);
      // Model đang chọn không có trong danh sách thật → chọn sẵn model phù hợp.
      const listed = { kind: 'api' as const, models: r.models };
      if (isApi && r.models.length && !modelAvailable(listed, form.defaultModel)) {
        setForm({ ...form, defaultModel: [preset.defaultModel, ...preset.models].find((m) => modelAvailable(listed, m)) ?? r.models[0] });
      }
    } catch (e) {
      setFetched({ ok: false, models: [], message: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  };
  const modelHint = loading || auto.isLoading ? (
    <span className="inline-flex items-center gap-1.5">
      <Spinner className="size-3" /> {t('Đang tải danh sách model…')}
    </span>
  ) : result ? (
    <span className={result.ok ? 'text-ok' : 'text-danger'}>{localizedContent(result.message, { i18n: result.i18n })}</span>
  ) : isApi ? (
    t('Bấm "Tải model" để lấy danh sách model thật từ API (cần API key).')
  ) : preset.tiers ? (
    t('Phòng ban dùng theo hạng (Cao cấp/Cân bằng/Nhanh) sẽ tự chọn model phù hợp.')
  ) : (
    t('Bấm làm mới để hỏi CLI danh sách model (nếu CLI hỗ trợ), hoặc chọn từ gợi ý / tự nhập.')
  );
  const fields = preset.fields ?? [];
  const keyLabel = preset.type === 'openclaw-gateway' ? t('Token gateway') : preset.type === 'http-webhook' ? t('Bearer token (tuỳ chọn)') : preset.type === 'cursor-cloud' ? 'CURSOR_API_KEY' : 'API key';
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface-2/60 p-3 text-[12.5px] text-muted">
        <div className="mb-1 font-medium text-fg">{t('Hướng dẫn')}</div>
        {preset.setup}
        {preset.docsUrl && (
          <a href={preset.docsUrl} target="_blank" rel="noreferrer" className="ml-1 text-accent underline">
            {t('Mở trang')}
          </a>
        )}
      </div>
      <Field label={t('Tên hiển thị')}>
        <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
      </Field>
      {preset.kind === 'api' && (
        <>
          <Field label="Base URL" hint={preset.type === 'anthropic' ? t('Để trống để dùng API chính thức của Anthropic.') : undefined}>
            <Input value={form.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} placeholder={preset.baseUrl ?? 'https://api.anthropic.com'} className="font-mono text-[12.5px]" />
          </Field>
          <Field label="API key" hint={editing?.hasApiKey ? t('Đã lưu ({preview}). Để trống để giữ nguyên.', { preview: editing.apiKeyPreview }) : preset.needsApiKey ? t('Khóa được lưu trong MongoDB trên máy bạn.') : t('Không bắt buộc.')}>
            <Input type="password" value={form.apiKey} onChange={(e) => set('apiKey', e.target.value)} placeholder={editing?.hasApiKey ? '••••••••' : 'sk-…'} autoComplete="off" className="font-mono" />
          </Field>
        </>
      )}
      {preset.kind === 'cli' && (
        <>
          <Field label={t('Lệnh / đường dẫn chương trình')} hint={t('Tên lệnh trong PATH hoặc đường dẫn đầy đủ tới tệp thực thi.')}>
            <Input value={form.command} onChange={(e) => set('command', e.target.value)} className="font-mono text-[12.5px]" placeholder={preset.command || 'my-agent'} />
          </Field>
          <Field label={t('Tham số bổ sung')} hint={preset.type === 'custom-cli' ? t('Cách nhau bởi dấu cách. {model} sẽ được thay bằng model.') : t('Tùy chọn – thêm vào cuối lệnh.')}>
            <Input value={form.extraArgs} onChange={(e) => set('extraArgs', e.target.value)} className="font-mono text-[12.5px]" placeholder={preset.type === 'custom-cli' ? '-p --model {model}' : ''} />
          </Field>
          {preset.type === 'custom-cli' && (
            <Field label={t('Cách truyền prompt')}>
              <Segmented
                value={form.promptMode}
                onChange={(v) => set('promptMode', v)}
                options={[
                  { value: 'stdin', label: t('Qua stdin') },
                  { value: 'arg', label: t('Tham số (tệp)') },
                ]}
              />
            </Field>
          )}
          {preset.apiKeyEnv && (
            <Field
              label={t('Cách xác thực')}
              hint={
                form.authMode === 'api_key'
                  ? t('Key được đưa vào biến {env} khi chạy (tính phí theo API).', { env: preset.apiKeyEnv })
                  : preset.loginCommand
                    ? t('Dùng tài khoản đã đăng nhập trong CLI (lệnh: {command}).', { command: preset.loginCommand })
                    : t('Dùng tài khoản đã đăng nhập trong CLI.')
              }
            >
              <Segmented<ProviderAuthMode>
                value={form.authMode}
                onChange={(v) => set('authMode', v)}
                options={[
                  { value: 'subscription', label: t('Gói đăng ký (đăng nhập CLI)') },
                  { value: 'api_key', label: 'API key' },
                ]}
              />
            </Field>
          )}
          {preset.apiKeyEnv && form.authMode === 'api_key' && (
            <Field label={preset.apiKeyEnv} hint={editing?.hasApiKey ? t('Đã lưu ({preview}). Để trống để giữ nguyên.', { preview: editing.apiKeyPreview }) : t('Khóa được lưu trong MongoDB trên máy bạn.')}>
              <Input type="password" value={form.apiKey} onChange={(e) => set('apiKey', e.target.value)} placeholder={editing?.hasApiKey ? '••••••••' : 'sk-…'} autoComplete="off" className="font-mono" />
            </Field>
          )}
        </>
      )}
      {preset.kind === 'gateway' && (
        <>
          {preset.type !== 'cursor-cloud' && (
            <Field label={preset.type === 'openclaw-gateway' ? t('Địa chỉ WebSocket') : 'URL'}>
              <Input value={form.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} placeholder={preset.baseUrl} className="font-mono text-[12.5px]" />
            </Field>
          )}
          <Field label={keyLabel} hint={editing?.hasApiKey ? t('Đã lưu ({preview}). Để trống để giữ nguyên.', { preview: editing.apiKeyPreview }) : undefined}>
            <Input type="password" value={form.apiKey} onChange={(e) => set('apiKey', e.target.value)} placeholder={editing?.hasApiKey ? '••••••••' : ''} autoComplete="off" className="font-mono" />
          </Field>
        </>
      )}
      {fields.length > 0 && (
        <div className="space-y-3 rounded-xl border border-line p-3">
          <div className="text-[12px] font-medium text-subtle">{t('Cấu hình riêng của {name}', { name: preset.label })}</div>
          {fields.map((f) => (
            <AdapterFieldInput key={f.key} field={f} form={form} setForm={setForm} saved={Boolean(editing?.secretOptionKeys?.includes(f.key))} />
          ))}
        </div>
      )}
      {(preset.kind === 'cli' || preset.kind === 'gateway') && (
        <details className="rounded-xl border border-line p-3">
          <summary className="cursor-pointer text-[12.5px] font-medium text-muted select-none">{t('Nâng cao')}</summary>
          <div className="mt-3 space-y-3">
            {preset.kind === 'cli' && (
              <>
                <Field label={t('Thư mục làm việc riêng')} hint={t('Để trống = thư mục của dự án.')}>
                  <Input value={form.cwd} onChange={(e) => set('cwd', e.target.value)} className="font-mono text-[12.5px]" placeholder={t('(thư mục dự án)')} />
                </Field>
                <Field label={t('Biến môi trường')} hint={t('Mỗi dòng một biến: TEN=giá trị')}>
                  <textarea
                    value={form.env}
                    onChange={(e) => set('env', e.target.value)}
                    rows={3}
                    placeholder="HTTPS_PROXY=http://127.0.0.1:8080"
                    className="w-full rounded-xl border border-line bg-surface px-3 py-2 font-mono text-[12.5px] outline-none focus:border-line-strong"
                  />
                </Field>
              </>
            )}
            {preset.kind === 'gateway' && (
              <Field label={t('Header HTTP thêm')} hint={t('Mỗi dòng một header: Ten-Header=giá trị')}>
                <textarea
                  value={form.headers}
                  onChange={(e) => set('headers', e.target.value)}
                  rows={2}
                  className="w-full rounded-xl border border-line bg-surface px-3 py-2 font-mono text-[12.5px] outline-none focus:border-line-strong"
                />
              </Field>
            )}
            {preset.type === 'http-webhook' && (
              <AdapterFieldInput
                field={{ key: 'callbackBaseUrl', label: t('Địa chỉ app để agent gọi lại'), type: 'text', placeholder: 'http://127.0.0.1:2501' }}
                form={form}
                setForm={setForm}
                saved={false}
              />
            )}
            <Field label={t('Giới hạn thời gian mỗi lượt (giây)')} hint={t('Để trống = mặc định (CLI 60 phút).')}>
              <Input type="number" value={form.timeoutSec} onChange={(e) => set('timeoutSec', e.target.value)} className="font-mono text-[12.5px]" />
            </Field>
          </div>
        </details>
      )}
      {preset.kind === 'manual' && (
        <Field label={t('Trang web mặc định')}>
          <Select value={form.webUrl} onChange={(e) => set('webUrl', e.target.value)}>
            {WEB_TARGETS.map((w) => (
              <option key={w.url} value={w.url}>
                {w.label} – {w.url}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {preset.kind !== 'manual' && (
        <Field label={t('Model mặc định')} hint={modelHint}>
          <ModelPicker
            value={form.defaultModel}
            onChange={(v) => set('defaultModel', v.trim())}
            live={live}
            suggested={[...preset.models, ...(editing?.models ?? [])]}
            emptyLabel={isApi ? undefined : t('Mặc định của CLI')}
            onRefresh={loadModels}
            refreshing={loading || auto.isLoading}
          />
        </Field>
      )}
      <label className="flex cursor-pointer items-center gap-2 text-[13px]">
        <input type="checkbox" checked={form.makeDefault} onChange={(e) => set('makeDefault', e.target.checked)} className="size-4 accent-[var(--accent)]" />
        {t('Đặt làm kết nối mặc định cho các phòng ban')}
      </label>
    </div>
  );
}

function AddModal({ open, onClose, initialType }: { open: boolean; onClose: () => void; initialType?: ProviderType | null }) {
  const [kind, setKind] = useState<ProviderKind>('api');
  const [preset, setPreset] = useState<ProviderPreset | null>(initialType ? getPreset(initialType) : null);
  const [form, setForm] = useState<FormState | null>(initialType ? initialForm(getPreset(initialType)) : null);
  const [busy, setBusy] = useState(false);

  const choose = (p: ProviderPreset) => {
    setPreset(p);
    setForm(initialForm(p));
  };
  const close = () => {
    setPreset(null);
    setForm(null);
    onClose();
  };
  const save = async () => {
    if (!preset || !form) return;
    setBusy(true);
    try {
      const p = await api.post<Provider>('/api/providers', { type: preset.type, ...payload(preset, form), probe: preset.kind === 'cli' || preset.kind === 'gateway' });
      await mutate('/api/providers');
      if (p.status?.ok) toast.success(t('Đã thêm {name} – {message}', { name: p.name, message: statusMessage(p) }));
      else toast.error(t('Đã thêm {name} nhưng kiểm tra lỗi: {message}', { name: p.name, message: statusMessage(p) }));
      close();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title={preset ? t('Thêm {name}', { name: preset.label }) : t('Thêm kết nối AI')}
      description={preset ? preset.description : t('Chọn cách kết nối: API key, gói đăng ký qua ứng dụng desktop, hoặc qua trình duyệt.')}
      footer={
        preset ? (
          <>
            <Button variant="ghost" onClick={() => (initialType ? close() : setPreset(null))}>
              {initialType ? t('Hủy') : t('Quay lại')}
            </Button>
            <Button variant="primary" onClick={save} loading={busy}>
              {t('Lưu & kiểm tra')}
            </Button>
          </>
        ) : undefined
      }
    >
      {!preset ? (
        <>
          <Segmented<ProviderKind>
            value={kind}
            onChange={setKind}
            options={[
              { value: 'api', label: 'API key' },
              { value: 'cli', label: t('Gói đăng ký · Desktop') },
              { value: 'gateway', label: t('Agent bên ngoài') },
              { value: 'manual', label: t('Trình duyệt') },
            ]}
          />
          <p className="mt-3 text-[13px] text-muted">{KIND_DESC[kind]}</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {PROVIDER_PRESETS.filter((p) => p.kind === kind).map((p) => (
              <button key={p.type} type="button" onClick={() => choose(p)} className="flex items-start gap-3 rounded-xl border border-line p-3 text-left transition-colors hover:border-line-strong hover:bg-surface-2">
                <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold">{p.label}</div>
                  <div className="text-[11.5px] text-subtle">{p.vendor}</div>
                  <div className="mt-1 line-clamp-2 text-[12px] text-muted">{p.description}</div>
                </div>
              </button>
            ))}
          </div>
        </>
      ) : (
        form && <ProviderForm preset={preset} form={form} setForm={setForm} />
      )}
    </Modal>
  );
}

function EditModal({ provider, onClose }: { provider: Provider; onClose: () => void }) {
  const preset = getPreset(provider.type);
  const [form, setForm] = useState<FormState>(initialForm(preset, provider));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/api/providers/${provider._id}`, payload(preset, form));
      const r = await api.post<{ provider: Provider }>(`/api/providers/${provider._id}/test`, { probe: true });
      await mutate('/api/providers');
      if (r.provider.status?.ok) {
        toast.success(t('Đã lưu · {message}', { message: statusMessage(r.provider) }));
        onClose();
      } else {
        toast.error(t('Đã lưu nhưng kiểm tra lỗi: {message}', { message: statusMessage(r.provider) }));
      }
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
      size="lg"
      title={t('Sửa {name}', { name: provider.name })}
      description={preset.description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Hủy')}
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            {t('Lưu & kiểm tra')}
          </Button>
        </>
      }
    >
      <ProviderForm preset={preset} form={form} setForm={setForm} editing={provider} />
    </Modal>
  );
}

function DetectModal({ open, onClose, existing, onAdd }: { open: boolean; onClose: () => void; existing: Provider[]; onAdd: (t: ProviderType) => void }) {
  const { data, isLoading, mutate: rescan } = useSWR<Detected[]>(open ? '/api/providers/detect' : null);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('Quét agent trên máy tính')}
      description={t('Tìm các ứng dụng/CLI AI đã cài (Claude Code, Codex, Gemini CLI, Cursor, OpenCode, Pi, Kimi, Grok, Hermes, Copilot, Qwen, Ollama…).')}
      footer={
        <Button variant="outline" onClick={() => rescan()} icon={<RefreshCw className="size-4" />}>
          {t('Quét lại')}
        </Button>
      }
    >
      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-[13px] text-muted">
          <Spinner /> {t('Đang quét…')}
        </div>
      ) : !data?.length ? (
        <EmptyState title={t('Không tìm thấy agent nào')} description={t('Cài một CLI (ví dụ: npm i -g @anthropic-ai/claude-code), đăng nhập rồi quét lại.')} />
      ) : (
        <div className="space-y-2">
          {data.map((d) => {
            const added = existing.some((p) => p.type === d.type);
            return (
              <div key={d.type} className="flex items-center gap-3 rounded-xl border border-line p-3">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: getPreset(d.type).color }} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold">{t(d.label)}</div>
                  <div className="truncate font-mono text-[11.5px] text-subtle">{d.path}</div>
                  {d.version && <div className="text-[12px] text-muted">{d.version}</div>}
                  {d.auth && d.auth !== 'unknown' && (
                    <div className={clsx('text-[12px]', d.auth === 'present' ? 'text-ok' : 'text-warn')}>{d.auth === 'present' ? t('Đã đăng nhập') : t('Chưa đăng nhập')}</div>
                  )}
                </div>
                {added ? (
                  <Badge color="#5C9A68">{t('Đã thêm')}</Badge>
                ) : (
                  <Button size="sm" variant="primary" onClick={() => onAdd(d.type)} icon={<Plus className="size-3.5" />}>
                    {t('Thêm')}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

const usd = (n: number) => (n <= 0 ? '$0' : n >= 100 ? `$${n.toFixed(0)}` : n >= 0.1 ? `$${n.toFixed(2)}` : n >= 0.01 ? `$${n.toFixed(3)}` : '<$0.01');
const tokens = (b: UsageBucket) => b.inputTokens + b.outputTokens;

/** "2 giờ 13 phút" / "45 phút" / "3 ngày". */
function remaining(iso: string, now: number): string {
  const m = Math.max(1, Math.round((new Date(iso).getTime() - now) / 60_000));
  if (m < 60) return t('{m} phút', { m });
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? t('{h} giờ {m} phút', { h, m: m % 60 }) : t('{h} giờ', { h });
  return t('{d} ngày', { d: Math.round(h / 24) });
}

const STATUS = localize({
  off: { label: 'Đã tắt', color: '#958B7E' },
  cooling: { label: 'Chờ hạn mức', color: '#C9952F' },
  ok: { label: 'Sẵn sàng', color: '#5C9A68' },
  error: { label: 'Lỗi', color: '#C4483F' },
  unknown: { label: 'Chưa kiểm tra', color: '#958B7E' },
} as const);

function statusOf(p: Provider, now: number): keyof typeof STATUS {
  if (!p.enabled) return 'off';
  if (p.cooldownUntil && new Date(p.cooldownUntil).getTime() > now) return 'cooling';
  if (!p.status) return 'unknown';
  return p.status.ok ? 'ok' : 'error';
}

/** Thanh tiến độ: chuyển vàng / đỏ khi gần hết. */
function Meter({ percent, color }: { percent: number; color?: string }) {
  const pct = Math.min(100, Math.max(0, percent));
  const c = color ?? (pct >= 90 ? 'var(--danger)' : pct >= 70 ? 'var(--warn)' : 'var(--ok)');
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
      <div className="h-full rounded-full transition-[width]" style={{ width: `${pct > 0 ? Math.max(pct, 2) : 0}%`, background: c }} />
    </div>
  );
}

/** Biểu đồ cột nhỏ (token theo giờ hoặc theo ngày). */
function Spark({ data, color }: { data: { key: string; label: string; tokens: number; costUsd: number }[]; color: string }) {
  const max = Math.max(...data.map((d) => d.tokens), 1);
  return (
    <div className="flex h-8 items-end gap-[3px]">
      {data.map((d) => (
        <div
          key={d.key}
          title={`${d.label}: ${compact(d.tokens)} token · ${usd(d.costUsd)}`}
          className="min-w-0 flex-1 rounded-[3px]"
          style={{ height: `${d.tokens ? Math.max(10, (d.tokens / max) * 100) : 6}%`, background: d.tokens ? color : 'var(--line-strong)', opacity: d.tokens ? 0.85 : 0.6 }}
        />
      ))}
    </div>
  );
}

function SectionLabel({ icon: Icon, children, right }: { icon: typeof Gauge; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold tracking-wide text-subtle uppercase">
      <Icon className="size-3.5" />
      {children}
      {right && <span className="ml-auto font-normal tracking-normal normal-case">{right}</span>}
    </div>
  );
}

/** Hạn mức gói / số dư / lần chạm hạn mức gần nhất. */
function QuotaBlock({ p, usage, now, onClearCooldown }: { p: Provider; usage?: ProviderUsage; now: number; onClearCooldown: () => void }) {
  const wantsQuota = p.enabled && (p.kind === 'cli' || p.kind === 'api');
  const { data, isValidating, mutate: reload } = useSWR<{ quota: ProviderQuota | null }>(wantsQuota ? `/api/providers/${p._id}/quota` : null, { revalidateOnFocus: false });
  const q = data?.quota ?? null;
  const cooling = p.cooldownUntil && new Date(p.cooldownUntil).getTime() > now ? p.cooldownUntil : null;
  const limit = usage?.lastLimit ?? null;
  const recentLimit = limit && now - new Date(limit.at).getTime() < 7 * 86400_000 ? limit : null;
  if (!cooling && !recentLimit && (!wantsQuota || (data && !q))) return null;
  const refresh = async () => {
    try {
      await reload(await api.get<{ quota: ProviderQuota | null }>(`/api/providers/${p._id}/quota?force=1`), { revalidate: false });
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div>
      <SectionLabel
        icon={Gauge}
        right={
          wantsQuota && (
            <button type="button" onClick={refresh} className="inline-flex items-center gap-1 text-subtle hover:text-fg" title={t('Hỏi lại hạn mức')}>
              <RefreshCw className={clsx('size-3', isValidating && 'animate-spin')} />
              {q ? clock(q.checkedAt) : ''}
            </button>
          )
        }
      >
        {q?.windows.length || q?.balance ? t('Hạn mức · {source}', { source: t(q.source) }) : t('Hạn mức gói')}
      </SectionLabel>
      <div className="space-y-2.5">
        {cooling && (
          <div className="flex items-center gap-2 rounded-xl bg-warn/10 px-3 py-2 text-[12.5px] text-warn">
            <Hourglass className="size-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{t('Đã chạm hạn mức – còn {time}', { time: remaining(cooling, now) })}</div>
              <div className="text-[11.5px] opacity-80">{t('Tự chạy lại lúc {time}', { time: dateTime(cooling) })}</div>
            </div>
            <Button size="xs" variant="ghost" onClick={onClearCooldown} icon={<TimerReset className="size-3.5" />}>
              {t('Bỏ chờ')}
            </Button>
          </div>
        )}
        {q?.windows.map((w) => (
          <div key={w.label}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px]">
              <span className="font-medium">{t('Giới hạn {label}', { label: t(w.label) })}</span>
              <span className="text-subtle tabular-nums">
                {w.usedPercent != null ? t('{percent}% đã dùng', { percent: w.usedPercent }) : '—'}
                {w.resetsAt && ` · ${t('đặt lại sau {time}', { time: remaining(w.resetsAt, now) })}`}
              </span>
            </div>
            <Meter percent={w.usedPercent ?? 0} />
          </div>
        ))}
        {q?.balance && (
          <div>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px]">
              <span className="font-medium">{t(q.balance.label)}</span>
              <span className="tabular-nums">
                {q.balance.unlimited ? (
                  <span className="text-ok">{t('Không giới hạn')}</span>
                ) : (
                  <>
                    <b className="font-semibold">
                      {q.balance.currency === 'USD' ? usd(q.balance.remaining ?? 0) : `${(q.balance.remaining ?? 0).toFixed(2)} ${q.balance.currency}`}
                    </b>
                    {q.balance.total ? <span className="text-subtle"> / {usd(q.balance.total)}</span> : null}
                  </>
                )}
              </span>
            </div>
            {!q.balance.unlimited && q.balance.total ? <Meter percent={100 - ((q.balance.remaining ?? 0) / q.balance.total) * 100} /> : null}
          </div>
        )}
        {recentLimit && (
          <div className="rounded-xl border border-warn/30 px-3 py-2 text-[12.5px]">
            <div className="flex items-center gap-1.5 font-medium text-warn">
              <CircleAlert className="size-3.5" /> {t('Chạm hạn mức {time}', { time: timeAgo(recentLimit.at) })}
            </div>
            {recentLimit.remainingUsd != null ? (
              <div className="mt-1.5">
                <div className="mb-1 flex justify-between text-[12px] tabular-nums">
                  <span>
                    {tc('quota', 'Còn')} <b>{usd(recentLimit.remainingUsd)}</b>
                  </span>
                  {recentLimit.neededUsd != null && <span className="text-subtle">{t('cần {amount} cho một lượt', { amount: usd(recentLimit.neededUsd) })}</span>}
                </div>
                {recentLimit.neededUsd ? <Meter percent={(recentLimit.remainingUsd / recentLimit.neededUsd) * 100} color="var(--warn)" /> : null}
              </div>
            ) : (
              <div className="mt-0.5 line-clamp-2 text-[12px] text-muted" title={recentLimit.message}>
                {recentLimit.message}
              </div>
            )}
          </div>
        )}
        {q?.needsLocalLogin && !q.windows.length && (
          <p className="text-[12px] text-subtle">
            {t('{source}: chưa bật đọc % giới hạn 5 giờ / 7 ngày cho loại kết nối này. Mức dùng của văn phòng trong 5 giờ và 7 ngày ở ngay bên dưới.', { source: t(q.source) })}
          </p>
        )}
        {q?.note && <p className="text-[12px] text-subtle">{t(q.note)}</p>}
        {q?.error && <p className="text-[12px] text-danger">{t('Không đọc được hạn mức: {error}', { error: t(q.error) })}</p>}
        {wantsQuota && !data && <Skeleton className="h-8" />}
      </div>
    </div>
  );
}

/** Token & chi phí theo khoảng thời gian. */
function UsageBlock({ usage, color, subscription }: { usage?: ProviderUsage; color: string; subscription: boolean }) {
  const [range, setRange] = useState<'hours' | 'days'>('hours');
  const money = (n: number) => (usage?.costEstimated && n > 0 ? `≈${usd(n)}` : usd(n));
  if (!usage) {
    return (
      <div>
        <SectionLabel icon={Coins}>{t('Đã sử dụng')}</SectionLabel>
        <p className="text-[12.5px] text-subtle">{t('Chưa có lượt chạy nào qua kết nối này.')}</p>
      </div>
    );
  }
  const cells: [string, UsageBucket][] = [
    [t('5 giờ'), usage.h5],
    [t('Hôm nay'), usage.today],
    [t('7 ngày'), usage.d7],
    [t('30 ngày'), usage.d30],
  ];
  const all = usage.all;
  const chart =
    range === 'hours'
      ? usage.hourly.map((h) => ({ key: h.hour, label: `${new Date(h.hour).getHours()}h–${new Date(h.hour).getHours() + 1}h`, tokens: h.tokens, costUsd: h.costUsd }))
      : usage.daily.map((d) => ({ key: d.date, label: d.date.split('-').reverse().slice(0, 2).join('/'), tokens: d.tokens, costUsd: d.costUsd }));
  return (
    <div>
      <SectionLabel icon={Coins} right={usage.lastRunAt ? t('chạy {time}', { time: timeAgo(usage.lastRunAt) }) : undefined}>
        {t('Đã sử dụng')}
      </SectionLabel>
      <div className="grid grid-cols-4 divide-x divide-line rounded-xl border border-line">
        {cells.map(([label, b]) => (
          <div
            key={label}
            className="min-w-0 px-1.5 py-2 text-center"
            title={t('{runs} lượt · vào {input} (gồm cache {cached}) · ra {output} token', { runs: b.runs, input: formatNumber(b.inputTokens), cached: formatNumber(b.cachedInputTokens), output: formatNumber(b.outputTokens) })}
          >
            <div className="text-[10.5px] text-subtle">{label}</div>
            <div className="truncate font-display text-[16px] leading-6 font-semibold tabular-nums">{compact(tokens(b))}</div>
            <div className="truncate text-[11.5px] text-muted tabular-nums">{money(b.costUsd)}</div>
          </div>
        ))}
      </div>
      <div className="mt-2.5">
        <Spark data={chart} color={color} />
        <div className="mt-1 flex items-center justify-between text-[10.5px] text-subtle">
          <span>{range === 'hours' ? t('24 giờ trước') : t('14 ngày trước')}</span>
          <span className="inline-flex rounded-full bg-surface-2 p-0.5">
            {(['hours', 'days'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={clsx('rounded-full px-2 py-px', range === r ? 'bg-surface-solid text-fg shadow-sm' : 'hover:text-fg')}
              >
                {r === 'hours' ? t('24 giờ') : t('14 ngày')}
              </button>
            ))}
          </span>
          <span>{range === 'hours' ? t('Bây giờ') : t('Hôm nay')}</span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[12px] text-muted tabular-nums">
        <span>
          {t('Tổng:')} <b className="text-fg">{compact(tokens(all))}</b> token · <b className="text-fg">{money(all.costUsd)}</b> · {t('{n} lượt', { n: all.runs })}
        </span>
        <span className="text-subtle">
          {t('vào {n}', { n: compact(all.inputTokens) })}
          {all.cachedInputTokens ? ` (cache ${compact(all.cachedInputTokens)})` : ''} · {t('ra {n}', { n: compact(all.outputTokens) })}
        </span>
      </div>
      {usage.models.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {usage.models.map((m) => (
            <span key={m.model} className="inline-flex max-w-full items-center gap-1 rounded-lg bg-surface-2 px-2 py-0.5 text-[11.5px]" title={t('{n} lượt trong 30 ngày', { n: m.runs })}>
              <span className="truncate font-mono">{m.model}</span>
              <span className="shrink-0 text-subtle tabular-nums">
                {compact(m.tokens)} · {money(m.costUsd)}
              </span>
            </span>
          ))}
        </div>
      )}
      {subscription && all.costUsd > 0 && <p className="mt-2 text-[11.5px] text-subtle">{t('Chi phí theo giá API do CLI báo: với gói Pro/Max chỉ là giá quy đổi; đi qua máy chủ trung gian thì là số bị trừ vào số dư.')}</p>}
      {usage.costEstimated && <p className="mt-2 text-[11.5px] text-subtle">{t('≈ Ước tính theo bảng giá công khai của model – API này không trả về giá.')}</p>}
    </div>
  );
}

function ProviderCard({ p, isDefault, usage, users, onEdit }: { p: Provider; isDefault: boolean; usage?: ProviderUsage; users: { name: string; color: string }[]; onEdit: () => void }) {
  const preset = getPreset(p.type);
  const [testing, setTesting] = useState(false);
  const now = useNow();
  const state = statusOf(p, now);
  const st = STATUS[state];
  const test = async () => {
    setTesting(true);
    try {
      const r = await api.post<{ provider: Provider }>(`/api/providers/${p._id}/test`, { probe: true });
      await mutate('/api/providers');
      if (r.provider.status?.ok) toast.success(statusMessage(r.provider));
      else toast.error(r.provider.status ? statusMessage(r.provider) : t('Kiểm tra thất bại'));
    } catch (e) {
      toast.error(e);
    } finally {
      setTesting(false);
    }
  };
  const patch = async (body: Record<string, unknown>) => {
    try {
      await api.patch(`/api/providers/${p._id}`, body);
      await mutate('/api/providers');
    } catch (e) {
      toast.error(e);
    }
  };
  const remove = async () => {
    const ok = await confirmDialog({
      title: t('Xoá kết nối này?'),
      message: t('Kết nối {name} sẽ bị xoá. Các phòng ban đang dùng sẽ chuyển về Tự động.', { name: p.name }),
      confirmLabel: t('Xoá kết nối'),
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.del(`/api/providers/${p._id}`);
      await mutate('/api/providers');
    } catch (e) {
      toast.error(e);
    }
  };
  const KindIcon = KIND_ICON[p.kind];
  const subscription = p.kind === 'cli' && p.authMode !== 'api_key';
  return (
    <Card className={clsx('flex flex-col overflow-hidden', !p.enabled && 'opacity-70')}>
      <div className="h-1" style={{ background: preset.color }} />
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl" style={{ background: tint(preset.color, 0.14), color: preset.color }}>
            <PlugZap className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-[15px] font-semibold">{p.name}</span>
              {isDefault && (
                <Badge color="#C9952F">
                  <Star className="size-3" />
                  {t('Mặc định')}
                </Badge>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
              <KindIcon className="size-3.5 shrink-0" />
              <span className="truncate">
                {preset.label} · {p.kind === 'cli' ? (subscription ? t('Gói đăng ký') : 'API key') : PROVIDER_KIND_LABEL[p.kind]}
              </span>
            </div>
          </div>
          <Switch checked={p.enabled} onChange={(v) => patch({ enabled: v })} label={t('Bật/tắt')} />
        </div>

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge color={st.color} dot pulse={state === 'cooling'}>
              {st.label}
            </Badge>
            {(p.defaultModel || p.kind === 'api') && (
              <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px]">
                <Cpu className="size-3 shrink-0 text-subtle" />
                <span className="truncate font-mono">{p.defaultModel || t('mặc định')}</span>
                {p.models?.length ? <span className="shrink-0 text-subtle">· {p.models.length} model</span> : null}
              </span>
            )}
            {p.hasApiKey && (
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11.5px]">
                <KeyRound className="size-3 text-subtle" />
                {p.apiKeyPreview}
              </span>
            )}
          </div>
          {p.status?.message && (
            <p className={clsx('line-clamp-2 text-[12.5px]', p.status.ok ? 'text-muted' : 'text-danger')} title={statusMessage(p)}>
              {statusMessage(p)}
            </p>
          )}
          {(p.status?.version || p.status?.checkedAt) && (
            <p className="truncate text-[11.5px] text-subtle">
              {[p.status?.version, p.status?.checkedAt && t('kiểm tra {time}', { time: timeAgo(p.status.checkedAt) })].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>

        <QuotaBlock p={p} usage={usage} now={now} onClearCooldown={() => patch({ clearCooldown: true })} />
        <UsageBlock usage={usage} color={preset.color} subscription={subscription} />

        {users.length > 0 && (
          <div>
            <SectionLabel icon={Users}>{t('Phòng ban đang dùng')}</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {users.slice(0, 6).map((u) => (
                <Badge key={u.name} color={u.color}>
                  {u.name}
                </Badge>
              ))}
              {users.length > 6 && <Badge>+{users.length - 6}</Badge>}
            </div>
          </div>
        )}

        {p.envTest && <EnvTestView result={p.envTest} compact />}

        <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
          <Button size="sm" variant="outline" onClick={test} loading={testing} icon={<RefreshCw className="size-3.5" />}>
            {p.kind === 'cli' ? t('Kiểm tra môi trường') : t('Kiểm tra')}
          </Button>
          <Button size="sm" variant="ghost" onClick={onEdit} icon={<Pencil className="size-3.5" />}>
            {t('Sửa')}
          </Button>
          {!isDefault && (
            <Button size="sm" variant="ghost" onClick={() => patch({ makeDefault: true })} icon={<Star className="size-3.5" />}>
              {t('Đặt mặc định')}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={remove} icon={<Trash2 className="size-3.5" />} className="ml-auto" aria-label={t('Xóa')} />
        </div>
      </div>
    </Card>
  );
}

function Stat({ icon: Icon, label, value, sub, color }: { icon: typeof Gauge; label: string; value: string; sub: string; color: string }) {
  return (
    <div className="flex min-w-0 items-start gap-3 border-line px-4 py-3.5 odd:border-r [&:nth-child(-n+2)]:border-b sm:px-5 sm:py-4 xl:border-r xl:last:border-r-0 xl:[&:nth-child(-n+2)]:border-b-0">
      <div className="hidden size-9 shrink-0 items-center justify-center rounded-xl sm:flex" style={{ background: tint(color, 0.14), color }}>
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <div className="text-[12px] text-muted">{label}</div>
        <div className="font-display text-[22px] leading-7 font-semibold tabular-nums">{value}</div>
        <div className="truncate text-[11.5px] text-subtle">{sub}</div>
      </div>
    </div>
  );
}

function Summary({ providers, usage, now }: { providers: Provider[]; usage: Record<string, ProviderUsage>; now: number }) {
  const sum = (k: 'today' | 'd7' | 'd30' | 'all') => {
    const out = { runs: 0, tokens: 0, costUsd: 0, approx: false };
    for (const u of Object.values(usage)) {
      out.runs += u[k].runs;
      out.tokens += tokens(u[k]);
      out.costUsd += u[k].costUsd;
      // Có phần chi phí ước tính trong khoảng này → hiện "≈"
      if (u.costEstimated && u[k].costUsd > 0) out.approx = true;
    }
    return out;
  };
  const enabled = providers.filter((p) => p.enabled);
  const cooling = enabled.filter((p) => statusOf(p, now) === 'cooling').length;
  const broken = enabled.filter((p) => statusOf(p, now) === 'error').length;
  const today = sum('today');
  const week = sum('d7');
  const month = sum('d30');
  const all = sum('all');
  const health = [cooling && t('{n} chờ hạn mức', { n: cooling }), broken && t('{n} lỗi', { n: broken })].filter(Boolean).join(' · ');
  const money = (b: { costUsd: number; approx: boolean }) => (b.approx ? `≈${usd(b.costUsd)}` : usd(b.costUsd));
  return (
    <Card className="mb-6 grid grid-cols-2 xl:grid-cols-4">
      <Stat icon={PlugZap} label={t('Kết nối đang bật')} value={`${enabled.length}/${providers.length}`} sub={health || t('Tất cả sẵn sàng')} color="#5C9A68" />
      <Stat icon={Activity} label={t('Token hôm nay')} value={compact(today.tokens)} sub={t('{n} lượt chạy · {cost}', { n: today.runs, cost: money(today) })} color="#C4532A" />
      <Stat icon={Coins} label={t('Chi phí 7 ngày')} value={money(week)} sub={t('{tokens} token · {n} lượt', { tokens: compact(week.tokens), n: week.runs })} color="#B8862B" />
      <Stat icon={Wallet} label={t('Chi phí 30 ngày')} value={money(month)} sub={t('Từ trước tới nay {cost} · {tokens} token', { cost: money(all), tokens: compact(all.tokens) })} color="#4F7A9A" />
    </Card>
  );
}

type Filter = 'all' | ProviderKind;
const KIND_ORDER: Record<ProviderKind, number> = { cli: 0, api: 1, gateway: 2, manual: 3 };

export default function ProvidersPage() {
  const { data } = useSWR<Resp>('/api/providers');
  const { data: usageData } = useSWR<{ usage: Record<string, ProviderUsage> }>('/api/providers/usage');
  const { data: departments } = useSWR<Department[]>('/api/departments');
  const [adding, setAdding] = useState(false);
  const [addType, setAddType] = useState<ProviderType | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const now = useNow();
  const providers = data?.providers ?? [];
  const usage = usageData?.usage ?? {};
  const defaultId = data?.defaultProviderId ?? null;
  const kinds = (['cli', 'api', 'gateway', 'manual'] as ProviderKind[]).filter((k) => providers.some((p) => p.kind === k));
  const list = providers
    .filter((p) => filter === 'all' || p.kind === filter)
    .sort(
      (a, b) =>
        Number(b._id === defaultId) - Number(a._id === defaultId) ||
        Number(b.enabled) - Number(a.enabled) ||
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        a.name.localeCompare(b.name, 'vi'),
    );
  // Phòng ban dùng kết nối: chọn trực tiếp, làm dự phòng, hoặc để "Tự động" (= kết nối mặc định)
  const usersOf = (p: Provider) =>
    (departments ?? [])
      .filter((d) => d.enabled && (d.providerId === p._id || d.fallbackProviderIds?.includes(p._id) || (!d.providerId && p._id === defaultId)))
      .map((d) => {
        // Phòng dựng sẵn có bản dịch → tên dịch đầy đủ; tên tự đặt → bỏ tiền tố "Phòng " như trước
        const name = t(d.name);
        return { name: name !== d.name ? name : d.name.replace(/^Phòng /, ''), color: d.color };
      });
  const openAdd = () => {
    setAddType(null);
    setAdding(true);
  };

  return (
    <Page>
      <PageHeader
        title={t('Kết nối AI')}
        description={t('Kết nối nhiều AI agent khác nhau và gán cho từng phòng ban: qua API key, gói đăng ký trên ứng dụng desktop (CLI), agent bên ngoài (gateway, webhook, đám mây) hoặc trình duyệt.')}
        actions={
          <>
            <Button variant="outline" onClick={() => setDetecting(true)} icon={<ScanSearch className="size-4" />}>
              {t('Quét máy tính')}
            </Button>
            <Button variant="primary" onClick={openAdd} icon={<Plus className="size-4" />}>
              {t('Thêm kết nối')}
            </Button>
          </>
        }
      />
      {!data ? (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-96" />
          ))}
        </div>
      ) : providers.length === 0 ? (
        <Card className="p-8">
          <EmptyState
            title={t('Chưa có kết nối AI nào')}
            description={t('Quét máy tính để tìm Claude Code, Codex, Gemini CLI… đã cài, hoặc thêm kết nối bằng API key.')}
          />
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={() => setDetecting(true)} icon={<ScanSearch className="size-4" />}>
              {t('Quét máy tính')}
            </Button>
            <Button variant="primary" onClick={openAdd} icon={<Plus className="size-4" />}>
              {t('Thêm kết nối')}
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <Summary providers={providers} usage={usage} now={now} />
          {kinds.length > 1 && (
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <Segmented<Filter>
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: t('Tất cả'), count: providers.length },
                  ...kinds.map((k) => ({ value: k, label: PROVIDER_KIND_LABEL[k], count: providers.filter((p) => p.kind === k).length })),
                ]}
              />
              {filter !== 'all' && <p className="max-w-2xl text-[12.5px] text-muted">{KIND_DESC[filter]}</p>}
            </div>
          )}
          <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {list.map((p) => (
              <ProviderCard key={p._id} p={p} isDefault={defaultId === p._id} usage={usage[p._id]} users={usersOf(p)} onEdit={() => setEditing(p)} />
            ))}
            <button
              type="button"
              onClick={openAdd}
              className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-[26px] border border-dashed border-line-strong p-6 text-center text-muted transition-colors hover:border-accent hover:text-accent"
            >
              <Plus className="size-6" />
              <span className="text-[13.5px] font-medium">{t('Thêm kết nối')}</span>
              <span className="max-w-xs text-[12px] text-subtle">{t('API key, gói đăng ký qua CLI, agent bên ngoài hoặc trình duyệt')}</span>
            </button>
          </div>
        </>
      )}
      {adding && (
        <AddModal
          key={addType ?? 'any'}
          open
          initialType={addType}
          onClose={() => {
            setAdding(false);
            setAddType(null);
          }}
        />
      )}
      {editing && <EditModal provider={editing} onClose={() => setEditing(null)} />}
      <DetectModal
        open={detecting}
        onClose={() => setDetecting(false)}
        existing={providers}
        onAdd={(t) => {
          setDetecting(false);
          setAddType(t);
          setAdding(true);
        }}
      />
    </Page>
  );
}

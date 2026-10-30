'use client';
// Kho kỹ năng & plugin: gói dựng sẵn (thiết kế, bảo mật, lập trình…), kỹ năng lẻ, và cài từ bên ngoài (npm / npx / GitHub / URL).
// Cài từ bên ngoài luôn hai bước: xem trước đúng lệnh → bạn xác nhận → chạy trong thư mục cách ly.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import useSWR, { mutate } from 'swr';
import { Boxes, Check, Eye, FolderLock, Package, PlugZap, Search, ShieldCheck, Sparkles, Terminal, Trash2, TriangleAlert } from 'lucide-react';
import type { Department, InstalledPlugin } from '@/lib/types';
import { PLUGIN_BUNDLES, SKILL_CATEGORIES, SKILL_LIBRARY, type LibrarySkill, type PluginBundle, type SkillCategory } from '@/lib/plugins-catalog';
import { getDirectoryConnector } from '@/lib/connector-directory';
import { api } from '@/lib/client/api';
import { m, t } from '@/lib/i18n';
import { timeAgo } from '@/lib/client/format';
import { Page, PageHeader } from '@/components/shell';
import { Badge, Button, Card, DeptAvatar, EmptyState, ErrorNote, Field, Input, Markdown, Modal, Segmented, Skeleton, Switch, confirmDialog, cx, toast } from '@/components/ui';

interface PluginsData {
  plugins: InstalledPlugin[];
  installedSkills: string[];
  installedConnectors: string[];
}
interface Plan {
  id: string;
  kind: 'npm' | 'npx' | 'github' | 'url';
  name: string;
  locator: string;
  commands: string[];
  dir: string | null;
  summary: string;
  warnings: string[];
}

/** Màu theo nhóm – tông đất ấm của "Giấy & Mực". */
const CATEGORY_COLOR: Record<SkillCategory, string> = {
  design: '#C07A4F',
  security: '#8C5A3C',
  engineering: '#4A86BD',
  testing: '#5E8C61',
  ops: '#9A7B3F',
  content: '#A0624E',
  product: '#6B7F99',
  data: '#4F8A8B',
};
const SOURCE_LABEL: Record<InstalledPlugin['source']['type'], string> = { catalog: m('Thư viện'), npm: 'npm', npx: 'npx', github: 'GitHub', url: 'URL' };
const EXAMPLES = ['npx -y @playwright/mcp@latest', 'npm install ten-goi-plugin', 'github.com/anthropics/skills', 'https://…/SKILL.md'];

/** Plugin cài từ gói dựng sẵn lưu tên / mô tả gốc (tiếng Việt) → dịch khi hiển thị; plugin từ bên ngoài giữ nguyên. */
const pluginText = (p: InstalledPlugin, text: string) => (p.source.type === 'catalog' ? t(text) : text);

/**
 * Mô tả kế hoạch cài theo ngôn ngữ giao diện. Máy chủ soạn sẵn bằng tiếng Việt (lib/server/plugins.ts → planExternal):
 * npx / URL có phần thay đổi nên dựng lại câu đúng như máy chủ, còn npm / GitHub là câu cố định.
 */
function planSummary(plan: Plan): string {
  if (plan.kind === 'npx') return t('Thêm kết nối dịch vụ (máy chủ MCP) chạy bằng: {command}. Lệnh chỉ chạy khi bạn bật kết nối / tải danh sách thao tác, và mỗi lần agent dùng.', { command: `npx -y ${plan.locator}` });
  if (plan.kind === 'url') return t('Tải tệp kỹ năng (SKILL.md) từ {url} qua HTTPS.', { url: plan.locator });
  return t(plan.summary);
}

/** Ghi chú của plugin (máy chủ lưu bằng tiếng Việt): câu cố định tra từ điển, câu có số đếm dựng lại theo ngôn ngữ. */
function noteText(note: string): string {
  const commands = /^Có (\d+) lệnh "\/" \(commands\) – Văn Phòng AI chưa dùng loại này\.$/.exec(note);
  if (commands) return t('Có {n} lệnh "/" (commands) – Văn Phòng AI chưa dùng loại này.', { n: Number(commands[1]) });
  const agents = /^Có (\d+) agent con \(agents\) – chưa tự tạo phòng ban; bạn có thể tạo phòng tương ứng ở Sơ đồ tổ chức\.$/.exec(note);
  if (agents) return t('Có {n} agent con (agents) – chưa tự tạo phòng ban; bạn có thể tạo phòng tương ứng ở Sơ đồ tổ chức.', { n: Number(agents[1]) });
  return t(note);
}

function Monogram({ name, color, className }: { name: string; color: string; className?: string }) {
  const letters = name
    .replace(/^Bộ\s+/i, '')
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <span className={cx('flex size-10 shrink-0 items-center justify-center rounded-2xl text-[14px] font-semibold', className)} style={{ background: `${color}22`, color }}>
      {letters}
    </span>
  );
}

function DeptPicker({ departments, value, onChange }: { departments: Department[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {departments
        .filter((d) => d.enabled)
        .map((d) => {
          const on = value.includes(d._id);
          return (
            <button
              key={d._id}
              type="button"
              onClick={() => onChange(on ? value.filter((x) => x !== d._id) : [...value, d._id])}
              className={cx('flex items-center gap-1.5 rounded-full border py-1 pr-2.5 pl-1 text-[12.5px]', on ? 'border-accent bg-accent/8' : 'border-line text-muted')}
            >
              <DeptAvatar icon={d.icon} color={d.color} size="sm" className="!size-6 !rounded-full" />
              {t(d.name)}
            </button>
          );
        })}
    </div>
  );
}

/** Hộp cài: chọn phòng được gán kỹ năng rồi cài gói / kỹ năng. */
function InstallModal({
  target,
  departments,
  onClose,
}: {
  target: { type: 'bundle'; bundle: PluginBundle } | { type: 'skill'; skill: LibrarySkill };
  departments: Department[];
  onClose: () => void;
}) {
  const suggested = target.type === 'bundle' ? target.bundle.departments : target.skill.departments;
  const [picked, setPicked] = useState(() => suggested.filter((id) => departments.some((d) => d._id === id && d.enabled)));
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const skills = target.type === 'bundle' ? target.bundle.skills.map((k) => SKILL_LIBRARY.find((s) => s.key === k)).filter(Boolean) : [target.skill];
  const connectors = target.type === 'bundle' ? target.bundle.connectors.map(getDirectoryConnector).filter((c) => !!c) : [];
  const install = async () => {
    setBusy(true);
    try {
      if (target.type === 'bundle') {
        const r = await api.post<{ plugin: InstalledPlugin; suggested: string[] }>('/api/plugins', { action: 'install-bundle', id: target.bundle.id, departments: picked });
        toast.success(t('Đã cài "{name}"', { name: target.bundle.name }));
        if (r.suggested.length) toast(t('Thêm kết nối cần đăng nhập ở Kết nối dịch vụ: {list}', { list: r.suggested.map((id) => getDirectoryConnector(id)?.name ?? id).join(', ') }));
      } else {
        await api.post('/api/plugins', { action: 'install-skill', key: target.skill.key, departments: picked });
        toast.success(t('Đã cài kỹ năng "{name}"', { name: target.skill.name }));
      }
      await Promise.all([mutate('/api/plugins'), mutate('/api/skills'), mutate('/api/departments'), mutate('/api/connections')]);
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const title = target.type === 'bundle' ? target.bundle.name : target.skill.name;
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={t('Cài "{name}"', { name: title })}
      description={target.type === 'bundle' ? target.bundle.description : target.skill.description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Huỷ')}
          </Button>
          <Button variant="primary" onClick={install} loading={busy} icon={<Check className="size-4" />}>
            {t('Cài')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 text-[13px] font-medium">{t('Kỹ năng ({n})', { n: skills.length })}</div>
          <div className="space-y-1.5">
            {skills.map((s) => (
              <div key={s!.key} className="rounded-xl border border-line px-3 py-2">
                <div className="text-[13px] font-medium">{s!.name}</div>
                <div className="text-[12px] text-muted">{s!.description}</div>
              </div>
            ))}
          </div>
          {target.type === 'skill' && (
            <Button size="xs" variant="ghost" className="mt-2" onClick={() => setPreview(!preview)} icon={<Eye className="size-3.5" />}>
              {preview ? t('Ẩn nội dung') : t('Xem nội dung SKILL.md')}
            </Button>
          )}
          {preview && target.type === 'skill' && (
            <div className="mt-2 max-h-[300px] overflow-auto rounded-xl border border-line p-3">
              <Markdown>{target.skill.markdown.replace(/^---[\s\S]*?---/, '')}</Markdown>
            </div>
          )}
        </div>
        {connectors.length > 0 && (
          <div>
            <div className="mb-1.5 text-[13px] font-medium">{t('Kết nối dịch vụ')}</div>
            <div className="flex flex-wrap gap-1.5">
              {connectors.map((c) => (
                <Badge key={c.id} color={c.auth === 'none' && c.transport === 'http' ? '#5E8C61' : '#9A7B3F'}>
                  {c.name} · {c.auth !== 'none' ? t('cần đăng nhập – thêm sau') : c.transport === 'stdio' ? t('chạy trên máy – thêm sau') : t('cài luôn')}
                </Badge>
              ))}
            </div>
          </div>
        )}
        <Field label={t('Gán kỹ năng cho phòng ban')} hint={t('Agent của phòng được gán sẽ thấy và dùng các kỹ năng này.')}>
          <DeptPicker departments={departments} value={picked} onChange={setPicked} />
        </Field>
      </div>
    </Modal>
  );
}

function Discover({ data, departments }: { data: PluginsData; departments: Department[] }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<SkillCategory | 'all'>('all');
  const [installing, setInstalling] = useState<Parameters<typeof InstallModal>[0]['target'] | null>(null);
  const match = (text: string) => !q.trim() || text.toLowerCase().includes(q.trim().toLowerCase());
  const bundles = PLUGIN_BUNDLES.filter((b) => (cat === 'all' || b.category === cat) && match(`${b.name} ${b.description}`));
  const skills = SKILL_LIBRARY.filter((s) => (cat === 'all' || s.category === cat) && match(`${s.name} ${s.description} ${s.key}`));
  const installedBundles = new Set(data.plugins.filter((p) => p.source.type === 'catalog').map((p) => p.source.locator));
  const installedSkills = new Set(data.installedSkills);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Tìm kỹ năng, plugin…')} className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(['all', ...Object.keys(SKILL_CATEGORIES)] as (SkillCategory | 'all')[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCat(c)}
              className={cx('rounded-full border px-3 py-1 text-[12.5px]', cat === c ? 'border-accent bg-accent/10 text-fg' : 'border-line text-muted hover:text-fg')}
            >
              {c === 'all' ? t('Tất cả') : SKILL_CATEGORIES[c]}
            </button>
          ))}
        </div>
      </div>

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-[14px] font-semibold">
          <Boxes className="size-4 text-accent" />
          {t('Gói plugin')}
          <span className="text-[12px] font-normal text-subtle">{t('kỹ năng + kết nối dịch vụ, cài một chạm')}</span>
        </h2>
        {!bundles.length ? (
          <p className="text-[13px] text-muted">{t('Không có gói phù hợp.')}</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {bundles.map((b) => {
              const done = installedBundles.has(b.id);
              return (
                <Card key={b.id} className="flex flex-col p-4">
                  <div className="flex items-start gap-3">
                    <Monogram name={b.name} color={CATEGORY_COLOR[b.category]} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[14.5px] font-semibold">{b.name}</div>
                      <p className="mt-0.5 line-clamp-3 text-[12.5px] text-muted">{b.description}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <Badge color={CATEGORY_COLOR[b.category]}>{SKILL_CATEGORIES[b.category]}</Badge>
                    <Badge>{t('{n} kỹ năng', { n: b.skills.length })}</Badge>
                    {b.connectors.length > 0 && <Badge>{t('{n} kết nối', { n: b.connectors.length })}</Badge>}
                    <Button size="xs" variant={done ? 'outline' : 'primary'} className="ml-auto" onClick={() => setInstalling({ type: 'bundle', bundle: b })} icon={done ? <Check className="size-3.5" /> : undefined}>
                      {done ? t('Đã cài · cài lại') : t('Cài')}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-[14px] font-semibold">
          <Sparkles className="size-4 text-accent" />
          {t('Kỹ năng')}
          <span className="text-[12px] font-normal text-subtle">{t('tệp SKILL.md viết sẵn bằng tiếng Việt')}</span>
        </h2>
        {!skills.length ? (
          <p className="text-[13px] text-muted">{t('Không có kỹ năng phù hợp.')}</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {skills.map((s) => {
              const done = installedSkills.has(s.key);
              return (
                <Card key={s.key} className="flex flex-col p-4">
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{ background: CATEGORY_COLOR[s.category] }} />
                    <span className="text-[14px] font-semibold">{s.name}</span>
                    <span className="ml-auto text-[11.5px] text-subtle">{SKILL_CATEGORIES[s.category]}</span>
                  </div>
                  <p className="mt-1 line-clamp-3 flex-1 text-[12.5px] text-muted">{s.description}</p>
                  <div className="mt-3 flex items-center">
                    {done && (
                      <span className="flex items-center gap-1 text-[12px] text-ok">
                        <Check className="size-3.5" />
                        {t('Đã cài')}
                      </span>
                    )}
                    <Button size="xs" variant={done ? 'ghost' : 'outline'} className="ml-auto" onClick={() => setInstalling({ type: 'skill', skill: s })}>
                      {done ? t('Cập nhật / gán phòng') : t('Xem & cài')}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>
      {installing && <InstallModal target={installing} departments={departments} onClose={() => setInstalling(null)} />}
    </div>
  );
}

function UninstallModal({ plugin, onClose }: { plugin: InstalledPlugin; onClose: () => void }) {
  const [removeSkills, setRemoveSkills] = useState(plugin.source.type !== 'catalog');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await api.del(`/api/plugins/${plugin._id}${removeSkills ? '?removeSkills=1' : ''}`);
      await Promise.all([mutate('/api/plugins'), mutate('/api/skills'), mutate('/api/connections'), mutate('/api/departments')]);
      toast.success(t('Đã gỡ "{name}"', { name: pluginText(plugin, plugin.name) }));
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
      size="sm"
      title={t('Gỡ plugin?')}
      description={t('Gỡ "{name}": xoá kết nối dịch vụ nó đã thêm và thư mục đã tải về.', { name: pluginText(plugin, plugin.name) })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Huỷ')}
          </Button>
          <Button variant="destructive" onClick={run} loading={busy}>
            {t('Gỡ')}
          </Button>
        </>
      }
    >
      {plugin.skills.length > 0 ? (
        <div className="flex items-center gap-3 text-[13px]">
          <Switch checked={removeSkills} onChange={setRemoveSkills} label={t('Xoá luôn kỹ năng')} />
          <span>{t('Xoá luôn {n} kỹ năng nó đã thêm (kỹ năng còn dùng ở plugin khác được giữ lại)', { n: plugin.skills.length })}</span>
        </div>
      ) : (
        <p className="text-[13px] text-muted">{t('Plugin này không thêm kỹ năng nào.')}</p>
      )}
    </Modal>
  );
}

function Installed({ data }: { data: PluginsData }) {
  const [removing, setRemoving] = useState<InstalledPlugin | null>(null);
  if (!data.plugins.length)
    return (
      <Card>
        <EmptyState icon={<Package className="size-6" />} title={t('Chưa cài plugin nào')} description={t('Vào "Khám phá" để cài gói dựng sẵn, hoặc "Cài từ bên ngoài" để cài từ npm / GitHub.')} />
      </Card>
    );
  return (
    <div className="space-y-3">
      {data.plugins.map((p) => (
        <Card key={p._id} className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Package className="size-4 text-accent" />
            <span className="text-[14.5px] font-semibold">{pluginText(p, p.name)}</span>
            <Badge color="#4A86BD">{t(SOURCE_LABEL[p.source.type])}</Badge>
            {p.version && <span className="text-[12px] text-subtle">v{p.version}</span>}
            <span className="ml-auto text-[12px] text-subtle">{timeAgo(p.updatedAt)}</span>
            <Button size="xs" variant="ghost" onClick={() => setRemoving(p)} icon={<Trash2 className="size-3.5" />} aria-label={t('Gỡ')} />
          </div>
          {p.description && <p className="mt-1 text-[12.5px] text-muted">{pluginText(p, p.description)}</p>}
          {p.source.command && <code className="mt-2 block overflow-x-auto rounded-xl bg-surface-3 px-3 py-2 font-mono text-[12px] whitespace-pre">$ {p.source.command}</code>}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
            {p.skills.map((k) => (
              <Badge key={k} color="#958B7E">
                <Sparkles className="size-3" />
                {SKILL_LIBRARY.find((s) => s.key === k)?.name ?? k}
              </Badge>
            ))}
            {p.connections.length > 0 && (
              <Link href="/connections" className="inline-flex items-center gap-1 text-accent hover:underline">
                <PlugZap className="size-3.5" />
                {t('{n} kết nối dịch vụ', { n: p.connections.length })}
              </Link>
            )}
            {p.departments.length > 0 && <span className="text-subtle">· {t('gán cho {n} phòng', { n: p.departments.length })}</span>}
          </div>
          {p.notes.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[12px] text-muted">
              {p.notes.map((n, i) => (
                <li key={i}>• {noteText(n)}</li>
              ))}
            </ul>
          )}
        </Card>
      ))}
      {removing && <UninstallModal plugin={removing} onClose={() => setRemoving(null)} />}
    </div>
  );
}

function External({ departments }: { departments: Department[] }) {
  const [input, setInput] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState<'plan' | 'run' | null>(null);
  const [log, setLog] = useState<string[] | null>(null);
  const preview = async () => {
    setBusy('plan');
    setLog(null);
    try {
      setPlan(await api.post<Plan>('/api/plugins', { action: 'plan', input }));
    } catch (e) {
      setPlan(null);
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  const run = async () => {
    if (!plan) return;
    const ok = await confirmDialog({
      title: t('Chạy lệnh cài?'),
      message: plan.commands.length ? (
        <span className="block space-y-1">
          <span className="block">{t('Văn Phòng AI sẽ chạy đúng lệnh sau trên máy bạn:')}</span>
          {plan.commands.map((c) => (
            <code key={c} className="block rounded-lg bg-surface-3 px-2 py-1 font-mono text-[12px] break-all">
              $ {c}
            </code>
          ))}
        </span>
      ) : (
        planSummary(plan)
      ),
      confirmLabel: plan.commands.length ? t('Chạy lệnh') : t('Thêm'),
      tone: 'primary',
    });
    if (!ok) return;
    setBusy('run');
    try {
      const r = await api.post<{ plugin: InstalledPlugin; log: string[] }>('/api/plugins', { action: 'run', planId: plan.id, confirm: true, departments: picked });
      setLog(r.log);
      setPlan(null);
      toast.success(t('Đã cài "{name}"', { name: r.plugin.name }));
      await Promise.all([mutate('/api/plugins'), mutate('/api/skills'), mutate('/api/connections'), mutate('/api/departments')]);
    } catch (e) {
      // Kế hoạch dùng một lần – lỗi thì phải xem trước lại
      setPlan(null);
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card className="space-y-4 p-5">
        <Field label={t('Lệnh hoặc địa chỉ')} hint={t('Một lệnh npx / npm install, địa chỉ GitHub (owner/repo, kèm /tree/nhánh/thư-mục nếu cần) hoặc URL tới SKILL.md.')}>
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setPlan(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && input.trim() && preview()}
              placeholder="npx -y @playwright/mcp@latest"
              className="font-mono text-[12.5px]"
            />
            <Button variant="primary" onClick={preview} loading={busy === 'plan'} disabled={!input.trim()} icon={<Eye className="size-4" />}>
              {t('Xem trước')}
            </Button>
          </div>
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => setInput(ex)} className="rounded-full border border-line px-2.5 py-0.5 font-mono text-[11.5px] text-muted hover:text-fg">
              {ex}
            </button>
          ))}
        </div>
        {plan && (
          <div className="space-y-3 rounded-2xl border border-line-strong bg-surface-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Terminal className="size-4 text-accent" />
              <b className="text-[14px]">{plan.name}</b>
              <Badge color="#4A86BD">{t(SOURCE_LABEL[plan.kind])}</Badge>
            </div>
            <p className="text-[13px] text-muted">{planSummary(plan)}</p>
            {plan.commands.length > 0 && (
              <div>
                <div className="mb-1 text-[12px] font-medium">{t('Lệnh sẽ chạy')}</div>
                {plan.commands.map((c) => (
                  <code key={c} className="block overflow-x-auto rounded-xl bg-surface-3 px-3 py-2 font-mono text-[12px] whitespace-pre">
                    $ {c}
                  </code>
                ))}
              </div>
            )}
            {plan.dir && (
              <div className="flex items-center gap-1.5 text-[12px] text-muted">
                <FolderLock className="size-3.5" />
                {t('Thư mục cách ly:')} <code className="font-mono break-all">{plan.dir}</code>
              </div>
            )}
            {plan.warnings.map((w) => (
              <div key={w} className="flex items-start gap-1.5 rounded-xl bg-warn/10 px-3 py-2 text-[12.5px] text-warn">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                {t(w)}
              </div>
            ))}
            {plan.kind !== 'npx' && (
              <Field label={t('Gán kỹ năng tìm thấy cho phòng (tuỳ chọn)')}>
                <DeptPicker departments={departments} value={picked} onChange={setPicked} />
              </Field>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPlan(null)}>
                {t('Huỷ')}
              </Button>
              <Button variant="primary" onClick={run} loading={busy === 'run'} icon={<Check className="size-4" />}>
                {plan.commands.length ? t('Xác nhận & chạy') : t('Xác nhận & thêm')}
              </Button>
            </div>
          </div>
        )}
        {log && (
          <div>
            <div className="mb-1 text-[12px] font-medium">{t('Kết quả')}</div>
            <pre className="max-h-[260px] overflow-auto rounded-xl bg-surface-3 p-3 font-mono text-[11.5px] whitespace-pre-wrap">{log.join('\n')}</pre>
          </div>
        )}
      </Card>
      <Card className="h-fit space-y-2.5 p-5 text-[12.5px] text-muted">
        <div className="flex items-center gap-2 text-[13.5px] font-semibold text-fg">
          <ShieldCheck className="size-4 text-ok" />
          {t('Cài an toàn')}
        </div>
        <p>{t('Luôn xem trước: bạn thấy đúng lệnh sẽ chạy và phải bấm xác nhận. Agent không tự cài được plugin.')}</p>
        <p>{t('npm: tải vào thư mục cách ly .vanphong/plugins với --ignore-scripts – không chạy mã cài đặt của gói, không truyền khoá bí mật của máy chủ.')}</p>
        <p>{t('GitHub: git clone --depth 1, chỉ đọc tệp SKILL.md, .claude-plugin/plugin.json, .mcp.json.')}</p>
        <p>{t('npx / máy chủ MCP của plugin: thêm ở trạng thái tắt, mọi thao tác "Hỏi trước" – bạn xem lại ở Kết nối dịch vụ rồi mới bật.')}</p>
      </Card>
    </div>
  );
}

export default function PluginsPage() {
  const { data, error } = useSWR<PluginsData>('/api/plugins');
  const { data: departments } = useSWR<Department[]>('/api/departments');
  const [tab, setTab] = useState<'discover' | 'installed' | 'external'>('discover');
  const deps = useMemo(() => departments ?? [], [departments]);
  return (
    <Page>
      <PageHeader
        eyebrow={t('Công ty')}
        title={t('Kho kỹ năng & plugin')}
        description={t('Cài kỹ năng và plugin cho các phòng – giống plugin của Claude Code / Codex: gói dựng sẵn (thiết kế, bảo mật, lập trình…) hoặc từ npm, npx, GitHub.')}
        actions={
          <Link href="/skills">
            <Button variant="outline" icon={<Sparkles className="size-4" />}>
              {t('Kỹ năng đã có')}
            </Button>
          </Link>
        }
      />
      <Segmented
        className="mb-4"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'discover', label: t('Khám phá') },
          { value: 'installed', label: t('Đã cài'), count: data?.plugins.length },
          { value: 'external', label: t('Cài từ bên ngoài') },
        ]}
      />
      {!data ? (
        error ? (
          <ErrorNote error={error} />
        ) : (
          <Skeleton className="h-64" />
        )
      ) : tab === 'discover' ? (
        <Discover data={data} departments={deps} />
      ) : tab === 'installed' ? (
        <Installed data={data} />
      ) : (
        <External departments={deps} />
      )}
    </Page>
  );
}

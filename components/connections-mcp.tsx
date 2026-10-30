'use client';
// Kết nối dịch vụ (MCP): GitHub, Notion, máy chủ MCP tuỳ chỉnh – quyền từng thao tác Cho phép / Hỏi trước / Tắt.
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import useSWR, { mutate } from 'swr';
import clsx from 'clsx';
import { Cable, Compass, GitBranch, LogIn, NotebookText, Pencil, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import type { Department, McpConnection, McpPolicy } from '@/lib/types';
import { MCP_POLICY_LABEL, MCP_PRESETS, type McpPreset } from '@/lib/connections-catalog';
import { getDirectoryConnector } from '@/lib/connector-directory';
import { t } from '@/lib/i18n';
import { api } from '@/lib/client/api';
import { timeAgo } from '@/lib/client/format';
import { Badge, Button, Card, Dot, EmptyState, Field, Input, Modal, Segmented, Skeleton, Switch, Textarea, confirmDialog, toast } from './ui';
import { ConnectorDirectory, ConnectorMonogram, oauthLogin } from './connections-directory';

const KEY = '/api/connections';
const KIND_ICON = { github: GitBranch, notion: NotebookText, custom: Cable } as const;
const POLICY_COLOR: Record<McpPolicy, string> = { allow: '#5C9A68', ask: '#C9952F', off: '#958B7E' };

/** Câu dịch có chỗ chèn thành phần giao diện: {x} trong bản dịch → parts.x (giữ chữ đậm / mã trong câu). */
function rich(text: string, parts: Record<string, ReactNode>) {
  return text.split(/\{(\w+)\}/).map((s, i) => (i % 2 ? <Fragment key={i}>{parts[s] ?? `{${s}}`}</Fragment> : s));
}

/** Trạng thái kết nối do máy chủ lưu bằng tiếng Việt → hiển thị theo ngôn ngữ giao diện. */
function statusText(message: string): string {
  const ok = /^Đã kết nối – (\d+) thao tác$/.exec(message);
  return ok ? t('Đã kết nối – {n} thao tác', { n: Number(ok[1]) }) : t(message);
}

/** Tên kết nối: kết nối thêm từ danh bạ mang tên dựng sẵn → dịch theo ngôn ngữ; tên bạn tự đặt giữ nguyên. */
const connName = (c: McpConnection) => (c.directoryId ? t(c.name) : c.name);

const toLines = (m?: Record<string, string>, sep = '=') => Object.entries(m ?? {}).map(([k, v]) => `${k}${sep}${v}`).join('\n');
const fromLines = (s: string, sep: '=' | ':'): Record<string, string> =>
  Object.fromEntries(
    s
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const i = l.indexOf(sep);
        return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : [l, ''];
      }),
  );

export function McpConnections() {
  const { data } = useSWR<McpConnection[]>(KEY);
  const { data: departments } = useSWR<Department[]>('/api/departments');
  const [editing, setEditing] = useState<McpConnection | 'new' | null>(null);
  const [policies, setPolicies] = useState<McpConnection | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Chưa có kết nối nào → mở thẳng danh bạ
  const [viewState, setView] = useState<'yours' | 'discover' | null>(null);
  const view = viewState ?? (data && !data.length ? 'discover' : 'yours');

  const login = async (c: McpConnection) => {
    setBusy(c._id);
    try {
      await oauthLogin(c._id, connName(c));
    } finally {
      setBusy(null);
    }
  };
  const refresh = async (c: McpConnection) => {
    setBusy(c._id);
    try {
      const r = await api.patch<McpConnection>(`${KEY}/${c._id}`, { action: 'refresh' });
      toast.success(t('{name}: {n} thao tác', { name: connName(r), n: r.tools.length }));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
      await mutate(KEY);
    }
  };
  const toggle = async (c: McpConnection, enabled: boolean) => {
    try {
      await api.patch(`${KEY}/${c._id}`, { enabled });
      await mutate(KEY);
    } catch (e) {
      toast.error(e);
    }
  };
  const remove = async (c: McpConnection) => {
    if (!(await confirmDialog({ title: t('Xoá kết nối {name}?', { name: connName(c) }), message: t('Agent sẽ không dùng được dịch vụ này nữa. Token trong kho bí mật vẫn được giữ.'), confirmLabel: t('Xoá'), tone: 'danger' }))) return;
    await api.del(`${KEY}/${c._id}`);
    await mutate(KEY);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'yours', label: t('Của bạn'), count: data?.length },
            { value: 'discover', label: <span className="inline-flex items-center gap-1.5"><Compass className="size-3.5" />{t('Khám phá')}</span> },
          ]}
        />
        <Button variant="outline" className="ml-auto" onClick={() => setEditing('new')} icon={<Plus className="size-4" />}>
          {t('Tự cấu hình')}
        </Button>
      </div>
      {view === 'discover' ? (
        <ConnectorDirectory connections={data ?? []} departments={departments ?? []} />
      ) : (
      <>
      <div className="mb-4">
        <p className="max-w-3xl text-[13.5px] text-muted">
          {rich(t('Cho agent dùng dịch vụ bên ngoài qua giao thức MCP. Mỗi thao tác có quyền riêng: {allow} (tự chạy), {ask} (chờ bạn duyệt trong Hộp thư), {off}. Claude Code nhận qua {flag}; kết nối API nhận thành công cụ.'), {
            allow: <b>{MCP_POLICY_LABEL.allow}</b>,
            ask: <b>{MCP_POLICY_LABEL.ask}</b>,
            off: <b>{MCP_POLICY_LABEL.off}</b>,
            flag: <code className="font-mono">--mcp-config</code>,
          })}
        </p>
      </div>
      {!data ? (
        <Skeleton className="h-40" />
      ) : !data.length ? (
        <Card>
          <EmptyState icon={<Cable className="size-6" />} title={t('Chưa có kết nối dịch vụ')} description={t('Thêm GitHub, Notion hoặc một máy chủ MCP bất kỳ để agent làm việc trực tiếp với các công cụ của bạn.')} action={<Button variant="primary" onClick={() => setView('discover')} icon={<Compass className="size-4" />}>{t('Khám phá kết nối')}</Button>} />
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.map((c) => {
            const Icon = KIND_ICON[c.kind];
            const counts = { allow: 0, ask: 0, off: 0 } as Record<McpPolicy, number>;
            for (const tool of c.tools) counts[tool.policy]++;
            const dc = c.directoryId ? getDirectoryConnector(c.directoryId) : undefined;
            const needsLogin = dc?.auth === 'oauth' || !!c.oauth;
            const scope = c.departments.length
              ? c.departments
                  .map((d) => {
                    const dept = departments?.find((x) => x._id === d);
                    return dept ? t(dept.name) : d;
                  })
                  .join(', ')
              : t('Mọi phòng');
            return (
              <Card key={c._id} className={clsx('p-5', !c.enabled && 'opacity-60')}>
                <div className="flex items-start gap-3">
                  {dc ? (
                    <ConnectorMonogram name={dc.name} color={dc.color} />
                  ) : (
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-surface-3 text-accent">
                      <Icon className="size-5" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold">{connName(c)}</span>
                      <Badge color="#8A7DAE">{c.transport === 'http' ? 'HTTP' : t('Lệnh (stdio)')}</Badge>
                      <span className="font-mono text-[11.5px] text-subtle">mcp__{c.key}__…</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[12.5px] text-muted">
                      <Dot color={!c.status ? '#958B7E' : c.status.ok ? '#5C9A68' : '#C4483F'} />
                      <span className="line-clamp-2">{c.status ? `${statusText(c.status.message)}${c.status.serverName ? ` · ${c.status.serverName}` : ''} · ${timeAgo(c.status.checkedAt)}` : t('Chưa kiểm tra – bấm "Tải thao tác"')}</span>
                    </div>
                  </div>
                  <Switch checked={c.enabled} onChange={(v) => toggle(c, v)} label={t('Bật kết nối')} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]">
                  {(['allow', 'ask', 'off'] as McpPolicy[]).map((p) => (
                    <Badge key={p} color={POLICY_COLOR[p]}>
                      {MCP_POLICY_LABEL[p]}: {counts[p]}
                    </Badge>
                  ))}
                  <span className="text-subtle">· {t('chưa liệt kê: {policy}', { policy: MCP_POLICY_LABEL[c.defaultPolicy] })}</span>
                  <span className="text-subtle">· {scope}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {needsLogin && (
                    <Button size="sm" variant={c.oauth?.connectedAt ? 'outline' : 'primary'} loading={busy === c._id} onClick={() => login(c)} icon={<LogIn className="size-3.5" />}>
                      {c.oauth?.connectedAt ? t('Đăng nhập lại') : t('Đăng nhập')}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" loading={busy === c._id} onClick={() => refresh(c)} icon={<RefreshCw className="size-3.5" />}>
                    {t('Tải thao tác')}
                  </Button>
                  <Button size="sm" variant="outline" disabled={!c.tools.length} onClick={() => setPolicies(c)} icon={<ShieldCheck className="size-3.5" />}>
                    {t('Quyền thao tác ({n})', { n: c.tools.length })}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(c)} icon={<Pencil className="size-3.5" />}>
                    {t('Sửa')}
                  </Button>
                  <Button size="sm" variant="ghost" className="ml-auto text-danger" onClick={() => remove(c)} icon={<Trash2 className="size-3.5" />}>
                    {t('Xoá')}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      </>
      )}
      {editing && <ConnectionForm initial={editing === 'new' ? null : editing} departments={departments ?? []} onClose={() => setEditing(null)} />}
      {policies && <PolicyEditor conn={data?.find((x) => x._id === policies._id) ?? policies} onClose={() => setPolicies(null)} />}
    </div>
  );
}

function ConnectionForm({ initial, departments, onClose }: { initial: McpConnection | null; departments: Department[]; onClose: () => void }) {
  const [preset, setPreset] = useState<McpPreset | null>(initial ? (MCP_PRESETS.find((p) => p.kind === initial.kind && p.transport === initial.transport) ?? null) : null);
  const base = initial ?? null;
  const [name, setName] = useState(base?.name ?? '');
  const [key, setKey] = useState(base?.key ?? '');
  const [transport, setTransport] = useState<'stdio' | 'http'>(base?.transport ?? 'stdio');
  const [command, setCommand] = useState(base?.command ?? '');
  const [args, setArgs] = useState((base?.args ?? []).join('\n'));
  const [env, setEnv] = useState(toLines(base?.env));
  const [url, setUrl] = useState(base?.url ?? '');
  const [headers, setHeaders] = useState(toLines(base?.headers, ': '));
  const [token, setToken] = useState('');
  const [defaultPolicy, setDefaultPolicy] = useState<McpPolicy>(base?.defaultPolicy ?? 'ask');
  const [depts, setDepts] = useState<string[]>(base?.departments ?? []);
  const [busy, setBusy] = useState(false);

  const pick = (p: McpPreset) => {
    setPreset(p);
    setName(p.kind === 'custom' ? '' : p.label);
    setKey(p.key);
    setTransport(p.transport);
    setCommand(p.command ?? '');
    setArgs((p.args ?? []).join('\n'));
    setUrl(p.url ?? '');
    setEnv('');
    setHeaders('');
  };

  const save = async () => {
    setBusy(true);
    try {
      const body = {
        presetId: preset?.id,
        kind: preset?.kind ?? base?.kind ?? 'custom',
        name,
        key,
        transport,
        command,
        args: args.split(/\r?\n/).map((a) => a.trim()).filter(Boolean),
        env: fromLines(env, '='),
        url,
        headers: fromLines(headers, ':'),
        token: token || undefined,
        defaultPolicy,
        departments: depts,
      };
      const saved = initial ? await api.patch<McpConnection>(`${KEY}/${initial._id}`, body) : await api.post<McpConnection>(KEY, body);
      await mutate(KEY);
      onClose();
      toast.success(initial ? t('Đã lưu kết nối') : t('Đã thêm kết nối – đang tải danh sách thao tác…'));
      if (!initial) {
        api
          .patch<McpConnection>(`${KEY}/${saved._id}`, { action: 'refresh' })
          .then((r) => toast.success(t('{name}: {n} thao tác', { name: connName(r), n: r.tools.length })))
          .catch((e) => toast.error(e))
          .finally(() => void mutate(KEY));
      }
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  if (!preset && !initial) {
    return (
      <Modal open onClose={onClose} size="lg" title={t('Thêm kết nối dịch vụ')} description={t('Chọn dịch vụ – bạn có thể sửa mọi thông số ở bước sau.')}>
        <div className="grid gap-2 sm:grid-cols-2">
          {MCP_PRESETS.map((p) => {
            const Icon = KIND_ICON[p.kind];
            return (
              <button key={p.id} type="button" onClick={() => pick(p)} className="flex items-start gap-3 rounded-2xl border border-line p-4 text-left hover:border-accent/40 hover:bg-surface-2">
                <Icon className="mt-0.5 size-5 shrink-0 text-accent" />
                <span>
                  <span className="block text-[14px] font-semibold">{p.label}</span>
                  <span className="mt-0.5 block text-[12.5px] text-muted">{p.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </Modal>
    );
  }

  const tok = preset?.token;
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={initial ? t('Sửa kết nối {name}', { name: connName(initial) }) : t('Kết nối {name}', { name: preset?.label })}
      description={preset?.description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Huỷ')}
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            {initial ? t('Lưu') : t('Thêm & tải thao tác')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Tên hiển thị')} required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('vd GitHub công ty')} />
          </Field>
          <Field label={t('Mã (tên máy chủ MCP)')} hint={t('Chữ thường, số, gạch ngang')}>
            <Input value={key} onChange={(e) => setKey(e.target.value.toLowerCase())} className="font-mono" />
          </Field>
        </div>
        {preset?.kind === 'custom' || initial?.kind === 'custom' ? (
          <Segmented
            value={transport}
            onChange={setTransport}
            options={[
              { value: 'stdio', label: t('Lệnh trên máy (stdio)') },
              { value: 'http', label: t('Từ xa (HTTP)') },
            ]}
          />
        ) : null}
        {transport === 'stdio' ? (
          <>
            <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
              <Field label={t('Lệnh')} required>
                <Input value={command} onChange={(e) => setCommand(e.target.value)} className="font-mono" placeholder="npx" />
              </Field>
              <Field label={t('Tham số (mỗi dòng một tham số)')}>
                <Textarea value={args} onChange={(e) => setArgs(e.target.value)} className="min-h-[72px] font-mono text-[12.5px]" placeholder={'-y\n@modelcontextprotocol/server-filesystem\nD:/du-an'} />
              </Field>
            </div>
            <Field label={t('Biến môi trường (TEN=giá trị, mỗi dòng một biến)')} hint={t('Dùng "secret:KHOA" để lấy từ Kho bí mật (vd NOTION_TOKEN=secret:NOTION_MCP_TOKEN).')}>
              <Textarea value={env} onChange={(e) => setEnv(e.target.value)} className="min-h-[64px] font-mono text-[12.5px]" />
            </Field>
          </>
        ) : (
          <>
            <Field label={t('Địa chỉ máy chủ MCP')} required>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} className="font-mono" placeholder="https://…/mcp" />
            </Field>
            <Field label={t('Header (Tên: giá trị, mỗi dòng một header)')} hint={t('Có thể dùng "secret:KHOA", vd Authorization: Bearer secret:GITHUB_MCP_TOKEN.')}>
              <Textarea value={headers} onChange={(e) => setHeaders(e.target.value)} className="min-h-[64px] font-mono text-[12.5px]" />
            </Field>
          </>
        )}
        <Field label={tok?.label ?? t('Token (tuỳ chọn)')} hint={`${tok?.help ?? t('Token được lưu mã hoá trong Kho bí mật, cấu hình chỉ giữ tham chiếu.')}${initial ? ` ${t('Để trống = giữ token hiện tại.')}` : ''}`}>
          <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" placeholder={initial ? '••••••' : ''} />
        </Field>
        <Field label={t('Thao tác chưa có trong danh sách')}>
          <Segmented value={defaultPolicy} onChange={setDefaultPolicy} options={(['allow', 'ask', 'off'] as McpPolicy[]).map((p) => ({ value: p, label: MCP_POLICY_LABEL[p] }))} />
        </Field>
        <Field label={t('Phòng được dùng')} hint={t('Không chọn phòng nào = mọi phòng.')}>
          <div className="flex flex-wrap gap-1.5">
            {departments
              .filter((d) => d.enabled)
              .map((d) => {
                const on = depts.includes(d._id);
                return (
                  <button
                    key={d._id}
                    type="button"
                    onClick={() => setDepts((s) => (on ? s.filter((x) => x !== d._id) : [...s, d._id]))}
                    className={clsx('rounded-full border px-3 py-1 text-[12.5px]', on ? 'border-accent bg-accent/10 text-accent' : 'border-line text-muted hover:bg-surface-2')}
                  >
                    {t(d.name)}
                  </button>
                );
              })}
          </div>
        </Field>
        {preset?.docs && (
          <a href={preset.docs} target="_blank" rel="noreferrer" className="text-[12.5px] text-accent hover:underline">
            {t('Tài liệu của máy chủ MCP này ↗')}
          </a>
        )}
      </div>
    </Modal>
  );
}

function PolicyEditor({ conn, onClose }: { conn: McpConnection; onClose: () => void }) {
  const [map, setMap] = useState<Record<string, McpPolicy>>(() => Object.fromEntries(conn.tools.map((tool) => [tool.name, tool.policy])));
  const [def, setDef] = useState<McpPolicy>(conn.defaultPolicy);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const shown = useMemo(() => conn.tools.filter((tool) => !q.trim() || `${tool.name} ${tool.description ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())), [conn.tools, q]);
  const bulk = (fn: (readOnly: boolean) => McpPolicy) => setMap(Object.fromEntries(conn.tools.map((tool) => [tool.name, fn(Boolean(tool.readOnly))])));
  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`${KEY}/${conn._id}`, { action: 'policies', policies: map, defaultPolicy: def });
      await mutate(KEY);
      toast.success(t('Đã lưu quyền thao tác'));
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
      size="xl"
      title={t('Quyền thao tác – {name}', { name: connName(conn) })}
      description={t('Cho phép: agent tự chạy · Hỏi trước: tạo thẻ phê duyệt, chờ bạn · Tắt: chặn hẳn.')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Huỷ')}
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            {t('Lưu quyền')}
          </Button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Tìm thao tác…')} className="h-9 max-w-xs text-[13px]" />
        <Button size="sm" variant="outline" onClick={() => bulk((ro) => (ro ? 'allow' : 'ask'))}>
          {t('Đọc: cho phép · Ghi: hỏi trước')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => bulk(() => 'ask')}>
          {t('Tất cả hỏi trước')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => bulk((ro) => (ro ? 'allow' : 'off'))}>
          {t('Chỉ cho đọc')}
        </Button>
        <span className="ml-auto flex items-center gap-2 text-[12.5px] text-muted">
          {t('Thao tác mới:')}
          <Segmented value={def} onChange={setDef} options={(['allow', 'ask', 'off'] as McpPolicy[]).map((p) => ({ value: p, label: MCP_POLICY_LABEL[p] }))} />
        </span>
      </div>
      <div className="divide-y divide-line rounded-2xl border border-line">
        {shown.map((tool) => (
          <div key={tool.name} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[12.5px] font-medium">{tool.name}</span>
                {tool.readOnly ? <Badge color="#5C9A68">{t('đọc')}</Badge> : <Badge color="#C9952F">{t('ghi')}</Badge>}
              </div>
              {tool.description && <div className="line-clamp-2 text-[12px] text-muted">{tool.description}</div>}
            </div>
            <Segmented value={map[tool.name] ?? tool.policy} onChange={(v) => setMap((m) => ({ ...m, [tool.name]: v }))} options={(['allow', 'ask', 'off'] as McpPolicy[]).map((p) => ({ value: p, label: MCP_POLICY_LABEL[p] }))} />
          </div>
        ))}
        {!shown.length && <div className="px-3 py-6 text-center text-[13px] text-muted">{t('Không có thao tác phù hợp.')}</div>}
      </div>
    </Modal>
  );
}

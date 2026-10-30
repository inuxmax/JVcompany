'use client';
// Chọn công ty đang làm việc (mỗi công ty là một toà nhà riêng), tạo công ty mới, lưu trữ / xoá công ty.
import { useEffect, useRef, useState } from 'react';
import useSWR, { mutate } from 'swr';
import clsx from 'clsx';
import { Archive, ArchiveRestore, Building, Check, ChevronsUpDown, Plus, Settings2, Trash2 } from 'lucide-react';
import type { Company } from '@/lib/types';
import { api } from '@/lib/client/api';
import { timeAgo } from '@/lib/client/format';
import { Badge, Button, Field, Input, Modal, Textarea, confirmDialog, toast } from './ui';
import { t } from '@/lib/i18n';

interface Resp {
  current: string;
  companies: Company[];
}

async function switchTo(id: string) {
  await api.post('/api/companies/switch', { id });
  // Tải lại toàn trang: dữ liệu, sự kiện realtime và toà nhà 3D đều theo công ty mới
  window.location.assign(new URL('/', window.location.href));
}

/** `compact`: trong bảng "Thêm" của điện thoại (mở lên trên); `block`: rộng hết thanh menu dọc. */
export function CompanySwitcher({ compact, block }: { compact?: boolean; block?: boolean }) {
  const { data } = useSWR<Resp>('/api/companies', { revalidateOnFocus: false });
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const companies = (data?.companies ?? []).filter((c) => c.status !== 'archived');
  const current = data?.companies.find((c) => c._id === data.current);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={clsx('flex h-9 max-w-[220px] items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium text-muted transition-colors hover:bg-surface-3 hover:text-fg', (compact || block) && 'w-full max-w-none justify-between bg-surface-3')}
        aria-label={t('Chọn công ty')}
        title={t('Chọn công ty')}
      >
        <Building className="size-4 shrink-0 text-accent" />
        <span className="truncate">{current?.name ?? '…'}</span>
        <ChevronsUpDown className="size-3.5 shrink-0" />
      </button>
      {open && (
        <div className={clsx('animate-vp-in absolute z-50 mt-2 w-72 rounded-2xl border border-line bg-surface-solid p-1.5 shadow-xl', compact ? 'bottom-full left-0 mb-2' : 'top-full left-0')}>
          <div className="px-3 pt-1.5 pb-1 text-[11px] font-semibold tracking-wider text-subtle uppercase">{t('Công ty (mỗi công ty một toà nhà)')}</div>
          {companies.map((c) => (
            <button
              key={c._id}
              type="button"
              onClick={() => (c._id === data?.current ? setOpen(false) : void switchTo(c._id).catch((e) => toast.error(e)))}
              className={clsx('flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13.5px]', c._id === data?.current ? 'bg-surface-3 font-medium' : 'text-muted hover:bg-surface-3 hover:text-fg')}
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-fg/90 font-display text-[11px] font-semibold text-bg">{c.name.slice(0, 1).toUpperCase()}</span>
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              {c.status === 'paused' && <Badge color="#C9952F">{t('tạm dừng')}</Badge>}
              {c._id === data?.current && <Check className="size-4 text-accent" />}
            </button>
          ))}
          <div className="my-1 border-t border-line" />
          <button type="button" onClick={() => (setOpen(false), setCreating(true))} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] text-muted hover:bg-surface-3 hover:text-fg">
            <Plus className="size-4" /> {t('Tạo công ty mới')}
          </button>
          <button type="button" onClick={() => (setOpen(false), setManaging(true))} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] text-muted hover:bg-surface-3 hover:text-fg">
            <Settings2 className="size-4" /> {t('Quản lý công ty')}
          </button>
        </div>
      )}
      {creating && <CreateCompany onClose={() => setCreating(false)} />}
      {managing && data && <ManageCompanies data={data} onClose={() => setManaging(false)} />}
    </div>
  );
}

function CreateCompany({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [mission, setMission] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const c = await api.post<Company>('/api/companies', { name, mission });
      toast.success(t('Đã tạo {name} – chuyển sang thiết lập ban đầu', { name: c.name }));
      await switchTo(c._id);
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t('Tạo công ty mới')}
      description={t('Công ty mới là một toà nhà riêng: phòng ban, dự án, tầng, ngân sách, kỹ năng… tách biệt hoàn toàn. Kết nối AI dùng chung.')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Huỷ')}
          </Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={create}>
            {t('Tạo & thiết lập')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('Tên công ty')} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('vd Studio Ánh Trăng')} autoFocus />
        </Field>
        <Field label={t('Sứ mệnh (tuỳ chọn)')}>
          <Textarea value={mission} onChange={(e) => setMission(e.target.value)} className="min-h-[72px]" placeholder={t('Công ty làm gì, cho ai…')} />
        </Field>
      </div>
    </Modal>
  );
}

function ManageCompanies({ data, onClose }: { data: Resp; onClose: () => void }) {
  const [names, setNames] = useState<Record<string, string>>({});
  const refresh = () => mutate('/api/companies');
  const patch = async (c: Company, body: Record<string, unknown>, msg: string) => {
    try {
      await api.patch(`/api/companies/${c._id}`, body);
      await refresh();
      toast.success(msg);
    } catch (e) {
      toast.error(e);
    }
  };
  const remove = async (c: Company) => {
    const ok = await confirmDialog({
      title: t('Xoá hẳn {name}?', { name: c.name }),
      message: t('Toàn bộ dự án, nhiệm vụ, phòng ban, tài liệu, chi phí… của công ty này bị xoá vĩnh viễn và không khôi phục được. Nên xuất gói công ty trước (Công ty & dữ liệu → Xuất).'),
      confirmLabel: t('Xoá vĩnh viễn'),
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.del(`/api/companies/${c._id}`);
      await refresh();
      toast.success(t('Đã xoá công ty'));
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={t('Quản lý công ty')} description={t('Lưu trữ để ẩn công ty (dữ liệu còn nguyên, worker ngừng chạy). Chỉ xoá hẳn được công ty đã lưu trữ.')}>
      <div className="divide-y divide-line rounded-2xl border border-line">
        {data.companies.map((c) => {
          const main = c._id === 'main';
          const archived = c.status === 'archived';
          return (
            <div key={c._id} className={clsx('flex flex-wrap items-center gap-2 px-3 py-3', archived && 'opacity-70')}>
              <div className="min-w-0 flex-1">
                <Input value={names[c._id] ?? c.name} onChange={(e) => setNames((n) => ({ ...n, [c._id]: e.target.value }))} className="h-9 text-[13.5px] font-medium" />
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-subtle">
                  <span className="font-mono">{c._id}</span>· {t('mã việc {prefix}-…', { prefix: c.issuePrefix })} · {t('tạo {time}', { time: timeAgo(c.createdAt) })}
                  {main && <Badge color="#4A86BD">{t('công ty chính')}</Badge>}
                  {c._id === data.current && <Badge color="#5C9A68">{t('đang mở')}</Badge>}
                  {archived && <Badge color="#958B7E">{t('đã lưu trữ')}</Badge>}
                </div>
              </div>
              {names[c._id] !== undefined && names[c._id] !== c.name && (
                <Button size="sm" variant="primary" onClick={() => patch(c, { name: names[c._id] }, t('Đã đổi tên'))}>
                  {t('Lưu tên')}
                </Button>
              )}
              {!archived && c._id !== data.current && (
                <Button size="sm" variant="outline" onClick={() => void switchTo(c._id).catch((e) => toast.error(e))}>
                  {t('Mở')}
                </Button>
              )}
              {!main && !archived && c._id !== data.current && (
                <Button size="sm" variant="ghost" onClick={() => patch(c, { status: 'archived' }, t('Đã lưu trữ'))} icon={<Archive className="size-3.5" />}>
                  {t('Lưu trữ')}
                </Button>
              )}
              {archived && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => patch(c, { status: 'active' }, t('Đã mở lại'))} icon={<ArchiveRestore className="size-3.5" />}>
                    {t('Mở lại')}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-danger" onClick={() => remove(c)} icon={<Trash2 className="size-3.5" />}>
                    {t('Xoá hẳn')}
                  </Button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

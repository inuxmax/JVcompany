'use client';
// Kỹ năng (SKILL.md): viết tay hoặc nhập từ URL / GitHub / thư mục; có phiên bản và khôi phục; gán cho phòng ban.
import { useState } from 'react';
import Link from 'next/link';
import useSWR, { mutate } from 'swr';
import { Download, History, Package, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import type { Department, Skill } from '@/lib/types';
import { api } from '@/lib/client/api';
import { t } from '@/lib/i18n';
import { timeAgo } from '@/lib/client/format';
import { Page, PageHeader } from '@/components/shell';
import { Badge, Button, Card, DeptAvatar, EmptyState, Field, Input, Markdown, Modal, Segmented, Skeleton, Textarea, confirmDialog, toast } from '@/components/ui';

type SkillRow = Skill & { departments: string[] };

/** Kỹ năng có sẵn / cài từ thư viện dựng sẵn lưu tên + mô tả gốc (tiếng Việt) → dịch khi hiển thị; kỹ năng bạn viết giữ nguyên. */
const skillText = (s: Skill, text: string) => (s.source.type === 'builtin' || s.source.type === 'library' ? t(text) : text);

const skillTemplate = () => `---
name: ${t('Tên kỹ năng')}
description: ${t('Dùng khi … (mô tả lúc nào agent nên dùng kỹ năng này)')}
---

# ${t('Cách làm')}

1. …
2. …
`;

function SkillEditor({ skill, departments, onClose }: { skill?: SkillRow | null; departments: Department[]; onClose: () => void }) {
  const [mode, setMode] = useState<'write' | 'import'>(skill ? 'write' : 'write');
  const [markdown, setMarkdown] = useState(() => skill?.markdown ?? skillTemplate());
  const [locator, setLocator] = useState('');
  const [note, setNote] = useState('');
  const [assigned, setAssigned] = useState<string[]>(skill?.departments ?? []);
  const [tab, setTab] = useState<'edit' | 'preview' | 'versions'>('edit');
  const [busy, setBusy] = useState(false);
  const { data: full } = useSWR<Skill>(skill && tab === 'versions' ? `/api/skills/${skill._id}` : null);
  const builtin = skill?.source.type === 'builtin';

  const save = async () => {
    setBusy(true);
    try {
      let saved: Skill;
      if (!skill && mode === 'import') saved = await api.post<Skill>('/api/skills', { locator });
      else if (!skill) saved = await api.post<Skill>('/api/skills', { markdown });
      else saved = await api.patch<Skill>(`/api/skills/${skill._id}`, { markdown, note });
      if (!builtin) await api.patch(`/api/skills/${saved._id}`, { departments: assigned });
      await Promise.all([mutate('/api/skills'), mutate('/api/departments')]);
      toast.success(t('Đã lưu kỹ năng'));
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const restore = async (version: number) => {
    await api.patch(`/api/skills/${skill!._id}`, { restore: version });
    await Promise.all([mutate('/api/skills'), mutate(`/api/skills/${skill!._id}`)]);
    toast.success(t('Đã khôi phục phiên bản {version}', { version }));
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={skill ? skillText(skill, skill.name) : t('Thêm kỹ năng')}
      description={t('Kỹ năng là tệp SKILL.md: phần đầu có name + description (agent đọc để biết khi nào dùng), phần thân là hướng dẫn chi tiết.')}
      footer={
        tab !== 'versions' ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('Huỷ')}
            </Button>
            <Button variant="primary" onClick={save} loading={busy}>
              {mode === 'import' && !skill ? t('Nhập') : t('Lưu')}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {!skill && (
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'write', label: t('Tự viết') },
              { value: 'import', label: t('Nhập từ URL / GitHub / thư mục') },
            ]}
          />
        )}
        {mode === 'import' && !skill ? (
          <Field label={t('Nguồn')} hint={t('Link GitHub (trang tệp SKILL.md hoặc thư mục), link tải trực tiếp, hoặc đường dẫn thư mục / tệp trên máy.')}>
            <Input autoFocus value={locator} onChange={(e) => setLocator(e.target.value)} placeholder="https://github.com/ten/repo/tree/main/skills/viet-test" className="font-mono text-[12.5px]" />
          </Field>
        ) : (
          <>
            {skill && (
              <Segmented
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'edit', label: t('Soạn') },
                  { value: 'preview', label: t('Xem trước') },
                  { value: 'versions', label: t('Phiên bản ({n})', { n: skill.currentVersion }) },
                ]}
              />
            )}
            {tab === 'edit' && <Textarea rows={16} value={markdown} onChange={(e) => setMarkdown(e.target.value)} className="font-mono text-[12.5px]" />}
            {tab === 'preview' && (
              <div className="max-h-[420px] overflow-auto rounded-xl border border-line p-4">
                <Markdown>{markdown.replace(/^---[\s\S]*?---/, '')}</Markdown>
              </div>
            )}
            {tab === 'versions' && (
              <div className="space-y-2">
                {!full ? (
                  <Skeleton className="h-24" />
                ) : (
                  [...(full.versions ?? [])].reverse().map((v) => (
                    <div key={v.version} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-[13px]">
                      <History className="size-3.5 text-subtle" />
                      <b>{t('Phiên bản {version}', { version: v.version })}</b>
                      {v.note && <span className="text-muted">· {v.note}</span>}
                      <span className="ml-auto text-[12px] text-subtle">{timeAgo(v.createdAt)}</span>
                      {v.version !== full.currentVersion && (
                        <Button size="xs" variant="outline" onClick={() => restore(v.version)} icon={<RotateCcw className="size-3.5" />}>
                          {t('Khôi phục')}
                        </Button>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
            {skill && tab === 'edit' && (
              <Field label={t('Ghi chú phiên bản (tuỳ chọn)')}>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Đã thêm bước kiểm tra…')} />
              </Field>
            )}
          </>
        )}
        {!builtin && tab !== 'versions' && (
          <Field label={t('Gán cho phòng ban')}>
            <div className="flex flex-wrap gap-1.5">
              {departments
                .filter((d) => d.enabled)
                .map((d) => {
                  const on = assigned.includes(d._id);
                  return (
                    <button
                      key={d._id}
                      type="button"
                      onClick={() => setAssigned(on ? assigned.filter((x) => x !== d._id) : [...assigned, d._id])}
                      className={`flex items-center gap-1.5 rounded-full border py-1 pr-2.5 pl-1 text-[12.5px] ${on ? 'border-accent bg-accent/8' : 'border-line text-muted'}`}
                    >
                      <DeptAvatar icon={d.icon} color={d.color} size="sm" className="!size-6 !rounded-full" />
                      {t(d.name)}
                    </button>
                  );
                })}
            </div>
          </Field>
        )}
      </div>
    </Modal>
  );
}

export default function SkillsPage() {
  const { data } = useSWR<SkillRow[]>('/api/skills');
  const { data: departments } = useSWR<Department[]>('/api/departments');
  const [editing, setEditing] = useState<SkillRow | null | 'new'>(null);
  const remove = async (s: SkillRow) => {
    const ok = await confirmDialog({ title: t('Xoá kỹ năng?'), message: t('"{name}" sẽ bị gỡ khỏi mọi phòng ban.', { name: skillText(s, s.name) }), confirmLabel: t('Xoá'), tone: 'danger' });
    if (!ok) return;
    try {
      await api.del(`/api/skills/${s._id}`);
      await mutate('/api/skills');
    } catch (e) {
      toast.error(e);
    }
  };
  const dept = (id: string) => departments?.find((d) => d._id === id);
  return (
    <Page>
      <PageHeader
        eyebrow={t('Công ty')}
        title={t('Kỹ năng')}
        description={t('Kỹ năng dùng chung cho các phòng: quy trình, tiêu chuẩn, cách làm. Agent thấy tên + mô tả và đọc toàn bộ khi cần.')}
        actions={
          <>
            <Link href="/plugins">
              <Button variant="outline" icon={<Package className="size-4" />}>
                {t('Kho kỹ năng & plugin')}
              </Button>
            </Link>
            <Button variant="primary" onClick={() => setEditing('new')} icon={<Plus className="size-4" />}>
              {t('Thêm kỹ năng')}
            </Button>
          </>
        }
      />
      {!data ? (
        <Skeleton className="h-48" />
      ) : !data.length ? (
        <Card>
          <EmptyState icon={<Sparkles className="size-6" />} title={t('Chưa có kỹ năng')} />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((s) => (
            <Card key={s._id} className="flex flex-col p-4">
              <button type="button" onClick={() => setEditing(s)} className="min-w-0 flex-1 text-left">
                <div className="flex flex-wrap items-center gap-2">
                  <Sparkles className="size-4 text-accent" />
                  <span className="text-[14.5px] font-semibold">{skillText(s, s.name)}</span>
                  {s.source.type === 'builtin' ? <Badge color="#958B7E">{t('Có sẵn')}</Badge> : s.source.type !== 'manual' ? <Badge color="#4A86BD">{s.source.type === 'github' ? 'GitHub' : s.source.type === 'url' ? 'URL' : s.source.type === 'library' ? t('Thư viện') : t('Thư mục')}</Badge> : null}
                  <span className="ml-auto text-[11.5px] text-subtle">v{s.currentVersion}</span>
                </div>
                <p className="mt-1 line-clamp-3 text-[12.5px] text-muted">{s.description ? skillText(s, s.description) : t('(chưa có mô tả)')}</p>
              </button>
              <div className="mt-3 flex items-center gap-1">
                <div className="flex -space-x-1.5">
                  {s.departments.slice(0, 8).map((id) => {
                    const d = dept(id);
                    return d ? <DeptAvatar key={id} icon={d.icon} color={d.color} size="sm" className="!size-6 !rounded-full ring-2 ring-surface" /> : null;
                  })}
                </div>
                <span className="ml-1 text-[12px] text-subtle">{t('{n} phòng', { n: s.departments.length })}</span>
                {s.source.type !== 'builtin' && <Button size="xs" variant="ghost" onClick={() => remove(s)} icon={<Trash2 className="size-3.5" />} className="ml-auto" aria-label={t('Xoá')} />}
              </div>
            </Card>
          ))}
          <Card className="flex flex-col items-start justify-center gap-2 border-dashed p-4 text-[13px] text-muted">
            <Download className="size-4" />
            {t('Nhập kỹ năng từ GitHub (vd thư viện skills cộng đồng) hoặc từ thư mục trên máy.')}
            <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
              {t('Nhập kỹ năng')}
            </Button>
          </Card>
        </div>
      )}
      {editing && <SkillEditor skill={editing === 'new' ? null : editing} departments={departments ?? []} onClose={() => setEditing(null)} />}
    </Page>
  );
}

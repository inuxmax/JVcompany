'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import clsx from 'clsx';
import { ArrowLeft, Rocket, Save } from 'lucide-react';
import type { Department, PermissionLevel, Project, ProjectInspection, Settings, Workflow } from '@/lib/types';
import { DIRECTOR_WORKFLOW_ID, PERMISSION_LEVELS } from '@/lib/catalog';
import { api } from '@/lib/client/api';
import { tint } from '@/lib/client/format';
import { t } from '@/lib/i18n';
import { Page, PageHeader } from '@/components/shell';
import { Button, Card, CardHeader, DeptAvatar, Field, Input, Switch, Textarea, toast } from '@/components/ui';
import { FolderField, WorkflowPicker } from '@/components/domain';

export default function NewProjectPage() {
  const router = useRouter();
  const { data: settings } = useSWR<Settings>('/api/settings');
  const { data: workflows } = useSWR<Workflow[]>('/api/workflows');
  const [workflowId, setWorkflowId] = useState(DIRECTOR_WORKFLOW_ID);
  const workflow = workflows?.find((w) => w._id === workflowId);
  const directorMode = workflowId === DIRECTOR_WORKFLOW_ID;
  const { data: depts } = useSWR<Department[]>('/api/departments');
  const [path, setPath] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [description, setDescription] = useState('');
  const [autopilot, setAutopilot] = useState(true);
  const [permissionSel, setPermission] = useState<PermissionLevel | null>(null);
  const permission: PermissionLevel = permissionSel ?? settings?.defaultPermission ?? 'write';
  const [busy, setBusy] = useState<'start' | 'draft' | null>(null);
  const [touched, setTouched] = useState(false);

  // Tự điền tên/mô tả từ thư mục dự án đã chọn.
  useEffect(() => {
    if (!path) return;
    api
      .get<ProjectInspection>(`/api/fs/inspect?path=${encodeURIComponent(path)}`)
      .then((info) => {
        if (!touched) {
          setName((n) => n || info.name);
          setDescription((d) => d || (info.description ? `${info.description}\n\n${t('Công nghệ: {stack}', { stack: info.stack.join(', ') || t('chưa rõ') })}` : ''));
        }
      })
      .catch(() => {});
  }, [path, touched]);

  const submit = async (start: boolean) => {
    if (!name.trim()) {
      toast.error(t('Hãy nhập tên dự án'));
      return;
    }
    setBusy(start ? 'start' : 'draft');
    try {
      const p = await api.post<Project>('/api/projects', { name, goal, description, path, autopilot, permission, workflowId, start });
      toast.success(start ? t('Đã khởi động dự án') : t('Đã lưu dự án'));
      router.push(`/projects/${p._id}`);
    } catch (e) {
      toast.error(e);
      setBusy(null);
    }
  };

  const full = permission === 'full';

  return (
    <Page>
      <PageHeader
        breadcrumb={
          <Link href="/projects" className="inline-flex items-center gap-1 hover:text-fg">
            <ArrowLeft className="size-3.5" /> {t('Dự án')}
          </Link>
        }
        title={t('Tạo dự án mới')}
        description={t('Chọn thư mục trên máy, mô tả mục tiêu – Giám đốc AI sẽ phân tích và giao việc cho các phòng ban.')}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title={t('1. Thư mục dự án')} description={t('Dự án có sẵn trên máy tính hoặc thư mục trống cho dự án mới.')} />
            <div className="px-5 pb-5">
              <FolderField value={path} onChange={setPath} />
            </div>
          </Card>

          <Card>
            <CardHeader title={t('2. Mục tiêu & yêu cầu')} description={t('Càng cụ thể, các phòng ban làm việc càng chính xác.')} />
            <div className="space-y-4 px-5 pb-5">
              <Field label={t('Tên dự án')} required>
                <Input
                  value={name}
                  onChange={(e) => {
                    setTouched(true);
                    setName(e.target.value);
                  }}
                  placeholder={t('vd: Website bán hàng thời trang')}
                />
              </Field>
              <Field label={t('Mục tiêu')} hint={t('Một câu: kết quả cuối cùng bạn muốn đạt được.')}>
                <Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={t('vd: Ra mắt MVP cho phép khách đặt hàng và thanh toán online')} />
              </Field>
              <Field label={t('Mô tả chi tiết / yêu cầu')} hint={t('Tính năng, người dùng, công nghệ mong muốn, ràng buộc, tài liệu tham khảo…')}>
                <Textarea
                  value={description}
                  onChange={(e) => {
                    setTouched(true);
                    setDescription(e.target.value);
                  }}
                  className="min-h-[160px]"
                  placeholder={t('- Người dùng: …\n- Tính năng chính: …\n- Công nghệ: …\n- Hạn chót / ràng buộc: …')}
                />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title={t('3. Cách làm việc')} description={t('Giao một lần cho giám đốc tầng, hoặc đi theo quy trình nhiều giai đoạn.')} />
            <div className="px-5 pb-5">{workflows ? <WorkflowPicker workflows={workflows} value={workflowId} onChange={setWorkflowId} /> : null}</div>
          </Card>

          <Card>
            <CardHeader title={t('4. Quyền hạn tối đa')} description={t('Giám đốc cấp quyền cho từng việc nhưng không vượt mức này.')} />
            <div className="space-y-4 px-5 pb-5">
              <div className="grid gap-2 sm:grid-cols-2">
                {PERMISSION_LEVELS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPermission(p.id)}
                    className={clsx('rounded-xl border p-3 text-left transition-all', permission === p.id ? 'border-transparent' : 'border-line hover:border-line-strong')}
                    style={permission === p.id ? { background: tint(p.color, 0.08), boxShadow: `0 0 0 2px ${p.color}` } : undefined}
                  >
                    <div className="text-[13.5px] font-semibold" style={{ color: p.color }}>
                      {p.label}
                    </div>
                    <div className="mt-0.5 text-[12px] text-muted">{p.description}</div>
                  </button>
                ))}
              </div>
              {full && !settings?.computerControl && (
                <div className="rounded-xl border border-warn/30 bg-warn/10 px-3 py-2 text-[12.5px] text-warn">
                  {t('Điều khiển chuột/bàn phím/chụp màn hình đang tắt trong Cài đặt. Agent vẫn có toàn quyền tệp và lệnh.')}
                  <Link href="/settings" className="ml-1 underline">
                    {t('Mở Cài đặt')}
                  </Link>
                </div>
              )}
              <div className="flex items-center justify-between gap-4 rounded-xl border border-line p-3">
                <div>
                  <div className="text-[13.5px] font-medium">{directorMode ? t('Tự hoàn tất khi có báo cáo') : t('Tự động chuyển giai đoạn')}</div>
                  <div className="text-[12.5px] text-muted">
                    {directorMode
                      ? t('Dự án tự kết thúc khi giám đốc nộp báo cáo tổng hợp. Tắt để bạn xem báo cáo rồi tự bấm Hoàn tất.')
                      : t('Khi các phòng duyệt đạt, tự sang giai đoạn tiếp theo. Tắt để bạn tự quyết định từng bước.')}
                  </div>
                </div>
                <Switch checked={autopilot} onChange={setAutopilot} />
              </div>
            </div>
          </Card>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" size="lg" onClick={() => submit(false)} loading={busy === 'draft'} disabled={!!busy} icon={<Save className="size-4" />}>
              {t('Lưu nháp')}
            </Button>
            <Button variant="primary" size="lg" onClick={() => submit(true)} loading={busy === 'start'} disabled={!!busy} icon={<Rocket className="size-4" />}>
              {t('Tạo & khởi động')}
            </Button>
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card className="p-5">
            <h3 className="text-[15px] font-semibold">{t('Quy trình sẽ chạy')}</h3>
            {directorMode ? (
              <ol className="mt-3 space-y-3">
                {[
                  [t('Bạn giao yêu cầu'), t('Một lần duy nhất, cho giám đốc tầng.')],
                  [t('Giám đốc xem xét'), t('Xác định đúng phạm vi, chia việc cho cấp dưới theo chuyên môn.')],
                  [t('Các phòng làm việc'), t('Mỗi việc được cấp quyền vừa đủ (chỉ đọc, sửa tệp, chạy lệnh…).')],
                  [t('Giám đốc tổng hợp'), t('Kiểm tra kết quả, giao bổ sung nếu thiếu, gửi báo cáo cho bạn.')],
                ].map(([title, d], i) => (
                  <li key={title} className="flex gap-3">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11.5px] font-semibold">{i + 1}</span>
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-medium">{title}</div>
                      <div className="text-[12px] text-muted">{d}</div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
            <ol className="mt-3 space-y-3">
              {(workflow?.phases ?? []).map((ph, i) => {
                const lead = depts?.find((d) => d._id === ph.lead);
                return (
                  <li key={ph.id} className="flex gap-3">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11.5px] font-semibold">{i + 1}</span>
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-medium">{t(ph.name)}</div>
                      <div className="flex items-center gap-1.5 text-[12px] text-muted">
                        {lead && <DeptAvatar icon={lead.icon} color={lead.color} size="sm" className="size-5 rounded-md [&_svg]:size-3" />}
                        {lead ? t(lead.name) : ph.lead}
                        {ph.requiredApprovals.length > 0 && <span className="text-subtle">· {t('cần duyệt')}</span>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
            )}
          </Card>
        </aside>
      </div>
    </Page>
  );
}

'use client';
// Ô chọn model: danh sách tải thật từ kết nối (hoặc gợi ý), có thể tự nhập tên khác.
import { useState } from 'react';
import { ListFilter, PencilLine, RefreshCw } from 'lucide-react';
import { modelAvailable } from '@/lib/catalog';
import { Button, Input, Select } from '@/components/ui';
import { t } from '@/lib/i18n';

const CUSTOM = '__custom__';

export function ModelPicker({
  value,
  onChange,
  live,
  suggested = [],
  emptyLabel,
  onRefresh,
  refreshing,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Model tải từ API của kết nối – khi có thì chỉ hiện danh sách này. */
  live: string[];
  /** Gợi ý dùng khi chưa có danh sách thật (CLI, chưa nhập khóa…). */
  suggested?: string[];
  /** Có giá trị → thêm lựa chọn "để trống" với nhãn này. */
  emptyLabel?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const options = live.length ? live : Array.from(new Set(suggested));
  const [custom, setCustom] = useState(false);
  const unlisted = value !== '' && !options.includes(value);
  const missing = value !== '' && live.length > 0 && !modelAvailable({ kind: 'api', models: live }, value);

  return (
    <div>
      <div className="flex gap-2">
        {custom ? (
          <Input autoFocus value={value} onChange={(e) => onChange(e.target.value)} placeholder={t('Tên model, vd: gpt-5')} className="min-w-0 flex-1 font-mono text-[12.5px]" />
        ) : (
          <Select
            value={value}
            onChange={(e) => (e.target.value === CUSTOM ? setCustom(true) : onChange(e.target.value))}
            className="min-w-0 flex-1 font-mono text-[12.5px]"
          >
            {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
            {unlisted && <option value={value}>{value}{missing ? ` ${t('(không có trong danh sách)')}` : ''}</option>}
            {options.length > 0 && (
              <optgroup label={live.length ? t('Từ kết nối · {n} model', { n: live.length }) : t('Gợi ý')}>
                {options.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </optgroup>
            )}
            <option value={CUSTOM}>{t('Nhập tên model khác…')}</option>
          </Select>
        )}
        {custom && (
          <Button variant="ghost" onClick={() => setCustom(false)} icon={<ListFilter className="size-4" />} className="h-11">
            {t('Danh sách')}
          </Button>
        )}
        {onRefresh && (
          <Button variant="outline" onClick={onRefresh} loading={refreshing} icon={<RefreshCw className="size-4" />} className="h-11">
            {t('Tải model')}
          </Button>
        )}
      </div>
      {missing && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-warn">
          <PencilLine className="size-3.5 shrink-0" />
          {t('“{value}” không có trong danh sách kết nối trả về – nên chọn lại.', { value })}
        </p>
      )}
    </div>
  );
}

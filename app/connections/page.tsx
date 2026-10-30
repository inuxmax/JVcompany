'use client';
// Kết nối dịch vụ cho agent (MCP: GitHub, Notion, máy chủ tuỳ chỉnh) và kênh chat bên ngoài (Telegram).
import { useState } from 'react';
import { Cable } from 'lucide-react';
import { Page, PageHeader } from '@/components/shell';
import { Segmented } from '@/components/ui';
import { McpConnections } from '@/components/connections-mcp';
import { ChatConnectors } from '@/components/connections-chat';
import { t } from '@/lib/i18n';

export default function ConnectionsPage() {
  const [tab, setTab] = useState<'mcp' | 'chat'>('mcp');
  return (
    <Page>
      <PageHeader
        eyebrow={t('Công ty')}
        title={t('Kết nối dịch vụ')}
        description={t('Dịch vụ agent được dùng (GitHub, Notion, máy chủ MCP) và kênh chat bên ngoài để nhắn văn phòng từ điện thoại.')}
        icon={<Cable className="size-7 text-accent" />}
        actions={
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'mcp', label: t('Dịch vụ (MCP)') },
              { value: 'chat', label: t('Kênh chat') },
            ]}
          />
        }
      />
      {tab === 'mcp' ? <McpConnections /> : <ChatConnectors />}
    </Page>
  );
}

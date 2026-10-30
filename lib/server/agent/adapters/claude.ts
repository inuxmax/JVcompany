// Claude Code CLI: `claude -p --output-format stream-json`, chữ hiện dần (--include-partial-messages), làm tiếp phiên bằng --resume.
import type { PermissionLevel, Provider } from '../../../types';
import { attachmentDir } from '../../attachments';
import type { CliAdapter, CliEvent } from './types';
import { sysMsg } from '../../../i18n/format';
import { describeTool, effortFor, envCheck, num, obj, opt, optNum, str } from './shared';

function permArgs(level: PermissionLevel): string[] {
  switch (level) {
    case 'read':
      // Không dùng --permission-mode plan: ở chế độ đó Claude Code ghi kế hoạch ra tệp riêng và trả về bản tóm tắt,
      // làm mất khối vp-result (danh sách giao việc). Chỉ đọc = cấm công cụ sửa tệp, chỉ cho lệnh đọc.
      return [
        '--permission-mode',
        'default',
        '--disallowedTools',
        'Edit',
        'Write',
        'MultiEdit',
        'NotebookEdit',
        'ExitPlanMode',
        '--allowedTools',
        'Read',
        'Grep',
        'Glob',
        'LS',
        'Bash(ls:*)',
        'Bash(find:*)',
        'Bash(cat:*)',
        'Bash(head:*)',
        'Bash(tail:*)',
        'Bash(wc:*)',
        'Bash(grep:*)',
        'Bash(git status:*)',
        'Bash(git log:*)',
        'Bash(git diff:*)',
      ];
    case 'write':
      return ['--permission-mode', 'acceptEdits'];
    case 'auto':
      // Trên Windows, Claude Code chạy lệnh bằng công cụ PowerShell (ngoài Bash) – cho phép cả hai
      return ['--permission-mode', 'acceptEdits', '--allowedTools', 'Bash', 'PowerShell'];
    case 'full':
      return ['--dangerously-skip-permissions'];
  }
}

function parser() {
  return (ev: Record<string, unknown>): CliEvent[] => {
    const out: CliEvent[] = [];
    if (ev.type === 'stream_event') {
      const se = obj(ev.event);
      const delta = obj(se.delta);
      if (se.type === 'message_start') out.push({ kind: 'reset' });
      else if (se.type === 'content_block_delta' && delta.type === 'text_delta' && str(delta.text)) out.push({ kind: 'delta', text: str(delta.text) });
      return out;
    }
    if (typeof ev.session_id === 'string' && (ev.type === 'system' || ev.type === 'result')) out.push({ kind: 'session', id: ev.session_id });
    if (ev.type === 'system' && typeof ev.model === 'string') out.push({ kind: 'model', id: ev.model });
    if (ev.type === 'assistant') {
      const content = (obj(ev.message).content ?? []) as unknown[];
      for (const raw of content) {
        const block = obj(raw);
        if (block.type === 'text' && str(block.text).trim()) out.push({ kind: 'text', text: str(block.text) });
        else if (block.type === 'tool_use') out.push({ kind: 'tool', text: describeTool(str(block.name), obj(block.input)), tool: str(block.name) });
      }
    }
    if (ev.type === 'result') {
      // modelUsage (theo từng model, đã gồm cache) chính xác hơn usage tổng.
      const mu = obj(ev.modelUsage);
      const models = Object.values(mu).map(obj);
      if (models.length) {
        let input = 0;
        let output = 0;
        let cached = 0;
        for (const m of models) {
          input += num(m.inputTokens) + num(m.cacheCreationInputTokens) + num(m.cacheReadInputTokens);
          cached += num(m.cacheReadInputTokens);
          output += num(m.outputTokens);
        }
        out.push({ kind: 'usage', input, output, cached, costUsd: num(ev.total_cost_usd) });
      } else {
        const u = obj(ev.usage);
        out.push({
          kind: 'usage',
          input: num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens),
          output: num(u.output_tokens),
          cached: num(u.cache_read_input_tokens),
          costUsd: num(ev.total_cost_usd),
        });
      }
      const isError = Boolean(ev.is_error) || str(ev.subtype).startsWith('error');
      out.push({ kind: 'result', text: typeof ev.result === 'string' ? ev.result : undefined, isError });
    }
    return out;
  };
}

export const claudeAdapter: CliAdapter = {
  type: 'claude-code',
  supportsResume: true,
  unknownSession: /no conversation found with session id|session[^\n]{0,40}not found|could not resume/i,
  createParser: parser,
  apiKeyEnv: () => ['ANTHROPIC_API_KEY'],
  async build({ ctx, provider, model, prompt, resume, without }) {
    const effort = without.has('effort') ? '' : effortFor(ctx.department.effort, 'claude');
    const maxTurns = optNum(provider, 'maxTurns');
    return {
      args: [
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--include-partial-messages',
        ...permArgs(ctx.permission),
        ...(model ? ['--model', model] : []),
        ...(effort ? ['--effort', effort] : []),
        ...(maxTurns ? ['--max-turns', String(maxTurns)] : []),
        // Điều khiển trình duyệt Chrome chỉ khi nhiệm vụ toàn quyền và đã bật "Điều khiển máy tính" trong Cài đặt
        ...(opt(provider, 'chrome') && ctx.permission === 'full' && ctx.settings.computerControl ? ['--chrome'] : []),
        ...(resume ? ['--resume', resume] : []),
        ...(ctx.task.attachments?.length ? ['--add-dir', attachmentDir()] : []),
        ...(ctx.extraDirs ?? []).flatMap((d) => ['--add-dir', d]),
        ...(ctx.mcpArgs ?? []),
        ...(provider.extraArgs ?? []),
      ],
      input: resume && ctx.task.round === 0 ? 'Tiếp tục nhiệm vụ từ chỗ đã dừng và hoàn tất. Nhớ kết thúc bằng khối vp-result.' : prompt,
      env: opt(provider, 'ignoreHostApiKey') && provider.authMode !== 'api_key' ? { ANTHROPIC_API_KEY: undefined, ANTHROPIC_AUTH_TOKEN: undefined } : undefined,
    };
  },
  probe(provider: Provider, model: string) {
    return {
      args: ['-p', '--output-format', 'stream-json', '--verbose', ...(model ? ['--model', model] : [])],
      input: 'Respond with hello.',
      env: opt(provider, 'ignoreHostApiKey') && provider.authMode !== 'api_key' ? { ANTHROPIC_API_KEY: undefined, ANTHROPIC_AUTH_TOKEN: undefined } : undefined,
    };
  },
  async extraChecks(provider) {
    const checks = [];
    if (provider.authMode !== 'api_key' && process.env.ANTHROPIC_API_KEY && !opt(provider, 'ignoreHostApiKey')) {
      checks.push(
        envCheck('claude_anthropic_api_key_overrides_subscription', 'warn', sysMsg('Máy đang có biến ANTHROPIC_API_KEY – Claude Code sẽ tính phí theo API key thay vì gói đăng ký.'), {
          hint: sysMsg('Bật "Bỏ qua ANTHROPIC_API_KEY của máy" trong kết nối nếu bạn muốn dùng gói Pro/Max.'),
        }),
      );
    }
    if (process.env.CLAUDE_CODE_USE_BEDROCK || process.env.ANTHROPIC_BEDROCK_BASE_URL) {
      checks.push(envCheck('claude_bedrock_auth', 'info', sysMsg('Claude Code đang dùng Amazon Bedrock (biến CLAUDE_CODE_USE_BEDROCK).')));
    }
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      checks.push(envCheck('claude_oauth_token_configured', 'info', sysMsg('Có CLAUDE_CODE_OAUTH_TOKEN (token gói đăng ký) trong môi trường.')));
    }
    return checks;
  },
};

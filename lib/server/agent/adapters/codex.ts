// OpenAI Codex CLI: `codex exec --json`, làm tiếp bằng `exec resume <thread>`; chế độ API key dùng CODEX_HOME riêng có auth.json.
import fs from 'fs/promises';
import path from 'path';
import type { CliAdapter, CliEvent } from './types';
import { effortFor, errorText, num, obj, opt, privateDir, str } from './shared';

function parser() {
  return (ev: Record<string, unknown>): CliEvent[] => {
    const out: CliEvent[] = [];
    const item = obj(ev.item);
    const msg = obj(ev.msg);
    if (ev.type === 'thread.started' && str(ev.thread_id)) out.push({ kind: 'session', id: str(ev.thread_id) });
    if (ev.type === 'item.completed' && (item.type === 'agent_message' || /message/.test(str(item.type))) && str(item.text)) {
      out.push({ kind: 'text', text: str(item.text) });
    }
    if (ev.type === 'item.started' && item.type === 'command_execution' && str(item.command)) {
      out.push({ kind: 'tool', text: `\`$ ${str(item.command).slice(0, 200)}\``, tool: 'shell' });
    }
    if (ev.type === 'item.completed' && item.type === 'file_change') {
      const changes = (item.changes as { path?: string }[] | undefined) ?? [];
      out.push({ kind: 'tool', text: `Sửa tệp: ${changes.map((c) => `\`${c.path}\``).join(', ')}`, tool: 'file_change' });
    }
    if (ev.type === 'item.started' && item.type === 'web_search' && str(item.query)) out.push({ kind: 'tool', text: `Tìm web "${str(item.query)}"`, tool: 'web_search' });
    if (ev.type === 'item.started' && item.type === 'mcp_tool_call') out.push({ kind: 'tool', text: `${str(item.server)}.${str(item.tool)}`, tool: 'mcp' });
    // Định dạng cũ (msg.type)
    if (msg.type === 'agent_message' && str(msg.message)) out.push({ kind: 'text', text: str(msg.message) });
    if (msg.type === 'session_configured' && str(msg.session_id)) out.push({ kind: 'session', id: str(msg.session_id) });
    if (ev.type === 'turn.completed') {
      const u = obj(ev.usage);
      out.push({ kind: 'usage', input: num(u.input_tokens), output: num(u.output_tokens), cached: num(u.cached_input_tokens) });
    }
    if (ev.type === 'error' || msg.type === 'error' || ev.type === 'turn.failed') {
      const e = errorText(ev.error ?? ev.message ?? msg.message);
      out.push({ kind: 'error', message: e || 'Codex báo lỗi' });
    }
    return out;
  };
}

export const codexAdapter: CliAdapter = {
  type: 'codex',
  supportsResume: true,
  unknownSession: /no (?:conversation|session|thread|rollout) found|thread[^\n]{0,40}not found|failed to (?:resume|load) (?:session|rollout)/i,
  createParser: parser,
  apiKeyEnv: () => ['OPENAI_API_KEY', 'CODEX_API_KEY'],
  async prepareApiKeyEnv(provider) {
    // Codex đọc thông tin đăng nhập từ $CODEX_HOME/auth.json → mỗi kết nối API key có CODEX_HOME riêng.
    const home = await privateDir('codex-home', provider._id);
    await fs.writeFile(path.join(home, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: provider.apiKey }, null, 2), 'utf8');
    const cfg = path.join(home, 'config.toml');
    try {
      await fs.access(cfg);
    } catch {
      await fs.writeFile(cfg, 'cli_auth_credentials_store = "file"\n', 'utf8');
    }
    return { CODEX_HOME: home, OPENAI_API_KEY: provider.apiKey, CODEX_API_KEY: provider.apiKey };
  },
  async build({ ctx, provider, model, prompt, resume, cwd, without }) {
    const level = ctx.permission;
    const sandbox = level === 'read' ? 'read-only' : level === 'full' ? 'danger-full-access' : 'workspace-write';
    const effort = without.has('effort') ? '' : effortFor(ctx.department.effort, 'codex');
    return {
      args: [
        ...(opt(provider, 'search') ? ['--search'] : []),
        'exec',
        '--json',
        '--skip-git-repo-check',
        '-C',
        cwd,
        '--sandbox',
        sandbox,
        ...(level === 'auto' || level === 'full' ? ['-c', 'sandbox_workspace_write.network_access=true'] : []),
        ...(model ? ['-m', model] : []),
        ...(effort ? ['-c', `model_reasoning_effort=${effort}`] : []),
        ...(opt(provider, 'fastMode') ? ['-c', 'service_tier=fast'] : []),
        ...(provider.extraArgs ?? []),
        ...(resume ? ['resume', resume] : []),
        '-',
      ],
      input: resume && ctx.task.round === 0 ? 'Tiếp tục nhiệm vụ từ chỗ đã dừng và hoàn tất. Nhớ kết thúc bằng khối vp-result.' : prompt,
    };
  },
  probe(_provider, model) {
    return { args: ['exec', '--json', '--skip-git-repo-check', ...(model ? ['-m', model] : []), '-'], input: 'Respond with hello.' };
  },
};

// "Nhà cung cấp" thủ công: dùng gói đăng ký trên trình duyệt (ChatGPT, Claude.ai, Gemini, Grok…).
import type { AgentContext, AgentOutcome } from '../context';
import { buildSystemPrompt, buildTaskPrompt } from '../prompts';

export async function runManual(ctx: AgentContext): Promise<AgentOutcome> {
  const system = await buildSystemPrompt(ctx, 'manual');
  const task = await buildTaskPrompt(ctx, 'manual');
  return {
    status: 'waiting_human',
    text: `${system}\n\n---\n\n${task}`,
    summary: '',
    delegations: [],
    artifacts: [],
  };
}

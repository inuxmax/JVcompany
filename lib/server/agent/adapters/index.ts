// Danh bạ các bộ kết nối CLI theo loại kết nối.
import type { ProviderType } from '../../../types';
import type { CliAdapter } from './types';
import { claudeAdapter } from './claude';
import { codexAdapter } from './codex';
import { geminiAdapter } from './gemini';
import { cursorAdapter } from './cursor';
import { opencodeAdapter, piAdapter } from './multi';
import { copilotAdapter, customAdapter, grokAdapter, hermesAdapter, kimiAdapter, qwenAdapter } from './more';

const CLI_ADAPTERS: Partial<Record<ProviderType, CliAdapter>> = {
  'claude-code': claudeAdapter,
  codex: codexAdapter,
  'gemini-cli': geminiAdapter,
  'cursor-agent': cursorAdapter,
  opencode: opencodeAdapter,
  pi: piAdapter,
  kimi: kimiAdapter,
  grok: grokAdapter,
  hermes: hermesAdapter,
  copilot: copilotAdapter,
  'qwen-code': qwenAdapter,
  'custom-cli': customAdapter,
};

export function getCliAdapter(type: ProviderType): CliAdapter {
  return CLI_ADAPTERS[type] ?? customAdapter;
}

export type { CliAdapter, CliEvent, CliSpec, BuildInput } from './types';

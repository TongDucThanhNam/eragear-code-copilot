import type {
  SupervisorMemoryProvider,
  SupervisorToolPolicy,
  SupervisorWebSearchProvider,
} from "#runtime/config/environment";

export interface SupervisorPolicy {
  enabled: boolean;
  model: string;
  miniMaxApiKey?: string;
  decisionTimeoutMs: number;
  decisionMaxAttempts: number;
  maxRuntimeMs: number;
  maxRepeatedPrompts: number;
  customSystemPrompt?: string;
  toolPolicy: SupervisorToolPolicy;
  toolAllowlist: string[];
  /** Enable deterministic hard-deny filter for clearly disallowed permission requests. Default: true */
  hardDenyEnabled?: boolean;
  webSearchProvider: SupervisorWebSearchProvider;
  webSearchApiKey?: string;
  memoryProvider: SupervisorMemoryProvider;
  obsidianCommand: string;
  obsidianVault?: string;
  obsidianBlueprintPath?: string;
  obsidianLogPath?: string;
  obsidianSearchPath: string;
  obsidianSearchLimit: number;
  obsidianTimeoutMs: number;
}

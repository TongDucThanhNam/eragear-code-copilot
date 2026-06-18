import type { PromptEnhancementSettings } from "../contracts/prompt-enhancement.contract";

export interface PromptEnhancementStoreSnapshot {
  settingsByUserId: Readonly<Record<string, PromptEnhancementSettings>>;
}

export interface MutablePromptEnhancementStoreSnapshot {
  settingsByUserId: Record<string, PromptEnhancementSettings>;
}

export interface PromptEnhancementRepositoryPort {
  read<T>(
    reader: (snapshot: PromptEnhancementStoreSnapshot) => T | Promise<T>
  ): Promise<T>;
  mutate<T>(
    mutator: (snapshot: MutablePromptEnhancementStoreSnapshot) => T | Promise<T>
  ): Promise<T>;
}

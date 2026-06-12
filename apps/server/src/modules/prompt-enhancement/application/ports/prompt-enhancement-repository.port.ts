import type {
  PromptEnhancementSettings,
  UpdatePromptEnhancementSettingsInput,
} from "../contracts/prompt-enhancement.contract";

export interface PromptEnhancementRepositoryPort {
  getSettings(userId: string): Promise<PromptEnhancementSettings>;
  updateSettings(
    userId: string,
    input: UpdatePromptEnhancementSettingsInput
  ): Promise<PromptEnhancementSettings>;
}

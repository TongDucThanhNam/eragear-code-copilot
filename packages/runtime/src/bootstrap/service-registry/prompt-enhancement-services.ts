import { PromptEnhancementService } from "#runtime/modules/prompt-enhancement";
import { PromptEnhancementFileRepository } from "#runtime/modules/prompt-enhancement/di";
import type { PromptEnhancementUseCases } from "#runtime/modules/use-cases";
import { getStorageFileSync } from "#runtime/platform/storage/storage-path";

export function createPromptEnhancementUseCases(): PromptEnhancementUseCases {
  return {
    promptEnhancement: new PromptEnhancementService(
      new PromptEnhancementFileRepository({
        filePath: () => getStorageFileSync("prompt-enhancement-settings.json"),
      })
    ),
  };
}

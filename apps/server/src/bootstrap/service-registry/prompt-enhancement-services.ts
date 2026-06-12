import { PromptEnhancementService } from "@/modules/prompt-enhancement";
import { PromptEnhancementFileRepository } from "@/modules/prompt-enhancement/di";
import type { PromptEnhancementUseCases } from "@/modules/use-cases";
import { getStorageFileSync } from "@/platform/storage/storage-path";

export function createPromptEnhancementUseCases(): PromptEnhancementUseCases {
  return {
    promptEnhancement: new PromptEnhancementService(
      new PromptEnhancementFileRepository({
        filePath: () => getStorageFileSync("prompt-enhancement-settings.json"),
      })
    ),
  };
}

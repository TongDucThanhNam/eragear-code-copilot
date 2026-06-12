import { ModelProviderService } from "@/modules/model-provider";
import { ModelProviderFileRepository } from "@/modules/model-provider/di";
import type { ModelProviderUseCases } from "@/modules/use-cases";
import { getStorageFileSync } from "@/platform/storage/storage-path";

export function createModelProviderUseCases(): ModelProviderUseCases {
  return {
    modelProvider: new ModelProviderService(
      new ModelProviderFileRepository({
        filePath: () => getStorageFileSync("model-providers.json"),
      })
    ),
  };
}

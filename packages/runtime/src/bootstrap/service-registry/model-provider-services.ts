import { ModelProviderService } from "#runtime/modules/model-provider";
import { ModelProviderFileRepository } from "#runtime/modules/model-provider/di";
import type { ModelProviderUseCases } from "#runtime/modules/use-cases";
import { getStorageFileSync } from "#runtime/platform/storage/storage-path";

export function createModelProviderUseCases(): ModelProviderUseCases {
  return {
    modelProvider: new ModelProviderService(
      new ModelProviderFileRepository({
        filePath: () => getStorageFileSync("model-providers.json"),
      })
    ),
  };
}

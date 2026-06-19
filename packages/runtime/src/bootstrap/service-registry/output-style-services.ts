import {
  OutputStyleFileRepository,
  OutputStyleService,
} from "#runtime/modules/output-style";
import type { OutputStyleUseCases } from "#runtime/modules/use-cases";
import { getStorageFileSync } from "#runtime/platform/storage/storage-path";

export function createOutputStyleUseCases(): OutputStyleUseCases {
  return {
    outputStyle: new OutputStyleService(
      new OutputStyleFileRepository({
        filePath: () => getStorageFileSync("output-style-settings.json"),
      })
    ),
  };
}

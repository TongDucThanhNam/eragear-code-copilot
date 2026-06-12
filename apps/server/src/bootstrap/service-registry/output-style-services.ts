import {
  OutputStyleFileRepository,
  OutputStyleService,
} from "@/modules/output-style";
import type { OutputStyleUseCases } from "@/modules/use-cases";
import { getStorageFileSync } from "@/platform/storage/storage-path";

export function createOutputStyleUseCases(): OutputStyleUseCases {
  return {
    outputStyle: new OutputStyleService(
      new OutputStyleFileRepository({
        filePath: () => getStorageFileSync("output-style-settings.json"),
      })
    ),
  };
}

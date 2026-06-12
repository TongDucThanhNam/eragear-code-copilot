import { BotFileRepository, BotsService } from "@/modules/bots";
import type { BotsUseCases } from "@/modules/use-cases";
import { getStorageFileSync } from "@/platform/storage/storage-path";

export function createBotsUseCases(): BotsUseCases {
  const repository = new BotFileRepository({
    filePath: () => getStorageFileSync("bots.json"),
  });

  return {
    bots: new BotsService({ repository }),
  };
}

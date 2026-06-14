import { BotFileRepository, BotsService } from "@/modules/bots";
import type {
  AiUseCases,
  BotsUseCases,
  QuotaUseCases,
  SessionUseCases,
} from "@/modules/use-cases";
import { getStorageFileSync } from "@/platform/storage/storage-path";
import type { LoggerPort } from "@/shared/ports/logger.port";

export function createBotsUseCases(params: {
  session: SessionUseCases;
  ai: AiUseCases;
  quota: QuotaUseCases;
  logger: LoggerPort;
}): BotsUseCases {
  const repository = new BotFileRepository({
    filePath: () => getStorageFileSync("bots.json"),
  });

  return {
    bots: new BotsService({
      repository,
      createSession: params.session.create,
      sendMessage: params.ai.sendMessage,
      quotaProvider: params.quota.provider,
      logger: params.logger,
    }),
  };
}

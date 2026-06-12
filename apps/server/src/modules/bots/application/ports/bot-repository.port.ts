import type { BotDefinition, BotRun } from "../contracts/bots.contract";

export interface BotRepositoryPort {
  listBots(userId: string): Promise<BotDefinition[]>;
  getBot(userId: string, botId: string): Promise<BotDefinition | null>;
  saveBot(bot: BotDefinition): Promise<BotDefinition>;
  deleteBot(userId: string, botId: string): Promise<void>;
  listRuns(userId: string): Promise<BotRun[]>;
  getRun(userId: string, runId: string): Promise<BotRun | null>;
  saveRun(run: BotRun): Promise<BotRun>;
}

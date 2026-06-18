import type {
  BotDefinition,
  BotQuotaAutomationState,
  BotRun,
} from "../contracts/bots.contract";

export interface BotQuotaAutomationStateSnapshot {
  get(): BotQuotaAutomationState;
}

export interface MutableBotQuotaAutomationStateSnapshot
  extends BotQuotaAutomationStateSnapshot {
  set(state: BotQuotaAutomationState): void;
}

export interface BotRepositoryPort {
  listBots(userId: string): Promise<BotDefinition[]>;
  getBot(userId: string, botId: string): Promise<BotDefinition | null>;
  saveBot(bot: BotDefinition): Promise<BotDefinition>;
  deleteBot(userId: string, botId: string): Promise<void>;
  listRuns(userId: string): Promise<BotRun[]>;
  getRun(userId: string, runId: string): Promise<BotRun | null>;
  saveRun(run: BotRun): Promise<BotRun>;
  readQuotaAutomationState<T>(
    reader: (snapshot: BotQuotaAutomationStateSnapshot) => T | Promise<T>
  ): Promise<T>;
  mutateQuotaAutomationState<T>(
    mutator: (
      snapshot: MutableBotQuotaAutomationStateSnapshot
    ) => T | Promise<T>
  ): Promise<T>;
}

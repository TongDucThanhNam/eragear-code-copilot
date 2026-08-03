import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";
import type { DomainEvent } from "#runtime/shared/types/domain-events.types";
import type {
  BotDefinition,
  BotRun,
} from "../application/contracts/bots.contract";
import type {
  BotQuotaAutomationStateSnapshot,
  BotRepositoryPort,
  MutableBotQuotaAutomationStateSnapshot,
} from "../application/ports/bot-repository.port";

export class NotifyingBotRepository implements BotRepositoryPort {
  private readonly inner: BotRepositoryPort;
  private readonly eventBus: EventBusPort;
  private readonly logger: LoggerPort;
  private readonly now: () => number;

  constructor(
    inner: BotRepositoryPort,
    eventBus: EventBusPort,
    logger: LoggerPort,
    now: () => number = Date.now
  ) {
    this.inner = inner;
    this.eventBus = eventBus;
    this.logger = logger;
    this.now = now;
  }

  listBots(userId: string) {
    return this.inner.listBots(userId);
  }

  getBot(userId: string, botId: string) {
    return this.inner.getBot(userId, botId);
  }

  async saveBot(bot: BotDefinition): Promise<BotDefinition> {
    const saved = await this.inner.saveBot(bot);
    await this.publish({
      userId: saved.userId,
      botId: saved.id,
      kind: "definition",
      status: saved.enabled ? "enabled" : "disabled",
      updatedAt: saved.updatedAt,
    });
    return saved;
  }

  async deleteBot(userId: string, botId: string): Promise<void> {
    await this.inner.deleteBot(userId, botId);
    await this.publish({
      userId,
      botId,
      kind: "deleted",
      updatedAt: this.now(),
    });
  }

  listRuns(userId: string) {
    return this.inner.listRuns(userId);
  }

  getRun(userId: string, runId: string) {
    return this.inner.getRun(userId, runId);
  }

  async saveRun(run: BotRun): Promise<BotRun> {
    const saved = await this.inner.saveRun(run);
    await this.publish({
      userId: saved.userId,
      botId: saved.botId,
      runId: saved.id,
      kind: "run",
      status: saved.status,
      updatedAt:
        saved.completedAt ??
        saved.stoppedAt ??
        saved.startedAt ??
        saved.queuedAt,
    });
    return saved;
  }

  readQuotaAutomationState<T>(
    reader: (snapshot: BotQuotaAutomationStateSnapshot) => T | Promise<T>
  ): Promise<T> {
    return this.inner.readQuotaAutomationState(reader);
  }

  mutateQuotaAutomationState<T>(
    mutator: (
      snapshot: MutableBotQuotaAutomationStateSnapshot
    ) => T | Promise<T>
  ): Promise<T> {
    return this.inner.mutateQuotaAutomationState(mutator);
  }

  private async publish(
    update: Omit<
      Extract<DomainEvent, { type: "scheduled_task_updated" }>,
      "type"
    >
  ): Promise<void> {
    await this.eventBus
      .publish({ type: "scheduled_task_updated", ...update })
      .catch((error) => {
        this.logger.warn("Scheduled task update publish failed", {
          botId: update.botId,
          runId: update.runId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
}

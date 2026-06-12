import { randomUUID } from "node:crypto";
import { NotFoundError, ValidationError } from "@/shared/errors";
import type {
  BotDefinition,
  BotOrchestrationResult,
  BotRun,
  BotSystemStatus,
  BotTrigger,
  OrchestrateBotsInput,
  StartBotRunInput,
  UpsertBotDefinitionInput,
} from "./contracts/bots.contract";
import type { BotRepositoryPort } from "./ports/bot-repository.port";

const MODULE = "bots";

interface BotsServiceDeps {
  repository: BotRepositoryPort;
  now?: () => number;
  createId?: () => string;
}

export class BotsService {
  private readonly repository: BotRepositoryPort;
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(deps: BotsServiceDeps) {
    this.repository = deps.repository;
    this.now = deps.now ?? Date.now;
    this.createId = deps.createId ?? randomUUID;
  }

  async list(userId: string): Promise<BotSystemStatus> {
    const [bots, runs] = await Promise.all([
      this.repository.listBots(userId),
      this.repository.listRuns(userId),
    ]);
    return {
      bots: bots.sort((left, right) => right.updatedAt - left.updatedAt),
      runs: runs.sort((left, right) => right.queuedAt - left.queuedAt),
    };
  }

  async upsert(
    userId: string,
    input: UpsertBotDefinitionInput
  ): Promise<BotDefinition> {
    const now = this.now();
    const existing = input.id
      ? await this.repository.getBot(userId, input.id)
      : null;
    if (input.id && !existing) {
      throw new NotFoundError("Bot definition not found", {
        module: MODULE,
        op: "upsert",
        details: { botId: input.id },
      });
    }

    const bot: BotDefinition = {
      id: existing?.id ?? this.createId(),
      userId,
      name: input.name.trim(),
      description: input.description?.trim() ?? existing?.description ?? "",
      prompt: input.prompt.trim(),
      enabled: input.enabled ?? existing?.enabled ?? true,
      trigger: input.trigger ?? existing?.trigger ?? "manual",
      ...(input.agentId ? { agentId: input.agentId } : existing?.agentId ? { agentId: existing.agentId } : {}),
      ...(input.projectId ? { projectId: input.projectId } : existing?.projectId ? { projectId: existing.projectId } : {}),
      maxConcurrency: input.maxConcurrency ?? existing?.maxConcurrency ?? 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    return await this.repository.saveBot(bot);
  }

  async delete(userId: string, botId: string): Promise<void> {
    const existing = await this.repository.getBot(userId, botId);
    if (!existing) {
      throw new NotFoundError("Bot definition not found", {
        module: MODULE,
        op: "delete",
        details: { botId },
      });
    }
    await this.repository.deleteBot(userId, botId);
  }

  async startRun(userId: string, input: StartBotRunInput): Promise<BotRun> {
    const bot = await this.repository.getBot(userId, input.botId);
    if (!bot) {
      throw new NotFoundError("Bot definition not found", {
        module: MODULE,
        op: "startRun",
        details: { botId: input.botId },
      });
    }
    return await this.startBot(userId, bot, input.trigger ?? bot.trigger, input.context);
  }

  async stopRun(userId: string, runId: string): Promise<BotRun> {
    const run = await this.repository.getRun(userId, runId);
    if (!run) {
      throw new NotFoundError("Bot run not found", {
        module: MODULE,
        op: "stopRun",
        details: { runId },
      });
    }
    if (!isActiveRun(run)) {
      return run;
    }
    return await this.repository.saveRun({
      ...run,
      status: "stopped",
      stoppedAt: this.now(),
    });
  }

  async orchestrate(
    userId: string,
    input: OrchestrateBotsInput
  ): Promise<BotOrchestrationResult> {
    const bots = (await this.repository.listBots(userId)).filter(
      (bot) => bot.enabled && bot.trigger === input.trigger
    );
    const startedRuns: BotRun[] = [];
    const skippedBotIds: string[] = [];
    for (const bot of bots) {
      try {
        startedRuns.push(
          await this.startBot(userId, bot, input.trigger, input.context)
        );
      } catch (error) {
        if (error instanceof ValidationError) {
          skippedBotIds.push(bot.id);
          continue;
        }
        throw error;
      }
    }
    return {
      trigger: input.trigger,
      startedRuns,
      skippedBotIds,
    };
  }

  private async startBot(
    userId: string,
    bot: BotDefinition,
    trigger: BotTrigger,
    context?: Record<string, string>
  ): Promise<BotRun> {
    if (!bot.enabled) {
      throw new ValidationError("Bot is disabled", {
        module: MODULE,
        op: "startRun",
        details: { botId: bot.id },
      });
    }
    const runs = await this.repository.listRuns(userId);
    const activeRuns = runs.filter(
      (run) => run.botId === bot.id && isActiveRun(run)
    );
    if (activeRuns.length >= bot.maxConcurrency) {
      throw new ValidationError("Bot concurrency limit reached", {
        module: MODULE,
        op: "startRun",
        details: { botId: bot.id, maxConcurrency: bot.maxConcurrency },
      });
    }

    const now = this.now();
    const run: BotRun = {
      id: this.createId(),
      userId,
      botId: bot.id,
      trigger,
      status: "running",
      context: context ?? {},
      queuedAt: now,
      startedAt: now,
      completedAt: null,
      stoppedAt: null,
    };
    return await this.repository.saveRun(run);
  }
}

function isActiveRun(run: BotRun): boolean {
  return run.status === "queued" || run.status === "running";
}

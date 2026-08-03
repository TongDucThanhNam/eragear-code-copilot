import { describe, expect, test } from "bun:test";
import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { DomainEvent } from "#runtime/shared/types/domain-events.types";
import type {
  BotDefinition,
  BotQuotaAutomationState,
  BotRun,
} from "../application/contracts/bots.contract";
import type { BotRepositoryPort } from "../application/ports/bot-repository.port";
import { NotifyingBotRepository } from "./notifying-bot.repository";

describe("NotifyingBotRepository", () => {
  test("publishes client-safe signals without prompts, transcripts, diffs, or secrets", async () => {
    const events: DomainEvent[] = [];
    const repository = new NotifyingBotRepository(
      memoryRepository(),
      {
        publish(event) {
          events.push(event);
          return Promise.resolve();
        },
        subscribe() {
          return () => undefined;
        },
      } satisfies EventBusPort,
      {
        debug() {
          // Intentionally silent test logger.
        },
        info() {
          // Intentionally silent test logger.
        },
        warn() {
          // Intentionally silent test logger.
        },
        error() {
          // Intentionally silent test logger.
        },
      },
      () => 999
    );
    const bot = createBot();
    const run = createRun();

    await repository.saveBot(bot);
    await repository.saveRun(run);

    expect(events).toEqual([
      {
        type: "scheduled_task_updated",
        userId: "user-1",
        botId: "bot-1",
        kind: "definition",
        status: "enabled",
        updatedAt: 2,
      },
      {
        type: "scheduled_task_updated",
        userId: "user-1",
        botId: "bot-1",
        runId: "run-1",
        kind: "run",
        status: "running",
        updatedAt: 4,
      },
    ]);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(bot.objective);
    expect(serialized).not.toContain(bot.prompt);
    expect(serialized).not.toContain(run.decision?.evidenceSummary ?? "none");
    expect(serialized).not.toContain("patch");
    expect(serialized).not.toContain("api-key");
  });
});

function memoryRepository(): BotRepositoryPort {
  const bots = new Map<string, BotDefinition>();
  const runs = new Map<string, BotRun>();
  let quota: BotQuotaAutomationState = {
    windows: {},
    dispatched: {},
    cooldowns: {},
    providerLeases: {},
  };
  return {
    listBots: async () => [...bots.values()],
    getBot: async (_userId, botId) => bots.get(botId) ?? null,
    saveBot: (bot) => {
      bots.set(bot.id, bot);
      return Promise.resolve(bot);
    },
    deleteBot: (_userId, botId) => {
      bots.delete(botId);
      return Promise.resolve();
    },
    listRuns: async () => [...runs.values()],
    getRun: async (_userId, runId) => runs.get(runId) ?? null,
    saveRun: (run) => {
      runs.set(run.id, run);
      return Promise.resolve(run);
    },
    readQuotaAutomationState: async (reader) =>
      await reader({ get: () => structuredClone(quota) }),
    mutateQuotaAutomationState: async (mutator) =>
      await mutator({
        get: () => structuredClone(quota),
        set: (state) => {
          quota = structuredClone(state);
        },
      }),
  };
}

function createBot(): BotDefinition {
  return {
    id: "bot-1",
    userId: "user-1",
    name: "Secret schedule",
    description: "",
    objective: "Never expose objective",
    prompt: "Never expose raw prompt with api-key",
    workMode: "adaptive_session",
    promptStrategy: "supervisor_dynamic",
    providerId: "zai-coding-plan",
    enabled: true,
    trigger: "quota_refresh",
    agentId: "opencode",
    projectId: "project-1",
    maxConcurrency: 1,
    execution: { target: "new_session" },
    createdAt: 1,
    updatedAt: 2,
  };
}

function createRun(): BotRun {
  return {
    id: "run-1",
    userId: "user-1",
    botId: "bot-1",
    trigger: "quota_refresh",
    status: "running",
    context: {},
    decision: {
      action: "dispatch",
      rationale: "Bounded rationale",
      evidenceSummary: "Never expose raw transcript or diff patch body",
      decidedAt: 3,
    },
    completionState: "pending",
    queuedAt: 3,
    startedAt: 4,
    completedAt: null,
    stoppedAt: null,
  };
}

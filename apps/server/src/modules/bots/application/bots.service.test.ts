import { describe, expect, it } from "bun:test";
import { AppError } from "@/shared/errors";
import { BotsService } from "./bots.service";
import type {
  BotDefinition,
  BotQuotaAutomationState,
  BotRun,
} from "./contracts/bots.contract";
import type { BotRepositoryPort } from "./ports/bot-repository.port";

class MemoryBotRepository implements BotRepositoryPort {
  bots = new Map<string, BotDefinition>();
  runs = new Map<string, BotRun>();
  quotaAutomation: BotQuotaAutomationState = {
    windows: {},
    dispatched: {},
    cooldowns: {},
  };

  listBots(userId: string): Promise<BotDefinition[]> {
    return Promise.resolve(
      Array.from(this.bots.values()).filter((bot) => bot.userId === userId)
    );
  }

  getBot(userId: string, botId: string): Promise<BotDefinition | null> {
    const bot = this.bots.get(botId);
    return Promise.resolve(bot?.userId === userId ? bot : null);
  }

  saveBot(bot: BotDefinition): Promise<BotDefinition> {
    this.bots.set(bot.id, bot);
    return Promise.resolve(bot);
  }

  deleteBot(userId: string, botId: string): Promise<void> {
    const bot = this.bots.get(botId);
    if (bot?.userId === userId) {
      this.bots.delete(botId);
      for (const run of this.runs.values()) {
        if (run.userId === userId && run.botId === botId) {
          this.runs.delete(run.id);
        }
      }
    }
    return Promise.resolve();
  }

  listRuns(userId: string): Promise<BotRun[]> {
    return Promise.resolve(
      Array.from(this.runs.values()).filter((run) => run.userId === userId)
    );
  }

  getRun(userId: string, runId: string): Promise<BotRun | null> {
    const run = this.runs.get(runId);
    return Promise.resolve(run?.userId === userId ? run : null);
  }

  saveRun(run: BotRun): Promise<BotRun> {
    this.runs.set(run.id, run);
    return Promise.resolve(run);
  }

  readQuotaAutomationState(): Promise<BotQuotaAutomationState> {
    return Promise.resolve(structuredClone(this.quotaAutomation));
  }

  saveQuotaAutomationState(state: BotQuotaAutomationState): Promise<void> {
    this.quotaAutomation = structuredClone(state);
    return Promise.resolve();
  }
}

describe("BotsService", () => {
  it("creates bot definitions and starts manual runs", async () => {
    let ids = 0;
    const service = new BotsService({
      repository: new MemoryBotRepository(),
      now: () => 1000,
      createId: () => `id-${++ids}`,
    });

    const bot = await service.upsert("user-1", {
      name: "Quota watcher",
      prompt: "Run queued quota work",
      trigger: "quota_refresh",
    });
    const run = await service.startRun("user-1", { botId: bot.id });

    expect(bot.enabled).toBe(true);
    expect(run.status).toBe("queued");
    expect(run.trigger).toBe("quota_refresh");
  });

  it("orchestrates enabled bots by trigger and respects concurrency", async () => {
    let ids = 0;
    const service = new BotsService({
      repository: new MemoryBotRepository(),
      now: () => 2000,
      createId: () => `id-${++ids}`,
    });
    const bot = await service.upsert("user-1", {
      name: "Queue runner",
      prompt: "Pick next queued task",
      trigger: "quota_refresh",
      maxConcurrency: 1,
    });
    await service.upsert("user-1", {
      name: "Manual bot",
      prompt: "Manual only",
      trigger: "manual",
    });

    const first = await service.orchestrate("user-1", {
      trigger: "quota_refresh",
      context: { providerId: "openai" },
    });
    const second = await service.orchestrate("user-1", {
      trigger: "quota_refresh",
    });

    expect(first.startedRuns).toHaveLength(1);
    expect(first.startedRuns[0]?.botId).toBe(bot.id);
    expect(first.startedRuns[0]?.context.providerId).toBe("openai");
    expect(second.startedRuns).toHaveLength(0);
    expect(second.skippedBotIds).toEqual([bot.id]);
  });

  it("stops active runs and scopes state by user", async () => {
    let ids = 0;
    let now = 3000;
    const repository = new MemoryBotRepository();
    const service = new BotsService({
      repository,
      now: () => now,
      createId: () => `id-${++ids}`,
    });
    const bot = await service.upsert("user-1", {
      name: "Remote bot",
      prompt: "React to remote control",
      trigger: "remote_control",
    });
    const run = await service.startRun("user-1", { botId: bot.id });
    now = 4000;

    const stopped = await service.stopRun("user-1", run.id);
    const otherStatus = await service.list("user-2");

    expect(stopped.status).toBe("stopped");
    expect(stopped.stoppedAt).toBe(4000);
    expect(otherStatus.bots).toEqual([]);
    expect(otherStatus.runs).toEqual([]);
    await expect(service.stopRun("user-2", run.id)).rejects.toThrow();
  });

  it("dispatches due quota reset bots once and completes runs from lifecycle", async () => {
    let ids = 0;
    const now = 2000;
    const repository = new MemoryBotRepository();
    const service = new BotsService({
      repository,
      now: () => now,
      createId: () => `id-${++ids}`,
      createSession: {
        execute: async () =>
          ({
            id: "chat-quota",
            sessionId: "agent-session-1",
          }) as never,
      },
      sendMessage: {
        execute: async () => ({ turnId: "turn-quota" }),
      },
      quotaProvider: {
        refresh: async () => ({
          checkedAt: new Date(now).toISOString(),
          providers: [
            {
              providerId: "zai",
              displayName: "Z.ai Coding Plan",
              status: "ready",
              windows: [
                {
                  id: "5h",
                  label: "5h",
                  percentRemaining: 80,
                  resetAt: new Date(now + 18_000_000).toISOString(),
                },
              ],
            },
          ],
        }),
      },
    });
    await service.upsert("user-1", {
      name: "Quota runner",
      prompt: "Run quota work",
      trigger: "quota_refresh",
      projectId: "project-1",
      triggerConfig: {
        quota: {
          providerIds: ["zai"],
          windowIds: ["5h"],
          minPercentRemaining: 10,
          cooldownMs: 300_000,
        },
      },
    });
    await service.recordQuotaSnapshot({
      type: "provider_quota_refreshed",
      userId: "user-1",
      providerId: "zai",
      providerDisplayName: "Z.ai Coding Plan",
      status: "ready",
      fetchedAt: new Date(now - 1000).toISOString(),
      windows: [
        {
          id: "5h",
          label: "5h",
          resetAt: new Date(now).toISOString(),
          percentRemaining: 0,
        },
      ],
      changed: true,
    });

    const first = await service.dispatchDueQuotaResets({
      userIds: ["user-1"],
      now: new Date(now).toISOString(),
    });
    const second = await service.dispatchDueQuotaResets({
      userIds: ["user-1"],
      now: new Date(now).toISOString(),
    });
    const runningRun = (await service.list("user-1")).runs[0];

    expect(first.dispatchedRuns).toBe(1);
    expect(second.dispatchedRuns).toBe(0);
    expect(runningRun).toMatchObject({
      status: "running",
      chatId: "chat-quota",
      turnId: "turn-quota",
      agentSessionId: "agent-session-1",
      triggerContext: {
        providerId: "zai",
        windowId: "5h",
      },
    });

    await service.completeRunsForTurn({
      type: "local_ade_lifecycle",
      event: "after-agent-turn-complete",
      userId: "user-1",
      projectRoot: "/repo",
      chatId: "chat-quota",
      turnId: "turn-quota",
      stopReason: "end_turn",
    });

    expect((await service.list("user-1")).runs[0]?.status).toBe("completed");
  });

  it("keeps queue-only quota dispatches queued", async () => {
    let ids = 0;
    const now = 5000;
    const service = new BotsService({
      repository: new MemoryBotRepository(),
      now: () => now,
      createId: () => `id-${++ids}`,
      quotaProvider: {
        refresh: async () => ({
          checkedAt: new Date(now).toISOString(),
          providers: [
            {
              providerId: "openai",
              displayName: "OpenAI / ChatGPT",
              status: "ready",
              windows: [
                {
                  id: "primary",
                  label: "Primary",
                  percentRemaining: 50,
                },
              ],
            },
          ],
        }),
      },
    });
    await service.upsert("user-1", {
      name: "Queue only",
      prompt: "Wait for manual run",
      trigger: "quota_refresh",
      execution: { target: "queue_only" },
    });
    await service.recordQuotaSnapshot({
      type: "provider_quota_refreshed",
      userId: "user-1",
      providerId: "openai",
      providerDisplayName: "OpenAI / ChatGPT",
      status: "ready",
      fetchedAt: new Date(now - 1000).toISOString(),
      windows: [
        {
          id: "primary",
          label: "Primary",
          resetAt: new Date(now).toISOString(),
        },
      ],
      changed: true,
    });

    const result = await service.dispatchDueQuotaResets({
      userIds: ["user-1"],
      now: new Date(now).toISOString(),
    });

    expect(result.dispatchedRuns).toBe(1);
    expect((await service.list("user-1")).runs[0]?.status).toBe("queued");
  });

  it("keeps busy existing-session runs queued for retry", async () => {
    const repository = new MemoryBotRepository();
    const service = new BotsService({
      repository,
      now: () => 10_000,
      createSession: {
        execute: () =>
          Promise.reject(new Error("should not create a new session")),
      },
      sendMessage: {
        execute: () =>
          Promise.reject(
            new AppError({
              message: "A prompt is already in progress for this session",
              code: "PROMPT_BUSY",
            })
          ),
      },
    });
    await repository.saveBot({
      id: "bot-1",
      userId: "user-1",
      name: "Existing",
      description: "",
      prompt: "Run in current chat",
      enabled: true,
      trigger: "quota_refresh",
      maxConcurrency: 1,
      execution: { target: "existing_session", chatId: "chat-1" },
      createdAt: 1,
      updatedAt: 1,
    });
    await repository.saveRun({
      id: "run-1",
      userId: "user-1",
      botId: "bot-1",
      trigger: "quota_refresh",
      status: "queued",
      context: {},
      queuedAt: 1,
      startedAt: null,
      completedAt: null,
      stoppedAt: null,
    });

    const run = await service.executeRun("user-1", "run-1");

    expect(run.status).toBe("queued");
    expect(run.nextAttemptAt).toBe(310_000);
    expect(run.error).toContain("prompt is already in progress");
  });
});

import { describe, expect, it } from "bun:test";
import { AppError } from "#runtime/shared/errors";
import { BotsService } from "./bots.service";
import type {
  BotDefinition,
  BotQuotaAutomationState,
  BotRun,
} from "./contracts/bots.contract";
import type {
  BotQuotaAutomationStateSnapshot,
  BotRepositoryPort,
  MutableBotQuotaAutomationStateSnapshot,
} from "./ports/bot-repository.port";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

class MemoryBotRepository implements BotRepositoryPort {
  bots = new Map<string, BotDefinition>();
  runs = new Map<string, BotRun>();
  quotaAutomation: BotQuotaAutomationState = {
    windows: {},
    dispatched: {},
    cooldowns: {},
    providerLeases: {},
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

  async readQuotaAutomationState<T>(
    reader: (snapshot: BotQuotaAutomationStateSnapshot) => T | Promise<T>
  ): Promise<T> {
    return await reader({
      get: () => structuredClone(this.quotaAutomation),
    });
  }

  async mutateQuotaAutomationState<T>(
    mutator: (
      snapshot: MutableBotQuotaAutomationStateSnapshot
    ) => T | Promise<T>
  ): Promise<T> {
    let changed = false;
    let next = structuredClone(this.quotaAutomation);
    const result = await mutator({
      get: () => structuredClone(next),
      set: (state) => {
        changed = true;
        next = structuredClone(state);
      },
    });
    if (changed) {
      this.quotaAutomation = structuredClone(next);
    }
    return result;
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
    const edited = await service.upsert("user-1", {
      id: bot.id,
      name: "Quota watcher renamed",
      objective: bot.objective,
      prompt: bot.prompt,
      promptStrategy: "fixed",
      workMode: "adaptive_session",
    });

    expect(bot.enabled).toBe(true);
    expect(edited.name).toBe("Quota watcher renamed");
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
      userId: "user-1",
      providerId: "zai",
      providerDisplayName: "Z.ai Coding Plan",
      status: "ready",
      windows: [
        {
          id: "5h",
          label: "5h",
          resetAt: new Date(now).toISOString(),
          percentRemaining: 0,
        },
      ],
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
      userId: "user-1",
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
      userId: "user-1",
      providerId: "openai",
      providerDisplayName: "OpenAI / ChatGPT",
      status: "ready",
      windows: [
        {
          id: "primary",
          label: "Primary",
          resetAt: new Date(now).toISOString(),
        },
      ],
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
      objective: "Run in current chat",
      prompt: "Run in current chat",
      workMode: "adaptive_session",
      promptStrategy: "fixed",
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
      completionState: "pending",
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

  it("creates a compatible adaptive session and stores only bounded decision evidence", async () => {
    let ids = 0;
    const repository = new MemoryBotRepository();
    const submitted: Array<{
      userId: string;
      chatId: string;
      text: string;
      source: string;
    }> = [];
    const service = new BotsService({
      repository,
      now: () => 20_000,
      createId: () => `id-${++ids}`,
      quotaProvider: readyScheduledQuota(20_000),
      projectStore: {
        findById: async () => ({ id: "project-1", path: "C:/repo" }),
      },
      scheduledDecision: {
        execute: async () => ({
          action: "dispatch",
          prompt: "Inspect fresh state and finish the next migration slice.",
          rationale:
            "One incomplete slice remains. API_KEY=supersecret123456789",
          evidenceSummary:
            "Project index is incomplete. Authorization: Bearer secret-token-123456789",
          decidedAt: 20_000,
        }),
      },
      createSession: {
        execute: async () =>
          ({
            id: "chat-new",
            sessionId: "agent-session-new",
            models: compatibleModels(),
          }) as never,
      },
      sendMessage: {
        execute: (input) => {
          submitted.push(input);
          return Promise.resolve({ turnId: "turn-new" });
        },
      },
    });
    const bot = await service.upsert("user-1", {
      name: "Migration schedule",
      objective: "Complete the Electron migration",
      providerId: "zai-coding-plan",
      projectId: "project-1",
      agentId: "opencode",
      modelId: "glm-zai",
      triggerConfig: scheduledQuotaConfig(),
    });

    const run = await service.runNowIfEligible("user-1", bot.id);
    const savedBot = await repository.getBot("user-1", bot.id);

    expect(run).toMatchObject({
      status: "running",
      chatId: "chat-new",
      turnId: "turn-new",
      agentSessionId: "agent-session-new",
      providerId: "zai-coding-plan",
      decision: {
        action: "dispatch",
        rationale: "One incomplete slice remains. API_KEY=[redacted]",
        evidenceSummary:
          "Project index is incomplete. Authorization: [redacted]",
      },
    });
    expect(run.promptHash).toMatch(SHA256_PATTERN);
    expect(JSON.stringify(run)).not.toContain(
      "Inspect fresh state and finish the next migration slice."
    );
    expect(JSON.stringify(run)).not.toContain("supersecret123456789");
    expect(JSON.stringify(run)).not.toContain("secret-token-123456789");
    expect(savedBot?.execution).toEqual({
      target: "existing_session",
      chatId: "chat-new",
    });
    expect(submitted).toEqual([
      {
        userId: "user-1",
        chatId: "chat-new",
        text: "Inspect fresh state and finish the next migration slice.",
        source: "scheduled",
      },
    ]);
  });

  it("resumes a stopped compatible binding without creating a replacement", async () => {
    let ids = 0;
    let resumed = 0;
    const repository = new MemoryBotRepository();
    const service = new BotsService({
      repository,
      now: () => 30_000,
      createId: () => `id-${++ids}`,
      quotaProvider: readyScheduledQuota(30_000),
      projectStore: {
        findById: async () => ({ id: "project-1", path: "C:/repo" }),
      },
      scheduledDecision: {
        execute: async () => ({
          action: "dispatch",
          prompt: "Continue from fresh evidence.",
          rationale: "Work remains.",
          evidenceSummary: "The bound session is stopped.",
          decidedAt: 30_000,
        }),
      },
      sessionStore: {
        findById: async () => ({
          id: "chat-stopped",
          userId: "user-1",
          projectId: "project-1",
          agentId: "opencode",
          status: "stopped",
          models: compatibleModels(),
        }),
      },
      resumeSession: {
        execute: () => {
          resumed += 1;
          return Promise.resolve({
            chatId: "chat-stopped",
            models: compatibleModels(),
          });
        },
      },
      createSession: {
        execute: () => Promise.reject(new Error("must not create")),
      },
      sendMessage: {
        execute: async () => ({ turnId: "turn-resumed" }),
      },
    });
    const bot = await service.upsert("user-1", {
      name: "Resume schedule",
      objective: "Continue the objective",
      providerId: "zai-coding-plan",
      projectId: "project-1",
      agentId: "opencode",
      modelId: "glm-zai",
      execution: { target: "existing_session", chatId: "chat-stopped" },
      triggerConfig: scheduledQuotaConfig(),
    });

    const run = await service.runNowIfEligible("user-1", bot.id);

    expect(resumed).toBe(1);
    expect(run).toMatchObject({
      status: "running",
      chatId: "chat-stopped",
      turnId: "turn-resumed",
    });
  });

  it("replaces a deleted binding and rejects a provider/model mismatch", async () => {
    let ids = 0;
    let created = 0;
    const stopped: string[] = [];
    const repository = new MemoryBotRepository();
    const service = new BotsService({
      repository,
      now: () => 40_000,
      createId: () => `id-${++ids}`,
      quotaProvider: readyScheduledQuota(40_000),
      projectStore: {
        findById: async () => ({ id: "project-1", path: "C:/repo" }),
      },
      scheduledDecision: {
        execute: async () => ({
          action: "dispatch",
          prompt: "Continue safely.",
          rationale: "Work remains.",
          evidenceSummary: "Fresh project evidence was loaded.",
          decidedAt: 40_000,
        }),
      },
      sessionStore: { findById: async () => undefined },
      createSession: {
        execute: () => {
          created += 1;
          return Promise.resolve({
            id: `chat-${created}`,
            models:
              created === 1
                ? compatibleModels()
                : {
                    currentModelId: "claude",
                    availableModels: [
                      {
                        modelId: "claude",
                        name: "Claude",
                        provider: "anthropic",
                      },
                    ],
                  },
          } as never);
        },
      },
      stopSession: {
        execute: (_userId, chatId) => {
          stopped.push(chatId);
          return Promise.resolve();
        },
      },
      sendMessage: {
        execute: async () => ({ turnId: "turn-created" }),
      },
    });
    const replacement = await service.upsert("user-1", {
      name: "Replacement schedule",
      objective: "Replace missing binding",
      providerId: "zai-coding-plan",
      projectId: "project-1",
      agentId: "opencode",
      modelId: "glm-zai",
      execution: { target: "existing_session", chatId: "chat-deleted" },
      triggerConfig: scheduledQuotaConfig(),
    });
    expect(
      await service.runNowIfEligible("user-1", replacement.id)
    ).toMatchObject({ status: "running", chatId: "chat-1" });
    await service.completeRunsForTurn({
      userId: "user-1",
      chatId: "chat-1",
      turnId: "turn-created",
      stopReason: "end_turn",
    });

    const mismatch = await service.upsert("user-1", {
      name: "Mismatch schedule",
      objective: "Reject incompatible provider",
      providerId: "zai-coding-plan",
      projectId: "project-1",
      agentId: "opencode",
      modelId: "claude",
      triggerConfig: scheduledQuotaConfig(),
    });
    expect(await service.runNowIfEligible("user-1", mismatch.id)).toMatchObject(
      {
        status: "failed",
        failureReason:
          "ACP model claude is not compatible with provider zai-coding-plan.",
      }
    );
    expect(stopped).toEqual(["chat-2"]);
    expect(await repository.getBot("user-1", mismatch.id)).toMatchObject({
      execution: { target: "new_session" },
    });
  });

  it("enforces task_queue when quota infrastructure is unavailable", async () => {
    const service = new BotsService({
      repository: new MemoryBotRepository(),
      entitlement: {
        checkFeature: async () => ({
          enabled: false,
          reason: "Task queue requires an upgrade.",
        }),
      },
    });

    await expect(
      service.upsert("user-1", {
        name: "Denied schedule",
        prompt: "Do work",
        trigger: "manual",
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Task queue requires an upgrade.",
    });
  });

  it("keeps a Supervisor run quota-blocked at worker admission and resumes scheduling later", async () => {
    let ids = 0;
    let refreshes = 0;
    let starts = 0;
    let schedules = 0;
    const repository = new MemoryBotRepository();
    let service!: BotsService;
    const supervisorOrchestrator = {
      start: async (input: {
        userId: string;
        scheduleId?: string;
        providerId?: string;
      }) => {
        starts += 1;
        await service.admitSupervisorWorker({
          userId: input.userId,
          runId: "supervisor-run-1",
          scheduleId: input.scheduleId ?? "",
          providerId: input.providerId ?? "",
          taskId: "task-1",
        });
        return { runId: "supervisor-run-1", status: "queued" };
      },
      get: async () => ({ runId: "supervisor-run-1", status: "queued" }),
      resume: async () => ({
        runId: "supervisor-run-1",
        status: "running",
      }),
      schedule: async (_runId: string, userId: string) => {
        schedules += 1;
        await service.admitSupervisorWorker({
          userId,
          runId: "supervisor-run-1",
          scheduleId: "id-1",
          providerId: "zai-coding-plan",
          taskId: "task-1",
        });
        return { runId: "supervisor-run-1", status: "running" };
      },
      cancel: async () => ({
        runId: "supervisor-run-1",
        status: "cancelled",
      }),
    };
    service = new BotsService({
      repository,
      now: () => 50_000,
      createId: () => `id-${++ids}`,
      quotaProvider: {
        refresh: () => {
          refreshes += 1;
          const blocked = refreshes === 2;
          return Promise.resolve({
            checkedAt: new Date(50_000).toISOString(),
            providers: [
              {
                providerId: "zai-coding-plan",
                displayName: "Z.AI Coding Plan",
                status: "ready" as const,
                fetchedAt: new Date(50_000).toISOString(),
                windows: [
                  {
                    id: "five-hour",
                    label: "Five hour",
                    percentRemaining: blocked ? 0 : 80,
                    resetAt: new Date(110_000).toISOString(),
                  },
                ],
              },
            ],
          });
        },
      },
      projectStore: {
        findById: async () => ({ id: "project-1", path: "C:/repo" }),
      },
      scheduledDecision: {
        execute: async () => ({
          action: "dispatch",
          prompt: "Plan and execute the next bounded slice.",
          rationale: "The objective remains incomplete.",
          evidenceSummary: "Fresh scope evidence identifies ready work.",
          decidedAt: 50_000,
        }),
      },
      supervisorOrchestrator,
    });
    const bot = await service.upsert("user-1", {
      name: "Full Supervisor schedule",
      objective: "Finish the whole objective",
      workMode: "supervisor_run",
      providerId: "zai-coding-plan",
      projectId: "project-1",
      agentId: "opencode",
      modelId: "glm-zai",
      triggerConfig: scheduledQuotaConfig(),
    });

    const blocked = await service.runNowIfEligible("user-1", bot.id);
    expect(blocked).toMatchObject({
      status: "quota_blocked",
      supervisorRunId: "supervisor-run-1",
      admission: { status: "below_reserve" },
    });

    const resumed = await service.retryRun("user-1", blocked.id);
    expect(resumed).toMatchObject({
      status: "running",
      supervisorRunId: "supervisor-run-1",
      admission: { status: "eligible" },
      context: { source: "retry", retryOfRunId: blocked.id },
    });
    expect(resumed.id).not.toBe(blocked.id);
    expect(await repository.getRun("user-1", blocked.id)).toMatchObject({
      status: "stopped",
      admission: { status: "below_reserve" },
    });
    expect(starts).toBe(1);
    expect(schedules).toBe(1);
  });
});

function compatibleModels() {
  return {
    currentModelId: "glm-zai",
    availableModels: [
      {
        modelId: "glm-zai",
        name: "GLM Coding Plan",
        provider: "zai-coding-plan",
      },
    ],
  };
}

function scheduledQuotaConfig() {
  return {
    quota: {
      providerIds: ["zai-coding-plan"],
      windowIds: ["five-hour"],
      minPercentRemaining: 20,
      cooldownMs: 300_000,
    },
  };
}

function readyScheduledQuota(now: number) {
  return {
    refresh: async () => ({
      checkedAt: new Date(now).toISOString(),
      providers: [
        {
          providerId: "zai-coding-plan",
          displayName: "Z.AI Coding Plan",
          status: "ready" as const,
          fetchedAt: new Date(now).toISOString(),
          windows: [
            {
              id: "five-hour",
              label: "Five hour",
              percentRemaining: 80,
              resetAt: new Date(now + 3_600_000).toISOString(),
            },
          ],
        },
      ],
    }),
  };
}

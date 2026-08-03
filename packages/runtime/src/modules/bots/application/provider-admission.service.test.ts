import { describe, expect, it } from "bun:test";
import type { QuotaWindow } from "#runtime/modules/quota";
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
import { ProviderAdmissionService } from "./provider-admission.service";

class AdmissionRepository implements BotRepositoryPort {
  bots = new Map<string, BotDefinition>();
  runs = new Map<string, BotRun>();
  quota: BotQuotaAutomationState = {
    windows: {},
    dispatched: {},
    cooldowns: {},
    providerLeases: {},
  };

  listBots(userId: string) {
    return Promise.resolve(
      [...this.bots.values()].filter((bot) => bot.userId === userId)
    );
  }

  getBot(userId: string, botId: string) {
    const bot = this.bots.get(botId);
    return Promise.resolve(bot?.userId === userId ? bot : null);
  }

  saveBot(bot: BotDefinition) {
    this.bots.set(bot.id, bot);
    return Promise.resolve(bot);
  }

  deleteBot(_userId: string, botId: string) {
    this.bots.delete(botId);
    return Promise.resolve();
  }

  listRuns(userId: string) {
    return Promise.resolve(
      [...this.runs.values()].filter((run) => run.userId === userId)
    );
  }

  getRun(userId: string, runId: string) {
    const run = this.runs.get(runId);
    return Promise.resolve(run?.userId === userId ? run : null);
  }

  saveRun(run: BotRun) {
    this.runs.set(run.id, run);
    return Promise.resolve(run);
  }

  async readQuotaAutomationState<T>(
    reader: (snapshot: BotQuotaAutomationStateSnapshot) => T | Promise<T>
  ): Promise<T> {
    return await reader({ get: () => structuredClone(this.quota) });
  }

  async mutateQuotaAutomationState<T>(
    mutator: (
      snapshot: MutableBotQuotaAutomationStateSnapshot
    ) => T | Promise<T>
  ): Promise<T> {
    let next = structuredClone(this.quota);
    const result = await mutator({
      get: () => structuredClone(next),
      set: (state) => {
        next = structuredClone(state);
      },
    });
    this.quota = next;
    return result;
  }
}

const NOW = Date.parse("2026-07-24T00:00:00.000Z");

function createBot(id = "bot-1"): BotDefinition {
  return {
    id,
    userId: "user-1",
    name: "Scheduled task",
    description: "",
    objective: "Finish the migration",
    prompt: "",
    workMode: "adaptive_session",
    promptStrategy: "supervisor_dynamic",
    providerId: "zai-coding-plan",
    enabled: true,
    trigger: "quota_refresh",
    agentId: "opencode",
    projectId: "project-1",
    maxConcurrency: 1,
    triggerConfig: {
      quota: {
        providerIds: ["zai-coding-plan"],
        windowIds: ["five-hour"],
        minPercentRemaining: 25,
        minRemaining: 10,
        cooldownMs: 300_000,
      },
    },
    execution: { target: "new_session" },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function createRun(id: string, status: BotRun["status"] = "queued"): BotRun {
  return {
    id,
    userId: "user-1",
    botId: "bot-1",
    trigger: "quota_refresh",
    status,
    completionState: "pending",
    context: {},
    queuedAt: NOW,
    startedAt: null,
    completedAt: null,
    stoppedAt: null,
  };
}

function readyQuota(
  overrides: Partial<QuotaWindow> = {},
  fetchedAt = new Date(NOW).toISOString()
) {
  return {
    checkedAt: fetchedAt,
    providers: [
      {
        providerId: "zai-coding-plan",
        displayName: "Z.AI Coding Plan",
        status: "ready" as const,
        fetchedAt,
        windows: [
          {
            id: "five-hour",
            label: "Five hour",
            percentRemaining: 75,
            remaining: 50,
            resetAt: new Date(NOW + 3_600_000).toISOString(),
            ...overrides,
          },
        ],
      },
    ],
  };
}

describe("ProviderAdmissionService", () => {
  it("acquires one durable provider lease and blocks concurrent dispatch", async () => {
    const repository = new AdmissionRepository();
    let ids = 0;
    let currentNow = NOW;
    const service = new ProviderAdmissionService({
      repository,
      quota: {
        refresh: async () => readyQuota({}, new Date(currentNow).toISOString()),
      },
      now: () => currentNow,
      createId: () => `lease-${++ids}`,
    });

    const first = await service.admit({
      userId: "user-1",
      bot: createBot(),
      runId: "run-1",
    });
    const second = await service.admit({
      userId: "user-1",
      bot: createBot("bot-2"),
      runId: "run-2",
    });

    expect(first).toMatchObject({
      eligible: true,
      admission: {
        status: "eligible",
        providerId: "zai-coding-plan",
        windowId: "five-hour",
      },
    });
    expect(second).toMatchObject({
      eligible: false,
      admission: { status: "provider_busy" },
    });

    currentNow += 5 * 60 * 60 * 1000;
    expect(
      await service.admit({
        userId: "user-1",
        bot: createBot("bot-2"),
        runId: "run-2",
      })
    ).toMatchObject({
      eligible: false,
      admission: { status: "provider_busy" },
    });

    await service.release({ userId: "user-1", runId: "run-1" });
    expect(
      await service.admit({
        userId: "user-1",
        bot: createBot("bot-2"),
        runId: "run-2",
      })
    ).toMatchObject({ eligible: true });
  });

  it("fails closed for stale, insufficient, unavailable, and unentitled quota", async () => {
    const cases = [
      {
        expected: "quota_stale" as const,
        quota: readyQuota({}, new Date(NOW - 121_000).toISOString()),
      },
      {
        expected: "below_reserve" as const,
        quota: readyQuota({ percentRemaining: 24, remaining: 9 }),
      },
      {
        expected: "quota_unavailable" as const,
        quota: {
          checkedAt: new Date(NOW).toISOString(),
          providers: [
            {
              providerId: "zai-coding-plan",
              displayName: "Z.AI Coding Plan",
              status: "not_configured" as const,
              windows: [],
            },
          ],
        },
      },
    ];

    for (const testCase of cases) {
      const service = new ProviderAdmissionService({
        repository: new AdmissionRepository(),
        quota: { refresh: async () => testCase.quota },
        now: () => NOW,
        createId: () => "lease-1",
      });
      const result = await service.admit({
        userId: "user-1",
        bot: createBot(),
        runId: "run-1",
      });
      expect(result.admission.status).toBe(testCase.expected);
      expect(result.eligible).toBe(false);
    }

    const unentitled = new ProviderAdmissionService({
      repository: new AdmissionRepository(),
      quota: { refresh: async () => readyQuota() },
      entitlement: {
        checkFeature: async () => ({
          enabled: false,
          reason: "Upgrade required.",
        }),
      },
      now: () => NOW,
      createId: () => "lease-1",
    });
    await expect(unentitled.assertEntitled("user-1")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Upgrade required.",
    });
    expect(
      await unentitled.admit({
        userId: "user-1",
        bot: createBot(),
        runId: "run-1",
      })
    ).toMatchObject({
      eligible: false,
      admission: { status: "entitlement_required" },
    });
  });

  it("reconciles expired leases and leases without active runs", async () => {
    const repository = new AdmissionRepository();
    repository.runs.set("run-active", createRun("run-active", "running"));
    repository.quota.providerLeases = {
      "user-1|zai-coding-plan": {
        leaseId: "active",
        userId: "user-1",
        providerId: "zai-coding-plan",
        botId: "bot-1",
        runId: "run-active",
        acquiredAt: NOW - 1000,
        expiresAt: NOW + 10_000,
      },
      "user-1|minimax-coding-plan": {
        leaseId: "orphan",
        userId: "user-1",
        providerId: "minimax-coding-plan",
        botId: "bot-2",
        runId: "run-missing",
        acquiredAt: NOW - 1000,
        expiresAt: NOW + 10_000,
      },
      "user-2|zai-coding-plan": {
        leaseId: "expired",
        userId: "user-2",
        providerId: "zai-coding-plan",
        botId: "bot-3",
        runId: "run-other",
        acquiredAt: NOW - 20_000,
        expiresAt: NOW - 1,
      },
    };
    const service = new ProviderAdmissionService({
      repository,
      quota: { refresh: async () => readyQuota() },
      now: () => NOW,
      createId: () => "unused",
    });

    await expect(service.reconcile({ userIds: ["user-1"] })).resolves.toBe(2);
    expect(Object.values(repository.quota.providerLeases)).toEqual([
      expect.objectContaining({ leaseId: "active" }),
    ]);
  });
});

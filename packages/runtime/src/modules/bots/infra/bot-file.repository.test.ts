import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  BotDefinition,
  BotQuotaAutomationState,
  BotRun,
} from "../application/contracts/bots.contract";
import { BotFileRepository } from "./bot-file.repository";

describe("BotFileRepository", () => {
  it("persists quota automation state through the snapshot seam", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bots-"));
    const filePath = path.join(root, "bots.json");
    const repository = new BotFileRepository({ filePath });

    try {
      const state = createQuotaAutomationState();

      await repository.mutateQuotaAutomationState((snapshot) => {
        snapshot.set(state);
      });

      const loaded = await repository.readQuotaAutomationState((snapshot) =>
        snapshot.get()
      );
      expect(loaded).toEqual(state);

      const originalWindow =
        loaded.windows["user-1|openai|daily|2026-06-17T00:00:00.000Z"];
      expect(originalWindow).toBeDefined();
      if (!originalWindow) {
        throw new Error("Expected persisted quota automation window");
      }
      loaded.windows["user-1|openai|daily|2026-06-18T00:00:00.000Z"] = {
        ...originalWindow,
        resetAt: "2026-06-18T00:00:00.000Z",
      };

      await expect(
        repository.readQuotaAutomationState((snapshot) => snapshot.get())
      ).resolves.toEqual(state);
      await expect(readPersistedVersion(filePath)).resolves.toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves bots and runs when mutating quota automation state", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bots-"));
    const repository = new BotFileRepository({
      filePath: path.join(root, "bots.json"),
    });

    try {
      const bot = createBot();
      const run = createRun();
      await repository.saveBot(bot);
      await repository.saveRun(run);

      await repository.mutateQuotaAutomationState((snapshot) => {
        snapshot.set(createQuotaAutomationState());
      });

      await expect(repository.getBot("user-1", "bot-1")).resolves.toEqual(bot);
      await expect(repository.getRun("user-1", "run-1")).resolves.toEqual(run);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("migrates version 1 bots to fixed scheduled-task definitions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bots-"));
    const filePath = path.join(root, "bots.json");
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        bots: {
          "legacy-bot": {
            id: "legacy-bot",
            userId: "user-1",
            name: "Legacy bot",
            description: "",
            prompt: "Repeat this legacy prompt",
            enabled: true,
            trigger: "quota_refresh",
            maxConcurrency: 1,
            triggerConfig: {
              quota: {
                providerIds: ["minimax-coding-plan"],
                windowIds: ["five-hour"],
                minPercentRemaining: 10,
                cooldownMs: 300_000,
              },
            },
            execution: { target: "queue_only" },
            createdAt: 1,
            updatedAt: 2,
          },
        },
        runs: {
          "legacy-run": {
            id: "legacy-run",
            userId: "user-1",
            botId: "legacy-bot",
            trigger: "quota_refresh",
            status: "completed",
            context: {},
            queuedAt: 3,
            startedAt: 4,
            completedAt: 5,
            stoppedAt: null,
          },
        },
        quotaAutomation: {
          windows: {},
          dispatched: {},
          cooldowns: {},
        },
      })
    );
    const repository = new BotFileRepository({ filePath });

    try {
      await expect(
        repository.getBot("user-1", "legacy-bot")
      ).resolves.toMatchObject({
        objective: "Repeat this legacy prompt",
        promptStrategy: "fixed",
        workMode: "adaptive_session",
        providerId: "minimax-coding-plan",
      });
      await expect(
        repository.getRun("user-1", "legacy-run")
      ).resolves.toMatchObject({
        completionState: "pending",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function createBot(): BotDefinition {
  return {
    id: "bot-1",
    userId: "user-1",
    name: "Quota watcher",
    description: "",
    objective: "Run quota work",
    prompt: "Run quota work",
    workMode: "adaptive_session",
    promptStrategy: "fixed",
    enabled: true,
    trigger: "quota_refresh",
    maxConcurrency: 1,
    execution: { target: "queue_only" },
    createdAt: 1,
    updatedAt: 1,
  };
}

function createRun(): BotRun {
  return {
    id: "run-1",
    userId: "user-1",
    botId: "bot-1",
    trigger: "quota_refresh",
    status: "queued",
    completionState: "pending",
    context: {},
    queuedAt: 2,
    startedAt: null,
    completedAt: null,
    stoppedAt: null,
  };
}

function createQuotaAutomationState(): BotQuotaAutomationState {
  const resetAt = "2026-06-17T00:00:00.000Z";
  const windowKey = `user-1|openai|daily|${resetAt}`;
  const dispatchKey = `user-1|bot-1|openai|daily|${resetAt}`;
  const cooldownKey = "user-1|bot-1|openai|daily";
  return {
    windows: {
      [windowKey]: {
        userId: "user-1",
        providerId: "openai",
        providerDisplayName: "OpenAI",
        windowId: "daily",
        windowLabel: "Daily",
        resetAt,
        percentRemaining: 100,
        observedAt: 10,
        nextCheckAt: 20,
      },
    },
    dispatched: {
      [dispatchKey]: {
        dedupeKey: dispatchKey,
        userId: "user-1",
        botId: "bot-1",
        providerId: "openai",
        windowId: "daily",
        resetAt,
        dispatchedAt: 30,
        runIds: ["run-1"],
      },
    },
    cooldowns: {
      [cooldownKey]: {
        userId: "user-1",
        botId: "bot-1",
        providerId: "openai",
        windowId: "daily",
        lastDispatchedAt: 30,
      },
    },
    providerLeases: {},
  };
}

async function readPersistedVersion(filePath: string): Promise<number> {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as { version?: number };
  return parsed.version ?? 0;
}

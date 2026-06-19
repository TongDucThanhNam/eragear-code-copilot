import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
      await expect(readPersistedVersion(filePath)).resolves.toBe(1);
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
});

function createBot(): BotDefinition {
  return {
    id: "bot-1",
    userId: "user-1",
    name: "Quota watcher",
    description: "",
    prompt: "Run quota work",
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
  };
}

async function readPersistedVersion(filePath: string): Promise<number> {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as { version?: number };
  return parsed.version ?? 0;
}

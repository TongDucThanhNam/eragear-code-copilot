import { describe, expect, it } from "bun:test";
import type { BotDefinition, BotRun } from "./contracts/bots.contract";
import type { BotRepositoryPort } from "./ports/bot-repository.port";
import { BotsService } from "./bots.service";

class MemoryBotRepository implements BotRepositoryPort {
  bots = new Map<string, BotDefinition>();
  runs = new Map<string, BotRun>();

  async listBots(userId: string): Promise<BotDefinition[]> {
    return Array.from(this.bots.values()).filter((bot) => bot.userId === userId);
  }

  async getBot(userId: string, botId: string): Promise<BotDefinition | null> {
    const bot = this.bots.get(botId);
    return bot?.userId === userId ? bot : null;
  }

  async saveBot(bot: BotDefinition): Promise<BotDefinition> {
    this.bots.set(bot.id, bot);
    return bot;
  }

  async deleteBot(userId: string, botId: string): Promise<void> {
    const bot = this.bots.get(botId);
    if (bot?.userId === userId) {
      this.bots.delete(botId);
      for (const run of this.runs.values()) {
        if (run.userId === userId && run.botId === botId) {
          this.runs.delete(run.id);
        }
      }
    }
  }

  async listRuns(userId: string): Promise<BotRun[]> {
    return Array.from(this.runs.values()).filter((run) => run.userId === userId);
  }

  async getRun(userId: string, runId: string): Promise<BotRun | null> {
    const run = this.runs.get(runId);
    return run?.userId === userId ? run : null;
  }

  async saveRun(run: BotRun): Promise<BotRun> {
    this.runs.set(run.id, run);
    return run;
  }
}

describe("BotsService", () => {
  it("creates bot definitions and starts manual runs", async () => {
    let ids = 0;
    const service = new BotsService({
      repository: new MemoryBotRepository(),
      now: () => 1_000,
      createId: () => `id-${++ids}`,
    });

    const bot = await service.upsert("user-1", {
      name: "Quota watcher",
      prompt: "Run queued quota work",
      trigger: "quota_refresh",
    });
    const run = await service.startRun("user-1", { botId: bot.id });

    expect(bot.enabled).toBe(true);
    expect(run.status).toBe("running");
    expect(run.trigger).toBe("quota_refresh");
  });

  it("orchestrates enabled bots by trigger and respects concurrency", async () => {
    let ids = 0;
    const service = new BotsService({
      repository: new MemoryBotRepository(),
      now: () => 2_000,
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
    let now = 3_000;
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
    now = 4_000;

    const stopped = await service.stopRun("user-1", run.id);
    const otherStatus = await service.list("user-2");

    expect(stopped.status).toBe("stopped");
    expect(stopped.stoppedAt).toBe(4_000);
    expect(otherStatus.bots).toEqual([]);
    expect(otherStatus.runs).toEqual([]);
    await expect(service.stopRun("user-2", run.id)).rejects.toThrow();
  });
});

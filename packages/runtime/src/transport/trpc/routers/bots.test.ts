import { describe, expect, test } from "bun:test";
import { botsRouter } from "./bots";

function createCaller(userId = "user-1") {
  const calls: Array<{
    method: string;
    userId: string;
    id?: string;
    enabled?: boolean;
  }> = [];
  const bots = {
    list(owner: string) {
      calls.push({ method: "list", userId: owner });
      return Promise.resolve({ bots: [], runs: [], providerLeases: [] });
    },
    upsert(owner: string) {
      calls.push({ method: "upsert", userId: owner });
      return Promise.resolve({ id: "bot-1" });
    },
    delete(owner: string, id: string) {
      calls.push({ method: "delete", userId: owner, id });
      return Promise.resolve();
    },
    startRun(owner: string) {
      calls.push({ method: "startRun", userId: owner });
      return Promise.resolve({ id: "run-1" });
    },
    stopRun(owner: string, id: string) {
      calls.push({ method: "stopRun", userId: owner, id });
      return Promise.resolve({ id });
    },
    setEnabled(owner: string, id: string, enabled: boolean) {
      calls.push({ method: "setEnabled", userId: owner, id, enabled });
      return Promise.resolve({ id, enabled });
    },
    runNowIfEligible(owner: string, id: string) {
      calls.push({ method: "runNowIfEligible", userId: owner, id });
      return Promise.resolve({ id: "run-now" });
    },
    retryRun(owner: string, id: string) {
      calls.push({ method: "retryRun", userId: owner, id });
      return Promise.resolve({ id });
    },
    orchestrate(owner: string) {
      calls.push({ method: "orchestrate", userId: owner });
      return Promise.resolve({
        trigger: "quota_refresh",
        startedRuns: [],
        skippedBotIds: [],
      });
    },
    subscribe() {
      return () => undefined;
    },
  };
  return {
    calls,
    caller: botsRouter.createCaller({
      auth: { type: "local", userId },
      appConfig: {},
      useCases: { bots: { bots } },
    } as never),
  };
}

describe("botsRouter scheduled-task API", () => {
  test("exposes lifecycle, retry, admission, and update procedures", () => {
    const procedures = botsRouter._def.procedures as Record<string, unknown>;
    for (const name of [
      "list",
      "upsert",
      "createOrUpdate",
      "delete",
      "setEnabled",
      "startRun",
      "runNowIfEligible",
      "stopRun",
      "retryRun",
      "orchestrate",
      "updates",
    ]) {
      expect(procedures[name]).toBeDefined();
    }
  });

  test("injects authenticated ownership into scheduled-task mutations", async () => {
    const { caller, calls } = createCaller();
    await caller.list();
    await caller.createOrUpdate({
      name: "Scheduled migration",
      objective: "Finish the migration",
      providerId: "zai-coding-plan",
      projectId: "project-1",
      agentId: "opencode",
    });
    await caller.setEnabled({ id: "bot-1", enabled: false });
    await caller.runNowIfEligible({ botId: "bot-1" });
    await caller.retryRun({ runId: "run-1" });
    await caller.stopRun({ runId: "run-1" });
    await caller.delete({ id: "bot-1" });

    expect(calls.map((call) => call.method)).toEqual([
      "list",
      "upsert",
      "setEnabled",
      "runNowIfEligible",
      "retryRun",
      "stopRun",
      "delete",
    ]);
    expect(calls.every((call) => call.userId === "user-1")).toBe(true);
  });
});

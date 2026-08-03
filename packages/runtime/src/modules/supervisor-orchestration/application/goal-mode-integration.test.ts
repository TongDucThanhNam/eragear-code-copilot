import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GoalModeController } from "#runtime/modules/goal-mode";
import { SqliteGoalModeStateRepository } from "#runtime/modules/goal-mode/di";
import { closeSqliteStorage } from "#runtime/platform/storage/sqlite-db";
import { resetStoragePathCacheForTests } from "#runtime/platform/storage/storage-path";

describe("durable Goal Mode production repository", () => {
  let previousStorageDir: string | undefined;
  let tempStorageDir = "";

  beforeEach(async () => {
    previousStorageDir = process.env.ERAGEAR_STORAGE_DIR;
    await closeSqliteStorage();
    tempStorageDir = await mkdtemp(
      path.join(os.tmpdir(), "eragear-goal-mode-")
    );
    process.env.ERAGEAR_STORAGE_DIR = tempStorageDir;
    resetStoragePathCacheForTests();
  });

  afterEach(async () => {
    await closeSqliteStorage();
    resetStoragePathCacheForTests();
    if (previousStorageDir === undefined) {
      Reflect.deleteProperty(process.env, "ERAGEAR_STORAGE_DIR");
    } else {
      process.env.ERAGEAR_STORAGE_DIR = previousStorageDir;
    }
    await removeTempDirWithRetry(tempStorageDir);
  });

  test("persists start, attempt, result, gate, and audit-compatible state across recreation", async () => {
    const createController = () =>
      new GoalModeController({
        repository: new SqliteGoalModeStateRepository(),
        scopeResolver: {
          resolve: async () => ({
            resolverVersion: "v0-no-graph" as const,
            primaryTarget: {
              path: "src/feature.ts",
              score: 1,
              reason: "deterministic fixture",
            },
            secondaryTargets: [],
            resolvedViaLLM: false,
            diagnostics: {
              signalScanSkippedBySize: 0,
              symbolExtractionMode: "regex" as const,
              indexedFiles: 1,
              candidateCount: 1,
            },
          }),
        },
        now: () => "2026-07-11T00:01:00.000Z",
      });
    const controller = createController();
    await controller.startGoal({
      userId: "user-1",
      goalId: "goal-1",
      originalIntent: "Ship the durable phase",
      constraints: ["Stay scoped"],
      phases: [
        {
          phaseId: "phase-1",
          goal: "Implement feature",
          verificationCommand: "bun test feature",
        },
      ],
    });
    await controller.startPhaseAttempt({
      goalId: "goal-1",
      phaseId: "phase-1",
      chatId: "chat-1",
      attemptId: "attempt-1",
    });
    await controller.handleLoopResult({
      goalId: "goal-1",
      phaseId: "phase-1",
      attemptId: "attempt-1",
      supervisorFinalState: { status: "done", continuationCount: 1 },
      filesTouched: ["src/feature.ts"],
      filesCreated: [],
      filesDeleted: [],
      verification: { command: "bun test feature", exitCode: 0 },
      outcomeSummary: {
        keyDecision: "Implemented scoped feature",
        filesChanged: ["src/feature.ts"],
        gotcha: "none",
        verification: "passed",
      },
    });

    await closeSqliteStorage();
    const recovered = await new SqliteGoalModeStateRepository().get("goal-1");

    expect(recovered?.phases[0]?.attempts[0]?.gate?.decision).toBe(
      "auto_continue"
    );
    expect(recovered?.phases[0]?.outcomeSummary?.verification).toBe("passed");
  });
});

async function removeTempDirWithRetry(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code =
        typeof error === "object" && error && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
      if (!(code === "EBUSY" || code === "EPERM")) {
        throw error;
      }
      if (attempt < 9) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }
}

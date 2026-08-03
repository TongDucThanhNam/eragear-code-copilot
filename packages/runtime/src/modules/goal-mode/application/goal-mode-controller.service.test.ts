import { describe, expect, test } from "bun:test";
import { InMemoryGoalModeStateRepository } from "../infra/in-memory-goal-mode-state.repository";
import { GoalModeController } from "./goal-mode-controller.service";
import type { GoalModeWorktreeChangeCollectorPort } from "./ports/goal-mode-worktree-change.port";

function createScopeResolver() {
  return {
    resolve: async (_userId: string, input: { phaseGoal?: string }) => ({
      resolverVersion: "v0-no-graph" as const,
      primaryTarget: {
        path: input.phaseGoal?.includes("gate")
          ? "src/gate.ts"
          : "src/provider.ts",
        score: 10,
        reason: "symbol match",
      },
      secondaryTargets: [],
      resolvedViaLLM: false,
      diagnostics: {
        signalScanSkippedBySize: 0,
        symbolExtractionMode: "regex" as const,
        indexedFiles: 2,
        candidateCount: 1,
      },
    }),
  };
}

async function createStartedGoal(
  options: {
    worktreeChangeCollector?: GoalModeWorktreeChangeCollectorPort;
  } = {}
) {
  const repository = new InMemoryGoalModeStateRepository();
  const controller = new GoalModeController({
    repository,
    scopeResolver: createScopeResolver(),
    ...(options.worktreeChangeCollector
      ? { worktreeChangeCollector: options.worktreeChangeCollector }
      : {}),
    now: () => "2026-06-20T00:00:00.000Z",
  });
  const state = await controller.startGoal({
    userId: "user-1",
    goalId: "goal-1",
    originalIntent: "Ship Supervisos",
    constraints: ["Use MiniMax-M3", "No raw diffs"],
    phases: [
      {
        phaseId: "phase-provider",
        goal: "Implement MiniMax provider",
        verificationCommand: "bun test provider",
      },
      {
        phaseId: "phase-gate",
        goal: "Implement guarded gate",
        verificationCommand: "bun test gate",
      },
    ],
  });
  return { controller, repository, state };
}

describe("GoalModeController", () => {
  test("starts a goal with separate goal state and scoped phases", async () => {
    const { state } = await createStartedGoal();

    expect(state.goalId).toBe("goal-1");
    expect(state.currentPhaseId).toBe("phase-provider");
    expect(state.phases).toHaveLength(2);
    expect(state.phases[0]?.filesAllowed).toEqual(["src/provider.ts"]);
    expect(state.phases[0]?.scopeResolution.resolverVersion).toBe(
      "v0-no-graph"
    );
    expect(state).not.toHaveProperty("continuationCount");
  });

  test("starts one fresh linked attempt per phase attempt", async () => {
    const { controller, repository } = await createStartedGoal();

    await controller.startPhaseAttempt({
      goalId: "goal-1",
      phaseId: "phase-provider",
      chatId: "chat-provider",
      attemptId: "attempt-1",
    });

    const saved = await repository.get("goal-1");
    expect(saved?.phases[0]?.attempts).toEqual([
      {
        attemptId: "attempt-1",
        chatId: "chat-provider",
        startedAt: "2026-06-20T00:00:00.000Z",
        filesTouched: [],
        filesCreated: [],
        filesDeleted: [],
      },
    ]);
  });

  test("auto-continues to the next phase only when gate passes", async () => {
    const { controller } = await createStartedGoal();
    await controller.startPhaseAttempt({
      goalId: "goal-1",
      phaseId: "phase-provider",
      chatId: "chat-provider",
      attemptId: "attempt-1",
    });

    const state = await controller.handleLoopResult({
      goalId: "goal-1",
      phaseId: "phase-provider",
      attemptId: "attempt-1",
      supervisorFinalState: {
        status: "done",
        continuationCount: 3,
        reason: "phase complete",
      },
      filesTouched: ["src/provider.ts"],
      filesCreated: [],
      filesDeleted: [],
      verification: { command: "bun test provider", exitCode: 0 },
      outcomeSummary: {
        keyDecision: "MiniMax provider is active",
        filesChanged: ["src/provider.ts"],
        gotcha: "Missing key fails closed",
        verification: "bun test provider -> exit 0",
      },
    });

    expect(state.currentPhaseId).toBe("phase-gate");
    expect(state.phases[0]?.decision).toBe("auto_continue");
    expect(state.phases[0]?.attempts[0]?.gate).toEqual({
      decision: "auto_continue",
      reasons: [],
    });
  });

  test("keeps the current phase when gate needs user", async () => {
    const { controller } = await createStartedGoal();
    await controller.startPhaseAttempt({
      goalId: "goal-1",
      phaseId: "phase-provider",
      chatId: "chat-provider",
      attemptId: "attempt-1",
    });

    const state = await controller.handleLoopResult({
      goalId: "goal-1",
      phaseId: "phase-provider",
      attemptId: "attempt-1",
      supervisorFinalState: {
        status: "done",
        continuationCount: 1,
      },
      filesTouched: ["src/out-of-scope.ts"],
      filesCreated: [],
      filesDeleted: [],
      verification: { command: "bun test provider", exitCode: 0 },
      outcomeSummary: {
        keyDecision: "Changed an out-of-scope file",
        filesChanged: ["src/out-of-scope.ts"],
        gotcha: "Scope drift requires review",
        verification: "bun test provider -> exit 0",
      },
    });

    expect(state.currentPhaseId).toBe("phase-provider");
    expect(state.phases[0]?.decision).toBe("needs_user");
    expect(state.phases[0]?.attempts[0]?.gate).toEqual({
      decision: "needs_user",
      reasons: ["scope_drift_modified"],
    });
  });

  test("collects git worktree changes for gate decisions when file lists are omitted", async () => {
    const { controller } = await createStartedGoal({
      worktreeChangeCollector: {
        collect: ({ projectRoot }) => {
          expect(projectRoot).toBe("C:/repo");
          return Promise.resolve({
            filesTouched: [],
            filesCreated: ["src/out-of-scope.ts"],
            filesDeleted: [],
          });
        },
      },
    });
    await controller.startPhaseAttempt({
      goalId: "goal-1",
      phaseId: "phase-provider",
      chatId: "chat-provider",
      attemptId: "attempt-1",
    });

    const state = await controller.handleLoopResult({
      goalId: "goal-1",
      phaseId: "phase-provider",
      attemptId: "attempt-1",
      projectRoot: "C:/repo",
      supervisorFinalState: {
        status: "done",
        continuationCount: 1,
      },
      verification: { command: "bun test provider", exitCode: 0 },
      outcomeSummary: {
        keyDecision: "Created an out-of-scope file",
        filesChanged: ["src/out-of-scope.ts"],
        gotcha: "Untracked files are collected from worktree state",
        verification: "bun test provider -> exit 0",
      },
    });

    expect(state.currentPhaseId).toBe("phase-provider");
    expect(state.phases[0]?.attempts[0]?.filesCreated).toEqual([
      "src/out-of-scope.ts",
    ]);
    expect(state.phases[0]?.attempts[0]?.gate).toEqual({
      decision: "needs_user",
      reasons: ["scope_drift_created"],
    });
  });

  test("requires file change evidence when no worktree collector can run", async () => {
    const { controller } = await createStartedGoal();
    await controller.startPhaseAttempt({
      goalId: "goal-1",
      phaseId: "phase-provider",
      chatId: "chat-provider",
      attemptId: "attempt-1",
    });

    await expect(
      controller.handleLoopResult({
        goalId: "goal-1",
        phaseId: "phase-provider",
        attemptId: "attempt-1",
        supervisorFinalState: {
          status: "done",
          continuationCount: 1,
        },
        verification: { command: "bun test provider", exitCode: 0 },
        outcomeSummary: {
          keyDecision: "Missing change evidence",
          filesChanged: [],
          gotcha: "No collector",
          verification: "bun test provider -> exit 0",
        },
      })
    ).rejects.toThrow("requires file change evidence");
  });
});

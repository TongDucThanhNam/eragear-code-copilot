import { describe, expect, test } from "bun:test";
import type { SupervisorRunState } from "../domain/supervisor-run.schemas";
import { createSupervisorRunFixture } from "../domain/supervisor-run.test-fixture";
import { AcpManagerSessionCoordinator } from "./acp-manager-session-coordinator.service";
import type { SupervisorRunRepositoryPort } from "./ports/supervisor-run-repository.port";

class MemoryRuns implements SupervisorRunRepositoryPort {
  private run: SupervisorRunState;

  constructor(run: SupervisorRunState) {
    this.run = run;
  }
  create(run: SupervisorRunState) {
    this.run = structuredClone(run);
    return Promise.resolve(structuredClone(run));
  }
  get(runId: string, userId: string) {
    return Promise.resolve(
      this.run.runId === runId && this.run.userId === userId
        ? structuredClone(this.run)
        : null
    );
  }
  list() {
    return Promise.resolve([structuredClone(this.run)]);
  }
  listNonTerminal() {
    return Promise.resolve([structuredClone(this.run)]);
  }
  save(run: SupervisorRunState, expectedRevision: number) {
    if (this.run.revision !== expectedRevision) {
      throw new Error("revision conflict");
    }
    this.run = structuredClone(run);
    return Promise.resolve(structuredClone(run));
  }
}

const managerPlan = JSON.stringify({
  schemaVersion: 1,
  kind: "plan",
  summary: "Implement safely",
  risks: [],
  tasks: [
    {
      taskId: "task-a",
      title: "Implement",
      goal: "Implement manager mode",
      role: "implementation",
      executionMode: "write",
      dependencies: [],
      candidateAgentId: "agent-1",
      scopeIntent: ["packages/runtime/src/manager.ts"],
      verificationRequirements: ["Manager tests pass"],
    },
  ],
  envelope: {
    goal: "Implement a safe multi-worker feature",
    fileScopes: ["packages/runtime/src/manager.ts"],
    verificationCommands: ["bun test manager.test.ts"],
    successCriteria: ["Manager tests pass"],
    permissionScopes: ["project-read"],
    destructiveActions: [],
    delivery: {
      createCommit: true,
      targetBranch: "master",
      targetHead: "abc123",
      allowDefaultBranch: true,
    },
  },
});

describe("AcpManagerSessionCoordinator", () => {
  test("keeps one sticky manager binding and uses exact-only resume", async () => {
    const base = createSupervisorRunFixture({
      status: "planning",
      tasks: [],
      baseSnapshot: {
        head: "abc123",
        branch: "master",
        dirtyPaths: [],
        targetFingerprints: {},
        capturedAt: "2026-08-10T10:00:00.000Z",
      },
    });
    const runs = new MemoryRuns(base);
    const calls: string[] = [];
    const readinessCalls: string[] = [];
    let turn = 0;
    const coordinator = new AcpManagerSessionCoordinator({
      runs,
      createSession: {
        execute: (input) => {
          calls.push(`create:${input.chatId}`);
          return Promise.resolve({
            id: input.chatId as string,
            sessionId: "acp-1",
          });
        },
      },
      sendMessage: {
        execute: (input) => {
          turn += 1;
          calls.push(`send:${input.chatId}`);
          expect(input.text).toContain("read-only");
          return Promise.resolve({ turnId: `turn-${turn}` });
        },
      },
      stopSession: {
        execute: (_userId, chatId) => {
          calls.push(`stop:${chatId}`);
          return Promise.resolve();
        },
      },
      resumeSession: {
        execute: (_userId, chatId, options) => {
          calls.push(`resume:${chatId}:${options.mode}`);
          return Promise.resolve();
        },
      },
      results: { latestAssistantText: () => Promise.resolve(managerPlan) },
      readiness: {
        recordExactResumeSuccess(input) {
          readinessCalls.push(
            `${input.userId}:${input.agentId}:${input.projectId}`
          );
          return Promise.resolve();
        },
      },
      now: () => "2026-08-10T10:00:00.000Z",
      createId: (prefix) => `${prefix}-1`,
    });

    const dispatched = await coordinator.dispatch({
      runId: base.runId,
      userId: base.userId,
      managerAgentId: "agent-1",
      turnKind: "plan",
    });
    const chatId = dispatched.managerSession?.chatId;
    expect(dispatched.managerSession).toMatchObject({
      agentId: "agent-1",
      agentSessionId: "acp-1",
      exactResumeRequired: true,
      activeTurn: { turnId: "turn-1", kind: "plan" },
    });
    const completed = await coordinator.claimCompletedTurn({
      userId: base.userId,
      chatId: chatId as string,
      turnId: "turn-1",
    });
    expect(completed?.turn.kind).toBe("plan");

    await coordinator.dispatch({
      runId: base.runId,
      userId: base.userId,
      managerAgentId: "agent-1",
      turnKind: "replan",
    });
    expect(calls.filter((call) => call.startsWith("create:"))).toHaveLength(1);
    expect(calls).toContain(`resume:${chatId}:exact_only`);
    expect(readinessCalls).toEqual(["user-1:agent-1:project-1"]);
  });

  test("fails closed and stops the manager after invalid structured output", async () => {
    const base = createSupervisorRunFixture({
      status: "planning",
      tasks: [],
      managerSession: {
        agentId: "agent-1",
        chatId: "manager-chat-1",
        agentSessionId: "acp-1",
        status: "running",
        exactResumeRequired: true,
        activeTurn: {
          turnId: "turn-1",
          kind: "plan",
          startedAt: "2026-08-10T10:00:00.000Z",
        },
      },
    });
    const runs = new MemoryRuns(base);
    const stopped: string[] = [];
    const coordinator = new AcpManagerSessionCoordinator({
      runs,
      createSession: {
        execute: () => Promise.reject(new Error("not used")),
      },
      sendMessage: {
        execute: () => Promise.reject(new Error("not used")),
      },
      stopSession: {
        execute: (_userId, chatId) => {
          stopped.push(chatId);
          return Promise.resolve();
        },
      },
      resumeSession: {
        execute: () => Promise.reject(new Error("not used")),
      },
      results: {
        latestAssistantText: () => Promise.resolve("This is not JSON."),
      },
      now: () => "2026-08-10T10:00:00.000Z",
      createId: (prefix) => `${prefix}-1`,
    });

    await expect(
      coordinator.claimCompletedTurn({
        userId: base.userId,
        chatId: "manager-chat-1",
        turnId: "turn-1",
      })
    ).rejects.toThrow("invalid structured output");
    const failed = await runs.get(base.runId, base.userId);
    expect(failed).toMatchObject({
      status: "needs_user",
      managerSession: { status: "stopped" },
      decisions: [
        {
          kind: "classifier_uncertain",
          status: "open",
          prompt: "ACP manager returned invalid structured output",
        },
      ],
    });
    expect(failed?.managerSession?.activeTurn).toBeUndefined();
    expect(stopped).toEqual(["manager-chat-1"]);
  });

  test("stops an active sticky manager when its run is cancelled", async () => {
    const base = createSupervisorRunFixture({
      status: "cancelled",
      tasks: [],
      managerSession: {
        agentId: "agent-1",
        chatId: "manager-chat-1",
        agentSessionId: "acp-1",
        status: "running",
        exactResumeRequired: true,
        activeTurn: {
          turnId: "turn-1",
          kind: "plan",
          startedAt: "2026-08-10T10:00:00.000Z",
        },
      },
    });
    const runs = new MemoryRuns(base);
    const stopped: string[] = [];
    const coordinator = new AcpManagerSessionCoordinator({
      runs,
      createSession: {
        execute: () => Promise.reject(new Error("not used")),
      },
      sendMessage: {
        execute: () => Promise.reject(new Error("not used")),
      },
      stopSession: {
        execute: (_userId, chatId) => {
          stopped.push(chatId);
          return Promise.resolve();
        },
      },
      resumeSession: {
        execute: () => Promise.reject(new Error("not used")),
      },
      results: { latestAssistantText: () => Promise.resolve(null) },
    });

    const result = await coordinator.stop({
      runId: base.runId,
      userId: base.userId,
    });
    expect(result.managerSession).toMatchObject({ status: "stopped" });
    expect(result.managerSession?.activeTurn).toBeUndefined();
    expect(stopped).toEqual(["manager-chat-1"]);
  });

  test("does not stop a chat when ACP session creation never succeeded", async () => {
    const base = createSupervisorRunFixture({
      status: "cancelled",
      tasks: [],
      managerSession: {
        agentId: "agent-1",
        chatId: "manager-chat-never-created",
        status: "failed",
        exactResumeRequired: true,
      },
    });
    const stopped: string[] = [];
    const coordinator = new AcpManagerSessionCoordinator({
      runs: new MemoryRuns(base),
      createSession: { execute: () => Promise.reject(new Error("not used")) },
      sendMessage: { execute: () => Promise.reject(new Error("not used")) },
      stopSession: {
        execute: (_userId, chatId) => {
          stopped.push(chatId);
          return Promise.resolve();
        },
      },
      resumeSession: { execute: () => Promise.reject(new Error("not used")) },
      results: { latestAssistantText: () => Promise.resolve(null) },
    });

    const result = await coordinator.stop({
      runId: base.runId,
      userId: base.userId,
    });

    expect(result.managerSession?.status).toBe("stopped");
    expect(stopped).toEqual([]);
  });
});

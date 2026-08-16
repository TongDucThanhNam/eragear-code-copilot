import { describe, expect, test } from "bun:test";
import type { SupervisorRunState } from "../domain/supervisor-run.schemas";
import { createSupervisorRunFixture } from "../domain/supervisor-run.test-fixture";
import {
  AcpManagerSessionCoordinator,
  extractAcpManagerTurn,
} from "./acp-manager-session-coordinator.service";
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

test("extracts the latest valid manager turn after an ACP replacement stream", () => {
  const stale = JSON.stringify({
    ...JSON.parse(managerPlan),
    summary: "stale streamed plan",
  });

  expect(extractAcpManagerTurn(`${stale}${managerPlan}`)).toMatchObject({
    summary: "Implement safely",
  });
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
    const modeCalls: string[] = [];
    const modelCalls: string[] = [];
    const effortCalls: string[] = [];
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
            modes: {
              currentModeId: "builder",
              availableModes: [
                { id: "builder", name: "Builder" },
                { id: "manager", name: "Manager" },
              ],
            },
            configOptions: [
              {
                id: "effort",
                category: "thought_level",
                currentValue: "none",
                options: [{ value: "none" }, { value: "high" }],
              },
            ],
          });
        },
      },
      setMode: {
        execute: (_userId, chatId, modeId) => {
          modeCalls.push(`${chatId}:${modeId}`);
          return Promise.resolve();
        },
      },
      setModel: {
        execute: (_userId, chatId, modelId) => {
          modelCalls.push(`${chatId}:${modelId}`);
          return Promise.resolve({
            configOptions: [
              {
                id: "effort",
                category: "thought_level",
                currentValue: "none",
                options: [{ value: "none" }, { value: "xhigh" }],
              },
            ],
          });
        },
      },
      setConfigOption: {
        execute: (_userId, chatId, configId, value) => {
          effortCalls.push(`${chatId}:${configId}:${value}`);
          return Promise.resolve();
        },
      },
      preferredModelId: "openai/gpt-5.6-sol",
      preferredEffort: "max",
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
          return Promise.resolve({
            configOptions: [
              {
                id: "effort",
                category: "thought_level",
                currentValue: "none",
                options: [{ value: "none" }, { value: "xhigh" }],
              },
            ],
          });
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
    expect(modeCalls).toEqual([`${chatId}:manager`]);
    expect(modelCalls).toEqual([
      `${chatId}:openai/gpt-5.6-sol`,
      `${chatId}:openai/gpt-5.6-sol`,
    ]);
    expect(effortCalls).toEqual([
      `${chatId}:effort:xhigh`,
      `${chatId}:effort:xhigh`,
    ]);
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

  test("fails a live manager turn when its ACP session stops unexpectedly", async () => {
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
    const coordinator = new AcpManagerSessionCoordinator({
      runs,
      createSession: { execute: () => Promise.reject(new Error("not used")) },
      sendMessage: { execute: () => Promise.reject(new Error("not used")) },
      stopSession: { execute: () => Promise.resolve() },
      resumeSession: { execute: () => Promise.reject(new Error("not used")) },
      results: { latestAssistantText: () => Promise.resolve(null) },
      now: () => "2026-08-10T10:05:00.000Z",
      createId: (prefix) => `${prefix}-stopped`,
    });

    const claimed = await coordinator.claimStoppedTurn({
      userId: base.userId,
      chatId: "manager-chat-1",
      reason: "Agent process exited with code 1",
    });
    const duplicate = await coordinator.claimStoppedTurn({
      userId: base.userId,
      chatId: "manager-chat-1",
      reason: "Agent process exited with code 1",
    });

    expect(claimed).toEqual({
      runId: base.runId,
      userId: base.userId,
      turnId: "turn-1",
    });
    expect(duplicate).toBeNull();
    expect(await runs.get(base.runId, base.userId)).toMatchObject({
      status: "needs_user",
      managerSession: {
        status: "failed",
        lastCompletedTurnId: "turn-1",
      },
      decisions: [
        {
          kind: "classifier_uncertain",
          status: "open",
          prompt: "Agent process exited with code 1",
        },
      ],
    });
    expect(
      (await runs.get(base.runId, base.userId))?.managerSession?.activeTurn
    ).toBeUndefined();
  });

  test("rejects a structured manager result bound to another run", async () => {
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
    const coordinator = new AcpManagerSessionCoordinator({
      runs,
      createSession: { execute: () => Promise.reject(new Error("not used")) },
      sendMessage: { execute: () => Promise.reject(new Error("not used")) },
      stopSession: { execute: () => Promise.resolve() },
      resumeSession: { execute: () => Promise.reject(new Error("not used")) },
      results: {
        latestAssistantText: () =>
          Promise.resolve(
            JSON.stringify({ ...JSON.parse(managerPlan), runId: "other-run" })
          ),
      },
      now: () => "2026-08-10T10:05:00.000Z",
      createId: (prefix) => `${prefix}-mismatch`,
    });

    await expect(
      coordinator.claimCompletedTurn({
        userId: base.userId,
        chatId: "manager-chat-1",
        turnId: "turn-1",
      })
    ).rejects.toThrow("run id does not match");
    expect(await runs.get(base.runId, base.userId)).toMatchObject({
      status: "needs_user",
      managerSession: { status: "stopped" },
    });
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

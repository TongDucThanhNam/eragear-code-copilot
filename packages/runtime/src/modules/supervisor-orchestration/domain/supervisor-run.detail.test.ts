import { describe, expect, test } from "bun:test";
import {
  createClientSafeSupervisorRunDetail,
  SUPERVISOR_RUN_DETAIL_LIMITS,
} from "./supervisor-run.detail";
import type { SupervisorRunState } from "./supervisor-run.schemas";
import { createSupervisorRunFixture } from "./supervisor-run.test-fixture";

const NOW = "2026-07-11T00:00:00.000Z";

function terminalAttempt(
  overrides: Partial<
    Extract<SupervisorRunState["tasks"][number]["attempts"][number], object>
  > = {}
) {
  return {
    attemptId: "attempt-1",
    chatId: "worker-chat-1",
    agentId: "agent-1",
    status: "terminal" as const,
    idempotencyKey: "idem-1",
    startedAt: NOW,
    finishedAt: NOW,
    result: {
      semanticStatus: "succeeded" as const,
      reason: "All checks passed",
      outcomeSummary: "Implemented the feature",
      files: { touched: [], created: [], deleted: [], renamed: [] },
      verification: [],
      toolFailureSummary: [],
      unresolvedPermissions: [],
      agentId: "agent-1",
      chatId: "worker-chat-1",
      startedAt: NOW,
      finishedAt: NOW,
    },
    ...overrides,
  };
}

describe("supervisor run detail projection", () => {
  test("exposes bounded task prompts, scopes, and attempt evidence", () => {
    const run = createSupervisorRunFixture({
      tasks: [
        {
          taskId: "task-a",
          title: "Research",
          goal: "Find the relevant interfaces",
          role: "research",
          executionMode: "read_only",
          dependencies: [],
          criterionIds: [],
          changeKinds: [],
          filesAllowed: ["packages/runtime/src/index.ts"],
          verificationCommands: ["bun test"],
          status: "completed",
          outcome: "succeeded",
          attempts: [
            terminalAttempt({
              result: {
                semanticStatus: "succeeded",
                reason: "done",
                outcomeSummary: "Found the interfaces",
                files: {
                  touched: ["src/a.ts"],
                  created: ["src/b.ts"],
                  deleted: [],
                  renamed: [{ from: "c.ts", to: "d.ts" }],
                },
                verification: [
                  {
                    command: "bun test",
                    exitCode: 0,
                    outputSummary: "42 pass",
                    startedAt: NOW,
                    finishedAt: NOW,
                  },
                ],
                toolFailureSummary: [],
                unresolvedPermissions: [],
                agentId: "agent-1",
                chatId: "worker-chat-1",
                startedAt: NOW,
                finishedAt: NOW,
                patch: {
                  artifactId: "patch-1",
                  sha256: "a".repeat(64),
                  byteLength: 120,
                  storageRef: "/private/storage/patch-1.diff",
                },
              },
            }),
          ],
        },
      ],
    });

    const detail = createClientSafeSupervisorRunDetail(run);
    expect(detail.tasks).toHaveLength(1);
    const task = detail.tasks[0];
    expect(task?.prompt).toBe("Find the relevant interfaces");
    expect(task?.filesAllowed).toEqual({
      paths: ["packages/runtime/src/index.ts"],
      total: 1,
    });
    const attempt = task?.attempts[0];
    expect(attempt?.semanticStatus).toBe("succeeded");
    expect(attempt?.files.created).toEqual({ paths: ["src/b.ts"], total: 1 });
    expect(attempt?.verification[0]?.outputSummary).toBe("42 pass");
    expect(attempt?.checkpoint).toEqual({
      sha256: "a".repeat(64),
      byteLength: 120,
    });
  });

  test("never leaks roots, storage refs, session internals, or prompt hashes", () => {
    const run = createSupervisorRunFixture({
      projectRoot: "C:/Users/secret/repo",
      originalIntent: "Implement safely",
      tasks: [
        {
          taskId: "task-a",
          title: "Implement",
          goal: "Implement",
          role: "implementation",
          executionMode: "write",
          dependencies: [],
          criterionIds: [],
          changeKinds: [],
          filesAllowed: ["src/a.ts"],
          verificationCommands: ["bun test"],
          status: "running",
          attempts: [
            {
              attemptId: "attempt-1",
              chatId: "worker-chat-1",
              agentSessionId: "session-secret",
              agentId: "agent-1",
              status: "running",
              idempotencyKey: "idem-1",
              promptHash: "b".repeat(64),
              isolatedProjectRoot: "C:/Users/secret/worktree",
              workspace: {
                workspaceId: "ws-1",
                kind: "direct_git",
                userProjectRoot: "C:/Users/secret/repo",
                projectRoot: "C:/Users/secret/repo",
                repositoryRoot: "C:/Users/secret/repo",
                baseHead: "abc123",
                targetFingerprints: {},
              },
              startedAt: NOW,
            },
          ],
        },
      ],
    });

    const serialized = JSON.stringify(createClientSafeSupervisorRunDetail(run));
    expect(serialized).not.toContain("C:/Users/secret");
    expect(serialized).not.toContain("session-secret");
    expect(serialized).not.toContain("storageRef");
    expect(serialized).not.toContain("promptHash");
    expect(serialized).not.toContain("b".repeat(64));
  });

  test("preserves uncertain attempts instead of presenting them as running", () => {
    const run = createSupervisorRunFixture({
      tasks: [
        {
          taskId: "task-a",
          title: "Implement",
          goal: "Implement",
          role: "implementation",
          executionMode: "write",
          dependencies: [],
          criterionIds: [],
          changeKinds: [],
          filesAllowed: [],
          verificationCommands: [],
          status: "running",
          attempts: [
            {
              attemptId: "attempt-uncertain",
              chatId: "worker-chat-1",
              agentId: "agent-1",
              status: "uncertain",
              idempotencyKey: "idem-1",
              uncertaintyId: "uncertainty-1",
              startedAt: NOW,
            },
          ],
        },
      ],
    });

    const detail = createClientSafeSupervisorRunDetail(run);
    expect(detail.tasks[0]?.attempts[0]?.status).toBe("uncertain");
  });

  test("truncates oversized text and lists with honest totals", () => {
    const manyPaths = Array.from(
      { length: 200 },
      (_, index) => `src/file-${index}.ts`
    );
    const longSummary = "x".repeat(
      SUPERVISOR_RUN_DETAIL_LIMITS.summaryChars + 500
    );
    const longAudit = Array.from(
      { length: SUPERVISOR_RUN_DETAIL_LIMITS.auditEntries + 40 },
      (_, index) => ({
        auditId: `audit-${index}`,
        kind: "run_status_changed" as const,
        createdAt: new Date(Date.parse(NOW) + index * 1000).toISOString(),
        actor: "orchestrator" as const,
        summary: `status change ${index}`,
      })
    );
    const run = createSupervisorRunFixture({
      audit: longAudit,
      tasks: [
        {
          taskId: "task-a",
          title: "Implement",
          goal: "g".repeat(SUPERVISOR_RUN_DETAIL_LIMITS.promptChars + 100),
          role: "implementation",
          executionMode: "write",
          dependencies: [],
          criterionIds: [],
          changeKinds: [],
          filesAllowed: manyPaths,
          verificationCommands: [],
          status: "completed",
          outcome: "succeeded",
          attempts: [
            terminalAttempt({
              result: {
                semanticStatus: "succeeded",
                reason: "done",
                outcomeSummary: longSummary,
                files: {
                  touched: manyPaths,
                  created: [],
                  deleted: [],
                  renamed: [],
                },
                verification: [],
                toolFailureSummary: [],
                unresolvedPermissions: [],
                agentId: "agent-1",
                chatId: "worker-chat-1",
                startedAt: NOW,
                finishedAt: NOW,
              },
            }),
          ],
        },
      ],
    });

    const detail = createClientSafeSupervisorRunDetail(run);
    const task = detail.tasks[0];
    expect(task?.prompt.length).toBe(
      SUPERVISOR_RUN_DETAIL_LIMITS.promptChars + 1
    );
    expect(task?.prompt.endsWith("…")).toBe(true);
    expect(task?.filesAllowed.paths).toHaveLength(
      SUPERVISOR_RUN_DETAIL_LIMITS.pathsPerList
    );
    expect(task?.filesAllowed.total).toBe(200);
    const attempt = task?.attempts[0];
    expect(attempt?.outcomeSummary?.endsWith("…")).toBe(true);
    expect(attempt?.files.touched.paths).toHaveLength(
      SUPERVISOR_RUN_DETAIL_LIMITS.pathsPerManifest
    );
    expect(attempt?.files.touched.total).toBe(200);
    expect(detail.audit.total).toBe(longAudit.length);
    expect(detail.audit.truncated).toBe(true);
    expect(detail.audit.entries).toHaveLength(
      SUPERVISOR_RUN_DETAIL_LIMITS.auditEntries
    );
    // Keeps the latest entries after bounding.
    expect(detail.audit.entries.at(-1)?.summary).toBe(
      `status change ${longAudit.length - 1}`
    );
  });

  test("derives the same compatibility statuses as the compact client update", () => {
    const run = createSupervisorRunFixture();
    const detail = createClientSafeSupervisorRunDetail(run);
    expect(detail.status).toBe("queued");
    expect(detail.phase).toBe("executing");
    expect(detail.desiredState).toBe("running");
    expect(detail.plannerReplanCount).toBe(0);
  });
});

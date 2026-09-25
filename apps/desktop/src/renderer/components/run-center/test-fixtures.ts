import type {
  SupervisorRunClientUpdate,
  SupervisorRunDetailClientView,
} from "@eragear-code-copilot/shared";

/** Minimal-but-valid client update fixture builder for Run Center tests. */
export function createRunFixture(
  overrides: Partial<SupervisorRunClientUpdate> = {}
): SupervisorRunClientUpdate {
  return {
    runId: "run-1",
    revision: 3,
    projectId: "project-1",
    status: "running",
    priority: "normal",
    tasks: [],
    gates: [],
    capacityWaits: [],
    decisions: [],
    finalVerification: [],
    createdAt: "2026-09-21T10:00:00.000Z",
    updatedAt: "2026-09-21T11:00:00.000Z",
    ...overrides,
  };
}

export function createTaskFixture(
  overrides: Partial<SupervisorRunClientUpdate["tasks"][number]> = {}
): SupervisorRunClientUpdate["tasks"][number] {
  return {
    taskId: "task-1",
    title: "Implement feature",
    role: "implementation",
    executionMode: "write",
    dependencies: [],
    criterionIds: [],
    changeKinds: [],
    status: "running",
    attempts: [],
    ...overrides,
  };
}

export function createAttemptFixture(
  overrides: Partial<
    SupervisorRunClientUpdate["tasks"][number]["attempts"][number]
  > = {}
): SupervisorRunClientUpdate["tasks"][number]["attempts"][number] {
  return {
    attemptId: "attempt-1",
    chatId: "chat-worker-a",
    agentId: "worker-a",
    status: "running",
    verification: [],
    ...overrides,
  };
}

export function createPlanFixture(
  overrides: Partial<NonNullable<SupervisorRunClientUpdate["plan"]>> = {}
): NonNullable<SupervisorRunClientUpdate["plan"]> {
  return {
    version: 1,
    hash: "abcd1234abcd1234abcd1234abcd1234",
    summary: "Two-phase implementation",
    envelope: {
      goal: "Ship the feature safely",
      fileScopes: [],
      verificationCommands: [],
      successCriteria: [],
      permissionScopes: [],
      destructiveActions: [],
      delivery: {
        createCommit: true,
        targetBranch: "main",
        targetHead: "abc123",
        allowDefaultBranch: false,
      },
    },
    ...overrides,
  };
}

type DetailAttempt =
  SupervisorRunDetailClientView["tasks"][number]["attempts"][number];

export function createDetailAttemptFixture(
  overrides: Partial<DetailAttempt> = {}
): DetailAttempt {
  return {
    attemptId: "attempt-1",
    chatId: "chat-worker-a",
    agentId: "worker-a",
    status: "running",
    startedAt: "2026-09-21T10:05:00.000Z",
    files: {
      touched: { paths: [], total: 0 },
      created: { paths: [], total: 0 },
      deleted: { paths: [], total: 0 },
      renamed: [],
    },
    verification: [],
    unresolvedPermissions: [],
    toolFailureSummary: [],
    ...overrides,
  };
}

type DetailTask = SupervisorRunDetailClientView["tasks"][number];

export function createDetailTaskFixture(
  overrides: Partial<DetailTask> = {}
): DetailTask {
  return {
    taskId: "task-1",
    title: "Implement feature",
    prompt: "Implement the approved change inside the sandbox.",
    role: "implementation",
    executionMode: "write",
    dependencies: [],
    criterionIds: [],
    status: "running",
    filesAllowed: { paths: ["src/a.ts"], total: 1 },
    verificationCommands: ["bun test"],
    attempts: [],
    ...overrides,
  };
}

/** Minimal-but-valid deep detail fixture for workspace tests. */
export function createDetailFixture(
  overrides: Partial<SupervisorRunDetailClientView> = {}
): SupervisorRunDetailClientView {
  return {
    runId: "run-1",
    revision: 3,
    projectId: "project-1",
    status: "running",
    phase: "executing",
    desiredState: "running",
    plannerReplanCount: 0,
    originalIntent: "Ship the feature safely",
    createdAt: "2026-09-21T10:00:00.000Z",
    updatedAt: "2026-09-21T11:00:00.000Z",
    tasks: [],
    gates: [],
    audit: { entries: [], total: 0, truncated: false },
    finalVerification: [],
    ...overrides,
  };
}

import {
  createDefaultSupervisorRunLimits,
  type SupervisorRunState,
  SupervisorRunStateSchema,
} from "./supervisor-run.schemas";

const NOW = "2026-07-11T00:00:00.000Z";

export function createSupervisorRunFixture(
  overrides: Partial<SupervisorRunState> = {}
): SupervisorRunState {
  return SupervisorRunStateSchema.parse({
    schemaVersion: 2,
    runId: "run-1",
    revision: 0,
    userId: "user-1",
    projectId: "project-1",
    projectRoot: "C:/repo",
    originalIntent: "Implement a safe multi-worker feature",
    constraints: ["Do not commit"],
    priority: "normal",
    status: "queued",
    baseSnapshot: {
      head: "abc123",
      dirtyPaths: [],
      targetFingerprints: {},
      capturedAt: NOW,
    },
    limits: createDefaultSupervisorRunLimits(),
    tasks: [
      {
        taskId: "task-a",
        title: "Research",
        goal: "Find the relevant interfaces",
        role: "research",
        executionMode: "read_only",
        dependencies: [],
        filesAllowed: ["packages/runtime/src/index.ts"],
        verificationCommands: ["bun test"],
        status: "ready",
        attempts: [],
      },
      {
        taskId: "task-b",
        title: "Implement",
        goal: "Implement the approved change",
        role: "implementation",
        executionMode: "write",
        dependencies: ["task-a"],
        filesAllowed: ["packages/runtime/src/feature.ts"],
        verificationCommands: ["bun test"],
        preferredAgentId: "agent-1",
        status: "blocked",
        attempts: [],
      },
    ],
    gates: [],
    audit: [],
    processedEventIds: [],
    capacityWaits: [],
    decisions: [],
    plannerReplanCount: 0,
    finalVerification: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
}

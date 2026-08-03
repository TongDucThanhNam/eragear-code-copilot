import { describe, expect, test } from "bun:test";
import { createDefaultSupervisorRunLimits } from "../domain/supervisor-run.schemas";
import type {
  SupervisorPlannerContext,
  SupervisorPlannerPolicy,
  SupervisorPlannerProposal,
} from "./contracts/supervisor-planner.contract";
import type { SupervisorPlannerPort } from "./ports/supervisor-planner.port";
import {
  SupervisorPlannerService,
  SupervisorPlanValidationError,
} from "./supervisor-planner.service";

const policy: SupervisorPlannerPolicy = {
  trustedVerificationCommandsByRole: {
    research: [],
    implementation: ["bun run --cwd packages/runtime check-types"],
    test: ["bun test"],
    review: ["bunx biome check packages --error-on-warnings"],
    integration: ["bun run build"],
  },
  defaultAgentIdByRole: {
    implementation: "agent-code",
    test: "agent-test",
  },
};

function createContext(
  overrides: Partial<SupervisorPlannerContext> = {}
): SupervisorPlannerContext {
  return {
    runId: "run-1",
    originalIntent: "Implement a safe feature",
    constraints: ["Do not commit"],
    projectRoot: "C:/repo",
    limits: createDefaultSupervisorRunLimits(),
    agents: [
      {
        agentId: "agent-code",
        displayName: "Code Agent",
        active: true,
        roles: ["research", "implementation", "review", "integration"],
      },
      {
        agentId: "agent-test",
        displayName: "Test Agent",
        active: true,
        roles: ["test"],
      },
      {
        agentId: "agent-offline",
        displayName: "Offline Agent",
        active: false,
        roles: ["implementation"],
      },
    ],
    projectIndexSummary: "runtime module under packages/runtime/src",
    completedTaskSummaries: [],
    ...overrides,
  };
}

function createProposal(
  overrides: Partial<SupervisorPlannerProposal> = {}
): SupervisorPlannerProposal {
  return {
    schemaVersion: 1,
    summary: "Research and implement in dependency order",
    tasks: [
      {
        taskId: "research",
        title: "Research interfaces",
        goal: "Inspect the session application interfaces",
        role: "research",
        executionMode: "read_only",
        dependencies: [],
        candidateAgentId: "agent-code",
        scopeIntent: ["packages/runtime/src/modules/session/index.ts"],
        verificationRequirements: ["Relevant interfaces are identified"],
      },
      {
        taskId: "implement",
        title: "Implement feature",
        goal: "Add the feature behind the existing application interface",
        role: "implementation",
        executionMode: "write",
        dependencies: ["research"],
        scopeIntent: ["packages/runtime/src/modules/example/feature.ts"],
        verificationRequirements: ["Runtime typecheck passes"],
      },
    ],
    ...overrides,
  };
}

class StubPlanner implements SupervisorPlannerPort {
  private readonly value: unknown;

  constructor(value: unknown) {
    this.value = value;
  }

  propose(): Promise<unknown> {
    return Promise.resolve(this.value);
  }
}

describe("SupervisorPlannerService", () => {
  test("materializes a safe DAG with application-owned agents and commands", async () => {
    const service = new SupervisorPlannerService(
      new StubPlanner(createProposal()),
      policy
    );
    const result = await service.plan(createContext());
    expect(result.tasks.map((task) => task.status)).toEqual([
      "ready",
      "blocked",
    ]);
    expect(result.tasks[1]?.preferredAgentId).toBe("agent-code");
    expect(result.tasks[1]?.verificationCommands).toEqual([
      "bun run --cwd packages/runtime check-types",
    ]);
  });

  test("rejects model-proposed command fields and unknown roles", () => {
    const proposal = createProposal() as unknown as Record<string, unknown>;
    const tasks = structuredClone(proposal.tasks) as Record<string, unknown>[];
    tasks[0] = { ...tasks[0], verificationCommands: ["rm -rf ."] };
    proposal.tasks = tasks;
    const service = new SupervisorPlannerService(
      new StubPlanner(proposal),
      policy
    );
    expect(() => service.validateProposal(createContext(), proposal)).toThrow(
      SupervisorPlanValidationError
    );

    tasks[0] = { ...tasks[0], verificationCommands: undefined, role: "admin" };
    expect(() =>
      service.validateProposal(createContext(), { ...proposal, tasks })
    ).toThrow(SupervisorPlanValidationError);
  });

  test("rejects cycles, unknown dependencies, duplicate ids, and excess tasks", () => {
    const service = new SupervisorPlannerService(
      new StubPlanner(createProposal()),
      policy
    );
    const base = createProposal();
    const graphCases = [
      base.tasks.map((task) => ({ ...task, dependencies: ["missing"] })),
      [
        { ...base.tasks[0], dependencies: ["implement"] },
        { ...base.tasks[1], dependencies: ["research"] },
      ],
      [base.tasks[0], { ...base.tasks[1], taskId: "research" }],
    ];
    for (const tasks of graphCases) {
      expect(() =>
        service.validateProposal(createContext(), { ...base, tasks })
      ).toThrow(SupervisorPlanValidationError);
    }
    expect(() =>
      service.validateProposal(
        createContext({
          limits: { ...createDefaultSupervisorRunLimits(), maxTasks: 1 },
        }),
        base
      )
    ).toThrow("run limit is 1");
  });

  test("rejects unknown, inactive, and role-ineligible agents", () => {
    const service = new SupervisorPlannerService(
      new StubPlanner(createProposal()),
      policy
    );
    for (const candidateAgentId of [
      "missing-agent",
      "agent-offline",
      "agent-test",
    ]) {
      const base = createProposal();
      base.tasks[1] = { ...getImplementationTask(base), candidateAgentId };
      expect(() => service.validateProposal(createContext(), base)).toThrow(
        SupervisorPlanValidationError
      );
    }
  });

  test("rejects absolute, traversal, empty-segment, and scopeless write tasks", () => {
    const service = new SupervisorPlannerService(
      new StubPlanner(createProposal()),
      policy
    );
    for (const scopeIntent of [
      ["C:/outside/file.ts"],
      ["/outside/file.ts"],
      ["../outside.ts"],
      ["src//file.ts"],
      [],
    ]) {
      const base = createProposal();
      base.tasks[1] = { ...getImplementationTask(base), scopeIntent };
      expect(() => service.validateProposal(createContext(), base)).toThrow(
        SupervisorPlanValidationError
      );
    }
  });

  test("rejects unsafe actions even when embedded in ordinary task text", () => {
    const service = new SupervisorPlannerService(
      new StubPlanner(createProposal()),
      policy
    );
    for (const goal of [
      "Run git commit after editing",
      "Deploy the result",
      "Read the API key",
      "Bypass permission checks",
      "Use rm -rf on generated files",
    ]) {
      const base = createProposal();
      base.tasks[1] = { ...getImplementationTask(base), goal };
      expect(() => service.validateProposal(createContext(), base)).toThrow(
        SupervisorPlanValidationError
      );
    }
  });

  test("preserves completed tasks during a valid replan and rejects removal", async () => {
    const original = await new SupervisorPlannerService(
      new StubPlanner(createProposal()),
      policy
    ).plan(createContext());
    const completed = original.tasks.map((task) =>
      task.taskId === "research"
        ? { ...task, status: "completed" as const }
        : task
    );
    const valid = await new SupervisorPlannerService(
      new StubPlanner(createProposal()),
      policy
    ).replan(createContext(), completed);
    expect(valid.tasks[0]?.status).toBe("completed");

    const withoutResearch = createProposal({
      tasks: [
        {
          ...getImplementationTask(createProposal()),
          dependencies: [],
        },
      ],
    });
    await expect(
      new SupervisorPlannerService(
        new StubPlanner(withoutResearch),
        policy
      ).replan(createContext(), completed)
    ).rejects.toThrow("removed completed task");
  });
});

function getImplementationTask(proposal: SupervisorPlannerProposal) {
  const task = proposal.tasks[1];
  if (!task) {
    throw new Error("Planner fixture must include an implementation task");
  }
  return task;
}

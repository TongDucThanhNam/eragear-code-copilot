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
        criterionIds: [],
        changeKinds: [],
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
        criterionIds: [],
        changeKinds: ["scoped_code_change"],
        preferredModelId: "minimax-coding-plan/MiniMax-M3",
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
    expect(result.tasks[1]?.preferredModelId).toBe(
      "minimax-coding-plan/MiniMax-M3"
    );
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

  test("normalizes a trailing directory separator without weakening path safety", () => {
    const base = createProposal();
    base.tasks[1] = {
      ...getImplementationTask(base),
      scopeIntent: ["demos/supervisos-biosphere-terminal/"],
    };
    const service = new SupervisorPlannerService(new StubPlanner(base), policy);

    const result = service.validateProposal(createContext(), base);

    expect(result.tasks[1]?.filesAllowed).toEqual([
      "demos/supervisos-biosphere-terminal",
    ]);
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

  test("binds every typed Goal Contract criterion and authority declaration into work items", () => {
    const proposal = createProposal();
    proposal.tasks[0] = {
      ...getResearchTask(proposal),
      criterionIds: ["criterion-user"],
    };
    proposal.tasks[1] = {
      ...getImplementationTask(proposal),
      criterionIds: ["criterion-machine"],
      changeKinds: ["scoped_code_change", "final_integration"],
    };
    const service = new SupervisorPlannerService(
      new StubPlanner(proposal),
      policy
    );

    const result = service.validateProposal(
      createContext({
        goalContract: createGoalContract({
          trustedVerificationCommands: ["bun test"],
        }),
      }),
      proposal
    );

    expect(result.tasks[0]?.criterionIds).toEqual(["criterion-user"]);
    expect(result.tasks[1]?.criterionIds).toEqual(["criterion-machine"]);
    expect(result.tasks[1]?.changeKinds).toEqual([
      "scoped_code_change",
      "final_integration",
    ]);
    expect(result.tasks[1]?.verificationCommands).toEqual(["bun test"]);
    expect(result.tasks[1]?.verificationCommands).not.toContain(
      "bun run --cwd packages/runtime check-types"
    );
  });

  test("rejects missing or unknown criterion coverage and undeclared ask boundaries", () => {
    const service = new SupervisorPlannerService(
      new StubPlanner(createProposal()),
      policy
    );
    const valid = createProposal();
    valid.tasks[0] = {
      ...getResearchTask(valid),
      criterionIds: ["criterion-user"],
    };
    valid.tasks[1] = {
      ...getImplementationTask(valid),
      criterionIds: ["criterion-machine"],
      changeKinds: ["scoped_code_change", "final_integration"],
    };
    const context = createContext({ goalContract: createGoalContract() });

    expect(() =>
      service.validateProposal(context, {
        ...valid,
        tasks: valid.tasks.map((task) => ({ ...task, criterionIds: [] })),
      })
    ).toThrow("not covered");
    expect(() =>
      service.validateProposal(context, {
        ...valid,
        tasks: valid.tasks.map((task, index) =>
          index === 0 ? { ...task, criterionIds: ["unknown"] } : task
        ),
      })
    ).toThrow("unknown Goal Contract criterion");
    expect(() =>
      service.validateProposal(context, {
        ...valid,
        tasks: valid.tasks.map((task) => ({
          ...task,
          changeKinds: task.changeKinds.filter(
            (kind) => kind !== "final_integration"
          ),
        })),
      })
    ).toThrow("final integration approval");
    expect(() =>
      service.validateProposal(
        createContext({
          goalContract: createGoalContract({
            trustedVerificationCommands: [],
          }),
        }),
        valid
      )
    ).toThrow("no covering task with trusted verification");
  });

  test("rejects Goal Contract verification commands outside runtime trust", () => {
    const proposal = createProposal();
    proposal.tasks[0] = {
      ...getResearchTask(proposal),
      criterionIds: ["criterion-user"],
    };
    proposal.tasks[1] = {
      ...getImplementationTask(proposal),
      criterionIds: ["criterion-machine"],
      changeKinds: ["scoped_code_change", "final_integration"],
    };
    const service = new SupervisorPlannerService(
      new StubPlanner(proposal),
      policy
    );
    expect(() =>
      service.validateProposal(
        createContext({
          goalContract: createGoalContract({
            trustedVerificationCommands: ["untrusted --command"],
          }),
        }),
        proposal
      )
    ).toThrow("not runtime-trusted");
  });

  test("rejects write scope outside a parseable frozen Goal Contract boundary", () => {
    const proposal = createProposal();
    proposal.tasks[0] = {
      ...getResearchTask(proposal),
      criterionIds: ["criterion-user"],
    };
    proposal.tasks[1] = {
      ...getImplementationTask(proposal),
      criterionIds: ["criterion-machine"],
      changeKinds: ["scoped_code_change", "final_integration"],
      scopeIntent: ["apps/desktop/src/main.ts"],
    };
    const service = new SupervisorPlannerService(
      new StubPlanner(proposal),
      policy
    );

    expect(() =>
      service.validateProposal(
        createContext({ goalContract: createGoalContract() }),
        proposal
      )
    ).toThrow("expands beyond the frozen Goal Contract change boundary");
    expect(() =>
      service.validateProposal(
        createContext({
          goalContract: createGoalContract({
            changeBoundary: ["packages/runtime/**/ambiguous"],
          }),
        }),
        proposal
      )
    ).toThrow("Unsupported Goal Contract change boundary");
  });
});

function createGoalContract(
  overrides: Partial<NonNullable<SupervisorPlannerContext["goalContract"]>> = {}
): NonNullable<SupervisorPlannerContext["goalContract"]> {
  return {
    title: "Typed Goal",
    objective: "Ship only with criterion evidence",
    lockedStrategicDecisions: [],
    assumptions: [],
    nonGoals: [],
    changeBoundary: ["packages/runtime"],
    acceptanceCriteria: [
      {
        criterionId: "criterion-machine",
        statement: "Runtime typecheck passes",
        evidence: "machine",
      },
      {
        criterionId: "criterion-user",
        statement: "The behavior is semantically acceptable",
        evidence: "user",
      },
    ],
    trustedVerificationCommands: ["bun run --cwd packages/runtime check-types"],
    authority: {
      scopedCodeChange: "auto",
      architectureChange: "ask",
      dependencyChange: "ask",
      destructiveAction: "ask",
      finalIntegration: "ask",
    },
    unresolvedQuestions: [],
    ...overrides,
  };
}

function getImplementationTask(proposal: SupervisorPlannerProposal) {
  const task = proposal.tasks[1];
  if (!task) {
    throw new Error("Planner fixture must include an implementation task");
  }
  return task;
}

function getResearchTask(proposal: SupervisorPlannerProposal) {
  const task = proposal.tasks[0];
  if (!task) {
    throw new Error("Planner fixture must include a research task");
  }
  return task;
}

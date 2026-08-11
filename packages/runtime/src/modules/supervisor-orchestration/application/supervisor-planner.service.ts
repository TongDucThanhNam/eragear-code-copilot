import path from "node:path";
import type { SupervisorTaskRecord } from "../domain/supervisor-run.schemas";
import { SupervisorRunStateSchema } from "../domain/supervisor-run.schemas";
import type {
  SupervisorPlannerContext,
  SupervisorPlannerPolicy,
  SupervisorPlannerProposal,
  SupervisorPlannerTaskProposal,
} from "./contracts/supervisor-planner.contract";
import {
  SupervisorPlannerContextSchema,
  SupervisorPlannerPolicySchema,
  SupervisorPlannerProposalSchema,
} from "./contracts/supervisor-planner.contract";
import type { SupervisorPlannerPort } from "./ports/supervisor-planner.port";

const UNSAFE_PLAN_TEXT =
  /\b(?:git\s+(?:commit|push|reset|stash|switch|checkout)|commit\b|push\b|deploy\b|credential(?:s)?\b|api[_ -]?key\b|secret(?:s)?\b|permission\s+bypass|bypass\s+permission|rm\s+-rf|remove-item\b|delete\s+(?:all|user|project|repository|repo)\b)/i;
const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/;

export class SupervisorPlanValidationError extends Error {
  readonly code:
    | "INVALID_PROPOSAL"
    | "TASK_LIMIT"
    | "UNKNOWN_AGENT"
    | "INACTIVE_AGENT"
    | "UNSUPPORTED_AGENT_ROLE"
    | "UNSAFE_PATH"
    | "SCOPELESS_WRITE"
    | "UNSAFE_ACTION"
    | "INVALID_GRAPH"
    | "COMPLETED_TASK_REMOVED";

  constructor(
    code: SupervisorPlanValidationError["code"],
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "SupervisorPlanValidationError";
    this.code = code;
  }
}

export interface ValidatedSupervisorPlan {
  proposal: SupervisorPlannerProposal;
  tasks: SupervisorTaskRecord[];
}

export class SupervisorPlannerService {
  private readonly planner: SupervisorPlannerPort;
  private readonly policy: SupervisorPlannerPolicy;

  constructor(planner: SupervisorPlannerPort, policy: SupervisorPlannerPolicy) {
    this.planner = planner;
    this.policy = SupervisorPlannerPolicySchema.parse(policy);
  }

  async plan(
    context: SupervisorPlannerContext
  ): Promise<ValidatedSupervisorPlan> {
    const parsedContext = SupervisorPlannerContextSchema.parse(context);
    const rawProposal = await this.planner.propose(parsedContext);
    return this.validateProposal(parsedContext, rawProposal);
  }

  async replan(
    context: SupervisorPlannerContext,
    currentTasks: SupervisorTaskRecord[]
  ): Promise<ValidatedSupervisorPlan> {
    const next = await this.plan(context);
    const nextById = new Map(next.tasks.map((task) => [task.taskId, task]));
    for (const completed of currentTasks.filter(
      (task) => task.status === "completed"
    )) {
      const replacement = nextById.get(completed.taskId);
      if (!replacement) {
        throw new SupervisorPlanValidationError(
          "COMPLETED_TASK_REMOVED",
          `Replan removed completed task ${completed.taskId}`
        );
      }
      if (
        replacement.goal !== completed.goal ||
        replacement.role !== completed.role ||
        replacement.executionMode !== completed.executionMode
      ) {
        throw new SupervisorPlanValidationError(
          "COMPLETED_TASK_REMOVED",
          `Replan changed completed task ${completed.taskId}`
        );
      }
      const index = next.tasks.findIndex(
        (task) => task.taskId === completed.taskId
      );
      next.tasks[index] = structuredClone(completed);
    }
    return next;
  }

  validateProposal(
    context: SupervisorPlannerContext,
    rawProposal: unknown
  ): ValidatedSupervisorPlan {
    const parsedContext = SupervisorPlannerContextSchema.parse(context);
    let proposal: SupervisorPlannerProposal;
    try {
      proposal = SupervisorPlannerProposalSchema.parse(rawProposal);
    } catch (error) {
      throw new SupervisorPlanValidationError(
        "INVALID_PROPOSAL",
        "Supervisor planner returned an invalid structured proposal",
        { cause: error }
      );
    }
    if (proposal.tasks.length > parsedContext.limits.maxTasks) {
      throw new SupervisorPlanValidationError(
        "TASK_LIMIT",
        `Plan has ${proposal.tasks.length} tasks; run limit is ${parsedContext.limits.maxTasks}`
      );
    }

    const activeAgents = new Map(
      parsedContext.agents
        .filter((agent) => agent.active)
        .map((agent) => [agent.agentId, agent])
    );
    const configuredAgents = new Map(
      parsedContext.agents.map((agent) => [agent.agentId, agent])
    );
    const tasks = proposal.tasks.map((task) =>
      this.materializeTask(task, configuredAgents, activeAgents)
    );

    try {
      SupervisorRunStateSchema.parse({
        schemaVersion: 2,
        runId: parsedContext.runId,
        revision: 0,
        userId: "planner-validation",
        projectRoot: parsedContext.projectRoot,
        originalIntent: parsedContext.originalIntent,
        constraints: parsedContext.constraints,
        priority: "normal",
        status: "planning",
        baseSnapshot: {
          dirtyPaths: [],
          targetFingerprints: {},
          capturedAt: "1970-01-01T00:00:00.000Z",
        },
        limits: parsedContext.limits,
        tasks,
        gates: [],
        audit: [],
        processedEventIds: [],
        capacityWaits: [],
        decisions: [],
        plannerReplanCount: 0,
        finalVerification: [],
        createdAt: "1970-01-01T00:00:00.000Z",
        updatedAt: "1970-01-01T00:00:00.000Z",
      });
    } catch (error) {
      if (error instanceof SupervisorPlanValidationError) {
        throw error;
      }
      throw new SupervisorPlanValidationError(
        "INVALID_GRAPH",
        "Supervisor planner returned an invalid task graph",
        { cause: error }
      );
    }
    return { proposal, tasks };
  }

  private materializeTask(
    task: SupervisorPlannerTaskProposal,
    configuredAgents: Map<string, SupervisorPlannerContext["agents"][number]>,
    activeAgents: Map<string, SupervisorPlannerContext["agents"][number]>
  ): SupervisorTaskRecord {
    assertNoUnsafeAction(task);
    const filesAllowed = task.scopeIntent.map(normalizeSafeRelativePath);
    if (task.executionMode === "write" && filesAllowed.length === 0) {
      throw new SupervisorPlanValidationError(
        "SCOPELESS_WRITE",
        `Write task ${task.taskId} has no scoped targets`
      );
    }
    const agentId = this.selectAgent(task, configuredAgents, activeAgents);
    return {
      taskId: task.taskId,
      title: task.title,
      goal: task.goal,
      role: task.role,
      executionMode: task.executionMode,
      dependencies: [...task.dependencies],
      filesAllowed,
      verificationCommands: [
        ...(this.policy.trustedVerificationCommandsByRole[task.role] ?? []),
      ],
      preferredAgentId: agentId,
      status: task.dependencies.length === 0 ? "ready" : "blocked",
      attempts: [],
    };
  }

  private selectAgent(
    task: SupervisorPlannerTaskProposal,
    configuredAgents: Map<string, SupervisorPlannerContext["agents"][number]>,
    activeAgents: Map<string, SupervisorPlannerContext["agents"][number]>
  ): string {
    const requestedId =
      task.candidateAgentId ?? this.policy.defaultAgentIdByRole[task.role];
    if (requestedId) {
      const configured = configuredAgents.get(requestedId);
      if (!configured) {
        throw new SupervisorPlanValidationError(
          "UNKNOWN_AGENT",
          `Plan requested unknown agent ${requestedId}`
        );
      }
      if (!configured.active) {
        throw new SupervisorPlanValidationError(
          "INACTIVE_AGENT",
          `Plan requested inactive agent ${requestedId}`
        );
      }
      if (!configured.roles.includes(task.role)) {
        throw new SupervisorPlanValidationError(
          "UNSUPPORTED_AGENT_ROLE",
          `Agent ${requestedId} is not eligible for role ${task.role}`
        );
      }
      return requestedId;
    }
    const eligible = [...activeAgents.values()].find((agent) =>
      agent.roles.includes(task.role)
    );
    if (!eligible) {
      throw new SupervisorPlanValidationError(
        "UNSUPPORTED_AGENT_ROLE",
        `No active configured agent is eligible for role ${task.role}`
      );
    }
    return eligible.agentId;
  }
}

function normalizeSafeRelativePath(value: string): string {
  const normalizedSlashes = value.replaceAll("\\", "/").trim();
  if (
    path.posix.isAbsolute(normalizedSlashes) ||
    WINDOWS_ABSOLUTE_PATH.test(normalizedSlashes) ||
    normalizedSlashes.startsWith("//")
  ) {
    throw new SupervisorPlanValidationError(
      "UNSAFE_PATH",
      `Absolute path is not allowed: ${value}`
    );
  }
  const segments = normalizedSlashes.split("/");
  if (
    segments.some((segment) => segment === ".." || segment.length === 0) ||
    normalizedSlashes === "."
  ) {
    throw new SupervisorPlanValidationError(
      "UNSAFE_PATH",
      `Traversal or empty path segment is not allowed: ${value}`
    );
  }
  const normalized = path.posix.normalize(normalizedSlashes);
  if (normalized.startsWith("../") || normalized === "..") {
    throw new SupervisorPlanValidationError(
      "UNSAFE_PATH",
      `Path escapes the project root: ${value}`
    );
  }
  return normalized;
}

function assertNoUnsafeAction(task: SupervisorPlannerTaskProposal): void {
  const text = [
    task.title,
    task.goal,
    ...task.scopeIntent,
    ...task.verificationRequirements,
  ].join("\n");
  if (UNSAFE_PLAN_TEXT.test(text)) {
    throw new SupervisorPlanValidationError(
      "UNSAFE_ACTION",
      `Task ${task.taskId} requests an unsafe or out-of-scope action`
    );
  }
}

export const __supervisorPlannerInternals = {
  normalizeSafeRelativePath,
  assertNoUnsafeAction,
};

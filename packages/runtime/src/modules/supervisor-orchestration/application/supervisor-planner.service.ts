import path from "node:path";
import type { SupervisorTaskRecord } from "../domain/supervisor-run.schemas";
import {
  SUPERVISOR_RUN_SCHEMA_VERSION,
  SupervisorRunStateSchema,
} from "../domain/supervisor-run.schemas";
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
const TRAILING_SLASH = /\/$/;
const INVALID_BOUNDARY_CONTROL_CHAR = /[\r\n:]/;

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
    | "INVALID_CRITERION_COVERAGE"
    | "UNTRUSTED_GOAL_VERIFICATION"
    | "AUTHORITY_DECLARATION_REQUIRED"
    | "INVALID_CHANGE_BOUNDARY"
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
        replacement.executionMode !== completed.executionMode ||
        !sameStrings(replacement.criterionIds, completed.criterionIds) ||
        !sameStrings(replacement.changeKinds, completed.changeKinds)
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
      this.materializeTask(task, configuredAgents, activeAgents, parsedContext)
    );
    this.validateGoalContractCoverage(parsedContext, tasks);

    try {
      SupervisorRunStateSchema.parse({
        schemaVersion: SUPERVISOR_RUN_SCHEMA_VERSION,
        runId: parsedContext.runId,
        revision: 0,
        userId: "planner-validation",
        projectRoot: parsedContext.projectRoot,
        originalIntent: parsedContext.originalIntent,
        constraints: parsedContext.constraints,
        priority: "normal",
        status: "planning",
        desiredState: "running",
        phase: "planning",
        activity: "planning",
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
    activeAgents: Map<string, SupervisorPlannerContext["agents"][number]>,
    context: SupervisorPlannerContext
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
      criterionIds: [...task.criterionIds],
      changeKinds: [...task.changeKinds],
      filesAllowed,
      verificationCommands: this.resolveTaskVerificationCommands(task, context),
      preferredAgentId: agentId,
      ...(task.preferredModelId
        ? { preferredModelId: task.preferredModelId }
        : {}),
      status: task.dependencies.length === 0 ? "ready" : "blocked",
      attempts: [],
    };
  }

  private resolveTaskVerificationCommands(
    task: SupervisorPlannerTaskProposal,
    context: SupervisorPlannerContext
  ): string[] {
    const goalContract = context.goalContract;
    const criteriaById = new Map(
      goalContract?.acceptanceCriteria.map((criterion) => [
        criterion.criterionId,
        criterion,
      ]) ?? []
    );
    const ownsMachineCriterion = task.criterionIds.some(
      (criterionId) => criteriaById.get(criterionId)?.evidence === "machine"
    );
    return [
      ...new Set(
        ownsMachineCriterion && goalContract
          ? goalContract.trustedVerificationCommands
          : (this.policy.trustedVerificationCommandsByRole[task.role] ?? [])
      ),
    ];
  }

  private validateGoalContractCoverage(
    context: SupervisorPlannerContext,
    tasks: SupervisorTaskRecord[]
  ): void {
    const contract = context.goalContract;
    if (!contract) {
      return;
    }
    const trustedCommands = new Set(
      Object.values(this.policy.trustedVerificationCommandsByRole).flat()
    );
    const untrustedCommands = contract.trustedVerificationCommands.filter(
      (command) => !trustedCommands.has(command)
    );
    if (untrustedCommands.length > 0) {
      throw new SupervisorPlanValidationError(
        "UNTRUSTED_GOAL_VERIFICATION",
        `Goal Contract names verification commands that are not runtime-trusted: ${untrustedCommands.join(", ")}`
      );
    }

    const criteriaById = new Map(
      contract.acceptanceCriteria.map((criterion) => [
        criterion.criterionId,
        criterion,
      ])
    );
    const covered = new Map<string, SupervisorTaskRecord[]>();
    const normalizedBoundaries = contract.changeBoundary.map(
      normalizeGoalChangeBoundary
    );
    for (const task of tasks) {
      validateGoalTaskAuthorityAndScope(task, normalizedBoundaries);
      for (const criterionId of task.criterionIds) {
        if (!criteriaById.has(criterionId)) {
          throw new SupervisorPlanValidationError(
            "INVALID_CRITERION_COVERAGE",
            `Task ${task.taskId} references unknown Goal Contract criterion ${criterionId}`
          );
        }
        const bindings = covered.get(criterionId) ?? [];
        bindings.push(task);
        covered.set(criterionId, bindings);
      }
    }

    for (const criterion of contract.acceptanceCriteria) {
      const bindings = covered.get(criterion.criterionId) ?? [];
      if (bindings.length === 0) {
        throw new SupervisorPlanValidationError(
          "INVALID_CRITERION_COVERAGE",
          `Goal Contract criterion ${criterion.criterionId} is not covered by any task`
        );
      }
      if (
        criterion.evidence === "machine" &&
        !bindings.some(
          (task) =>
            contract.trustedVerificationCommands.length > 0 &&
            contract.trustedVerificationCommands.every((command) =>
              task.verificationCommands.includes(command)
            )
        )
      ) {
        throw new SupervisorPlanValidationError(
          "INVALID_CRITERION_COVERAGE",
          `Machine criterion ${criterion.criterionId} has no covering task with trusted verification`
        );
      }
    }
    if (
      contract.authority.finalIntegration === "ask" &&
      !tasks.some((task) => task.changeKinds.includes("final_integration"))
    ) {
      throw new SupervisorPlanValidationError(
        "AUTHORITY_DECLARATION_REQUIRED",
        "Goal Contract requires explicit final integration approval, but no task declares final_integration"
      );
    }
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

export function normalizeSafeRelativePath(value: string): string {
  const normalizedSlashes = value
    .replaceAll("\\", "/")
    .trim()
    .replace(TRAILING_SLASH, "");
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

function normalizeGoalChangeBoundary(value: string): string {
  const trimmed = value.trim().replaceAll("\\", "/");
  const hasSupportedRecursiveSuffix = trimmed.endsWith("/**");
  const candidate = hasSupportedRecursiveSuffix
    ? trimmed.slice(0, -3)
    : trimmed;
  if (
    !candidate ||
    candidate.includes("*") ||
    candidate.includes("?") ||
    INVALID_BOUNDARY_CONTROL_CHAR.test(candidate)
  ) {
    throw new SupervisorPlanValidationError(
      "INVALID_CHANGE_BOUNDARY",
      `Unsupported Goal Contract change boundary: ${value}`
    );
  }
  try {
    return normalizeSafeRelativePath(candidate);
  } catch (error) {
    throw new SupervisorPlanValidationError(
      "INVALID_CHANGE_BOUNDARY",
      `Unsafe Goal Contract change boundary: ${value}`,
      { cause: error }
    );
  }
}

function isPathInsideBoundary(pathValue: string, boundary: string): boolean {
  return pathValue === boundary || pathValue.startsWith(`${boundary}/`);
}

function validateGoalTaskAuthorityAndScope(
  task: SupervisorTaskRecord,
  normalizedBoundaries: string[]
): void {
  if (
    task.executionMode === "write" &&
    !task.changeKinds.includes("scoped_code_change")
  ) {
    throw new SupervisorPlanValidationError(
      "AUTHORITY_DECLARATION_REQUIRED",
      `Write task ${task.taskId} must declare scoped_code_change`
    );
  }
  if (task.executionMode === "read_only" && task.changeKinds.length > 0) {
    throw new SupervisorPlanValidationError(
      "AUTHORITY_DECLARATION_REQUIRED",
      `Read-only task ${task.taskId} cannot declare change authority`
    );
  }
  if (
    task.executionMode === "write" &&
    !task.filesAllowed.every((file) =>
      normalizedBoundaries.some((boundary) =>
        isPathInsideBoundary(file, boundary)
      )
    )
  ) {
    throw new SupervisorPlanValidationError(
      "INVALID_CHANGE_BOUNDARY",
      `Write task ${task.taskId} expands beyond the frozen Goal Contract change boundary`
    );
  }
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

function sameStrings(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export const __supervisorPlannerInternals = {
  normalizeSafeRelativePath,
  normalizeGoalChangeBoundary,
  isPathInsideBoundary,
  assertNoUnsafeAction,
};

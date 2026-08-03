import { randomUUID } from "node:crypto";
import type { ScopeResolverService } from "#runtime/modules/scope-resolution";
import {
  type GoalModeOutcomeSummary,
  type PhaseAttemptRecord,
  type PhaseRecord,
  type SupervisorGoalState,
  SupervisorGoalStateSchema,
} from "./goal-mode.schemas";
import { evaluateGoalModeGate } from "./goal-mode-gate";
import type { GoalModeStateRepositoryPort } from "./ports/goal-mode-state.repository";
import type {
  GoalModeWorktreeChangeCollectorPort,
  GoalModeWorktreeChangeSet,
} from "./ports/goal-mode-worktree-change.port";

export interface GoalModePhasePlanInput {
  phaseId: string;
  goal: string;
  verificationCommand?: string;
  activePathHints?: string[];
}

export interface StartGoalModeInput {
  userId: string;
  goalId?: string;
  originalIntent: string;
  constraints: string[];
  phases: GoalModePhasePlanInput[];
}

export interface StartPhaseAttemptInput {
  userId?: string;
  goalId: string;
  phaseId?: string;
  chatId: string;
  attemptId?: string;
}

export interface HandleGoalModeLoopResultInput {
  userId?: string;
  goalId: string;
  phaseId: string;
  attemptId: string;
  projectRoot?: string;
  supervisorFinalState: NonNullable<PhaseAttemptRecord["supervisorFinalState"]>;
  filesTouched?: string[];
  filesCreated?: string[];
  filesDeleted?: string[];
  verification?: PhaseAttemptRecord["verification"];
  destructiveAction?: boolean;
  outcomeSummary: GoalModeOutcomeSummary;
}

export class GoalModeController {
  private readonly repository: GoalModeStateRepositoryPort;
  private readonly scopeResolver: Pick<ScopeResolverService, "resolve">;
  private readonly worktreeChangeCollector?: GoalModeWorktreeChangeCollectorPort;
  private readonly now: () => string;

  constructor(deps: {
    repository: GoalModeStateRepositoryPort;
    scopeResolver: Pick<ScopeResolverService, "resolve">;
    worktreeChangeCollector?: GoalModeWorktreeChangeCollectorPort;
    now?: () => string;
  }) {
    this.repository = deps.repository;
    this.scopeResolver = deps.scopeResolver;
    this.worktreeChangeCollector = deps.worktreeChangeCollector;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async startGoal(input: StartGoalModeInput): Promise<SupervisorGoalState> {
    if (input.phases.length === 0) {
      throw new Error("Goal Mode requires at least one phase.");
    }
    const goalId = input.goalId ?? randomUUID();
    const phases: PhaseRecord[] = [];
    for (const phase of input.phases) {
      const scopeResolution = await this.scopeResolver.resolve(input.userId, {
        intent: input.originalIntent,
        phaseGoal: phase.goal,
        ...(phase.activePathHints
          ? { activePathHints: phase.activePathHints }
          : {}),
      });
      phases.push({
        phaseId: phase.phaseId,
        goal: phase.goal,
        filesAllowed: [
          scopeResolution.primaryTarget.path,
          ...scopeResolution.secondaryTargets.map((target) => target.path),
        ].filter(Boolean),
        scopeResolution,
        attempts: [],
        decision: "pending",
        ...(phase.verificationCommand
          ? { verificationCommand: phase.verificationCommand }
          : {}),
      });
    }
    const firstPhase = phases[0];
    if (!firstPhase) {
      throw new Error("Goal Mode requires at least one phase.");
    }

    const state = SupervisorGoalStateSchema.parse({
      goalId,
      userId: input.userId,
      originalIntent: input.originalIntent,
      constraints: input.constraints,
      currentPhaseId: firstPhase.phaseId,
      phases,
    });
    await this.repository.save(state);
    return state;
  }

  async startPhaseAttempt(
    input: StartPhaseAttemptInput
  ): Promise<SupervisorGoalState> {
    const state = await this.requireGoal(input.goalId, input.userId);
    const phaseId = input.phaseId ?? state.currentPhaseId;
    const phase = findPhase(state, phaseId);
    phase.attempts.push({
      attemptId: input.attemptId ?? randomUUID(),
      chatId: input.chatId,
      startedAt: this.now(),
      filesTouched: [],
      filesCreated: [],
      filesDeleted: [],
    });
    await this.repository.save(state);
    return state;
  }

  async handleLoopResult(
    input: HandleGoalModeLoopResultInput
  ): Promise<SupervisorGoalState> {
    const state = await this.requireGoal(input.goalId, input.userId);
    const phase = findPhase(state, input.phaseId);
    const attempt = phase.attempts.find(
      (item) => item.attemptId === input.attemptId
    );
    if (!attempt) {
      throw new Error(`Phase attempt not found: ${input.attemptId}`);
    }

    const changeSet = await this.resolveWorktreeChangeSet(input);
    const gate = evaluateGoalModeGate({
      filesAllowed: phase.filesAllowed,
      filesTouched: changeSet.filesTouched,
      filesCreated: changeSet.filesCreated,
      filesDeleted: changeSet.filesDeleted,
      destructiveAction: input.destructiveAction,
      ...(input.verification ? { verification: input.verification } : {}),
    });

    Object.assign(attempt, {
      finishedAt: this.now(),
      supervisorFinalState: input.supervisorFinalState,
      filesTouched: changeSet.filesTouched,
      filesCreated: changeSet.filesCreated,
      filesDeleted: changeSet.filesDeleted,
      ...(input.verification ? { verification: input.verification } : {}),
      gate,
    });
    phase.outcomeSummary = input.outcomeSummary;
    phase.decision = gate.decision;

    if (gate.decision === "auto_continue") {
      const nextPhase = nextPendingPhase(state, phase.phaseId);
      if (nextPhase) {
        state.currentPhaseId = nextPhase.phaseId;
      }
    } else {
      state.currentPhaseId = phase.phaseId;
    }

    const parsed = SupervisorGoalStateSchema.parse(state);
    await this.repository.save(parsed);
    return parsed;
  }

  private async resolveWorktreeChangeSet(
    input: HandleGoalModeLoopResultInput
  ): Promise<GoalModeWorktreeChangeSet> {
    if (input.filesTouched && input.filesCreated && input.filesDeleted) {
      return {
        filesTouched: input.filesTouched,
        filesCreated: input.filesCreated,
        filesDeleted: input.filesDeleted,
      };
    }
    if (!(input.projectRoot && this.worktreeChangeCollector)) {
      throw new Error(
        "Goal Mode loop result requires file change evidence or a projectRoot-backed worktree collector."
      );
    }
    return await this.worktreeChangeCollector.collect({
      projectRoot: input.projectRoot,
    });
  }

  getGoal(goalId: string, userId: string): Promise<SupervisorGoalState> {
    return this.requireGoal(goalId, userId);
  }

  private async requireGoal(
    goalId: string,
    userId?: string
  ): Promise<SupervisorGoalState> {
    const state = await this.repository.get(goalId, userId);
    if (!state) {
      throw new Error(`Goal Mode state not found: ${goalId}`);
    }
    return state;
  }
}

function findPhase(state: SupervisorGoalState, phaseId: string): PhaseRecord {
  const phase = state.phases.find((item) => item.phaseId === phaseId);
  if (!phase) {
    throw new Error(`Goal Mode phase not found: ${phaseId}`);
  }
  return phase;
}

function nextPendingPhase(
  state: SupervisorGoalState,
  phaseId: string
): PhaseRecord | null {
  const currentIndex = state.phases.findIndex(
    (item) => item.phaseId === phaseId
  );
  if (currentIndex < 0) {
    return null;
  }
  return (
    state.phases
      .slice(currentIndex + 1)
      .find((phase) => phase.decision === "pending") ?? null
  );
}

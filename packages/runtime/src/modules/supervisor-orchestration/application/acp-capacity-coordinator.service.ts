import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import { createId } from "#runtime/shared/utils/id.util";
import type {
  SupervisorCapacityWait,
  SupervisorRunState,
} from "../domain/supervisor-run.schemas";
import { transitionSupervisorRun } from "../domain/supervisor-run.transitions";
import {
  type AcpCapacityFailureInput,
  classifyAcpCapacityFailure,
  computeCapacityRetryAt,
} from "./acp-capacity-classifier";
import type { SupervisorRunRepositoryPort } from "./ports/supervisor-run-repository.port";

export interface AcpCapacitySessionLifecyclePort {
  stop(userId: string, chatId: string): Promise<unknown>;
  resumeExact(userId: string, chatId: string): Promise<unknown>;
}

export interface AcpCapacityCoordinatorDeps {
  runs: SupervisorRunRepositoryPort;
  sessions: AcpCapacitySessionLifecyclePort;
  eventBus: EventBusPort;
  now?: () => string;
  createId?: (prefix: string) => string;
}

export class AcpCapacityCoordinator {
  private readonly runs: SupervisorRunRepositoryPort;
  private readonly sessions: AcpCapacitySessionLifecyclePort;
  private readonly eventBus: EventBusPort;
  private readonly now: () => string;
  private readonly idFactory: (prefix: string) => string;

  constructor(deps: AcpCapacityCoordinatorDeps) {
    this.runs = deps.runs;
    this.sessions = deps.sessions;
    this.eventBus = deps.eventBus;
    this.now = deps.now ?? (() => new Date().toISOString());
    this.idFactory = deps.createId ?? createId;
  }

  async suspendWorker(input: {
    runId: string;
    userId: string;
    taskId: string;
    attemptId: string;
    capacityGroup?: string;
    failure: AcpCapacityFailureInput;
  }): Promise<{ suspended: boolean; run: SupervisorRunState }> {
    const run = await this.requireRun(input.runId, input.userId);
    const task = requireTask(run, input.taskId);
    const attempt = requireAttempt(task, input.attemptId);
    if (attempt.status === "terminal" || attempt.status === "interrupted") {
      return { suspended: false, run };
    }
    const classification = classifyAcpCapacityFailure(input.failure);
    if (classification.kind === "unknown") {
      return { suspended: false, run };
    }
    const wait = this.createWait({
      run,
      owner: "task",
      agentId: attempt.agentId,
      taskId: task.taskId,
      attemptId: attempt.attemptId,
      capacityGroup: input.capacityGroup,
      classification,
    });
    const suspended = await this.save(run, (draft) => {
      const draftTask = requireTask(draft, input.taskId);
      requireAttempt(draftTask, input.attemptId).status = "waiting_capacity";
      draftTask.status = "waiting_capacity";
      draft.capacityWaits.push(wait);
      if (classification.retryable) {
        draft.status = "waiting_capacity";
      } else {
        draft.status = "needs_user";
        openResumeDecision(draft, {
          decisionId: this.idFactory("decision"),
          now: this.now(),
          kind:
            classification.kind === "session_fatal"
              ? "exact_resume_failed"
              : "classifier_uncertain",
          prompt: classification.reason,
        });
      }
      draft.audit.push({
        auditId: this.idFactory("audit"),
        kind: "capacity_suspended",
        actor: "system",
        summary: `Worker suspended for ${classification.kind}`,
        taskId: input.taskId,
        attemptId: input.attemptId,
        createdAt: this.now(),
      });
    });
    await this.sessions
      .stop(input.userId, attempt.chatId)
      .catch(() => undefined);
    await this.publishSuspended(suspended, wait);
    return { suspended: true, run: suspended };
  }

  async suspendManager(input: {
    runId: string;
    userId: string;
    capacityGroup?: string;
    failure: AcpCapacityFailureInput;
  }): Promise<{ suspended: boolean; run: SupervisorRunState }> {
    const run = await this.requireRun(input.runId, input.userId);
    const manager = run.managerSession;
    if (!manager) {
      return { suspended: false, run };
    }
    let classification = classifyAcpCapacityFailure(input.failure);
    if (classification.kind === "unknown") {
      return { suspended: false, run };
    }
    if (!manager.agentSessionId && classification.retryable) {
      classification = {
        kind: "session_fatal",
        reason:
          "Manager capacity failure happened before an exact-resumable ACP session was established",
        retryable: false,
      };
    }
    const wait = this.createWait({
      run,
      owner: "manager",
      agentId: manager.agentId,
      capacityGroup: input.capacityGroup,
      classification,
    });
    const suspended = await this.save(run, (draft) => {
      if (!draft.managerSession) {
        throw new Error("Manager session disappeared during suspension");
      }
      draft.managerSession.status = "waiting_capacity";
      draft.capacityWaits.push(wait);
      if (classification.retryable) {
        draft.status = "waiting_capacity";
      } else {
        draft.status = "needs_user";
        openResumeDecision(draft, {
          decisionId: this.idFactory("decision"),
          now: this.now(),
          kind:
            classification.kind === "session_fatal"
              ? "exact_resume_failed"
              : "classifier_uncertain",
          prompt: classification.reason,
        });
      }
      draft.audit.push({
        auditId: this.idFactory("audit"),
        kind: "capacity_suspended",
        actor: "system",
        summary: `Manager suspended for ${classification.kind}`,
        createdAt: this.now(),
      });
    });
    await this.sessions
      .stop(input.userId, manager.chatId)
      .catch(() => undefined);
    await this.publishSuspended(suspended, wait);
    return { suspended: true, run: suspended };
  }

  async resumeDue(input: { now?: string; userId?: string } = {}): Promise<{
    resumed: number;
    failedClosed: number;
  }> {
    const now = input.now ?? this.now();
    const runs = await this.runs.listNonTerminal();
    let resumed = 0;
    let failedClosed = 0;
    for (const candidate of runs) {
      if (input.userId && candidate.userId !== input.userId) {
        continue;
      }
      for (const wait of candidate.capacityWaits.filter(
        (item) => Date.parse(item.retryAt) <= Date.parse(now)
      )) {
        let run = await this.requireRun(candidate.runId, candidate.userId);
        const currentWait = run.capacityWaits.find(
          (item) => item.waitId === wait.waitId
        );
        if (!currentWait) {
          continue;
        }
        const chatId = resolveWaitChatId(run, currentWait);
        try {
          await this.sessions.resumeExact(run.userId, chatId);
          run = await this.save(run, (draft) => {
            draft.capacityWaits = draft.capacityWaits.filter(
              (item) => item.waitId !== currentWait.waitId
            );
            if (currentWait.owner === "manager") {
              if (!draft.managerSession) {
                throw new Error(
                  "Manager session missing during capacity resume"
                );
              }
              draft.managerSession.status = "running";
              draft.status = "planning";
            } else {
              const task = requireTask(draft, currentWait.taskId as string);
              requireAttempt(task, currentWait.attemptId as string).status =
                "running";
              task.status = "running";
              draft.status = "running";
            }
            draft.audit.push({
              auditId: this.idFactory("audit"),
              kind: "capacity_resumed",
              actor: "system",
              summary: "ACP session exact-resumed after capacity wait",
              ...(currentWait.taskId ? { taskId: currentWait.taskId } : {}),
              ...(currentWait.attemptId
                ? { attemptId: currentWait.attemptId }
                : {}),
              createdAt: now,
            });
          });
          resumed += 1;
          await this.eventBus.publish({
            type: "supervisor_capacity_resumed",
            userId: run.userId,
            runId: run.runId,
            ...(run.projectId ? { projectId: run.projectId } : {}),
            waitId: currentWait.waitId,
            owner: currentWait.owner,
            ...(currentWait.taskId ? { taskId: currentWait.taskId } : {}),
            ...(currentWait.attemptId
              ? { attemptId: currentWait.attemptId }
              : {}),
            agentId: currentWait.agentId,
            resumedAt: now,
          });
        } catch (error) {
          failedClosed += 1;
          await this.save(run, (draft) => {
            draft.status = "needs_user";
            openResumeDecision(draft, {
              decisionId: this.idFactory("decision"),
              now,
              kind: "exact_resume_failed",
              prompt:
                error instanceof Error
                  ? error.message
                  : "ACP exact resume failed",
            });
          });
        }
      }
    }
    return { resumed, failedClosed };
  }

  private createWait(input: {
    run: SupervisorRunState;
    owner: "manager" | "task";
    agentId: string;
    taskId?: string;
    attemptId?: string;
    capacityGroup?: string;
    classification: ReturnType<typeof classifyAcpCapacityFailure>;
  }): SupervisorCapacityWait {
    const now = this.now();
    const backoffStep = input.run.capacityWaits.filter(
      (wait) => wait.agentId === input.agentId
    ).length;
    return {
      waitId: this.idFactory("capacity-wait"),
      owner: input.owner,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.attemptId ? { attemptId: input.attemptId } : {}),
      agentId: input.agentId,
      ...(input.capacityGroup ? { capacityGroup: input.capacityGroup } : {}),
      kind: input.classification.kind,
      reason: input.classification.reason,
      suspendedAt: now,
      ...(input.classification.resetAt
        ? { resetAt: input.classification.resetAt }
        : {}),
      retryAt: computeCapacityRetryAt({
        nowMs: Date.parse(now),
        resetAt: input.classification.resetAt,
        backoffStep,
        jitterSeed: `${input.run.runId}:${input.agentId}:${backoffStep}`,
      }),
      backoffStep,
    };
  }

  private async publishSuspended(
    run: SupervisorRunState,
    wait: SupervisorCapacityWait
  ): Promise<void> {
    await this.eventBus.publish({
      type: "supervisor_capacity_suspended",
      userId: run.userId,
      runId: run.runId,
      ...(run.projectId ? { projectId: run.projectId } : {}),
      owner: wait.owner,
      ...(wait.taskId ? { taskId: wait.taskId } : {}),
      ...(wait.attemptId ? { attemptId: wait.attemptId } : {}),
      agentId: wait.agentId,
      ...(wait.capacityGroup ? { capacityGroup: wait.capacityGroup } : {}),
      kind: wait.kind,
      retryAt: wait.retryAt,
      ...(wait.resetAt ? { resetAt: wait.resetAt } : {}),
    });
  }

  private async save(
    run: SupervisorRunState,
    mutate: (draft: SupervisorRunState) => void
  ): Promise<SupervisorRunState> {
    const next = transitionSupervisorRun(run, {
      expectedRevision: run.revision,
      now: this.now(),
      mutate,
    });
    return await this.runs.save(next, run.revision);
  }

  private async requireRun(
    runId: string,
    userId: string
  ): Promise<SupervisorRunState> {
    const run = await this.runs.get(runId, userId);
    if (!run) {
      throw new Error(`Supervisor run not found: ${runId}`);
    }
    return run;
  }
}

function requireTask(run: SupervisorRunState, taskId: string) {
  const task = run.tasks.find((candidate) => candidate.taskId === taskId);
  if (!task) {
    throw new Error(`Supervisor task not found: ${taskId}`);
  }
  return task;
}

function requireAttempt(
  task: ReturnType<typeof requireTask>,
  attemptId: string
) {
  const attempt = task.attempts.find(
    (candidate) => candidate.attemptId === attemptId
  );
  if (!attempt) {
    throw new Error(`Supervisor attempt not found: ${attemptId}`);
  }
  return attempt;
}

function resolveWaitChatId(
  run: SupervisorRunState,
  wait: SupervisorCapacityWait
): string {
  if (wait.owner === "manager") {
    if (!run.managerSession) {
      throw new Error("Manager session missing for capacity wait");
    }
    return run.managerSession.chatId;
  }
  return requireAttempt(
    requireTask(run, wait.taskId as string),
    wait.attemptId as string
  ).chatId;
}

function openResumeDecision(
  run: SupervisorRunState,
  input: {
    decisionId: string;
    now: string;
    kind: "exact_resume_failed" | "classifier_uncertain";
    prompt: string;
  }
): void {
  if (
    run.decisions.some(
      (decision) => decision.status === "open" && decision.kind === input.kind
    )
  ) {
    return;
  }
  run.decisions.push({
    decisionId: input.decisionId,
    kind: input.kind,
    status: "open",
    prompt: input.prompt,
    createdAt: input.now,
  });
}

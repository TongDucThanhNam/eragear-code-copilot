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
  getModelId?(chatId: string): string | undefined;
}

export interface AcpCapacityQuotaPort {
  refresh(
    userId: string,
    input: {
      providerId: string;
      includeUnavailable: true;
      force: true;
    }
  ): Promise<{
    providers: Array<{
      providerId: string;
      displayName: string;
      status: "ready" | "not_configured" | "unavailable" | "error";
      windows: Array<{
        label: string;
        percentRemaining?: number;
        remaining?: number;
        total?: number;
        unlimited?: boolean;
        resetAt?: string;
      }>;
    }>;
  }>;
}

export interface AcpCapacityCoordinatorDeps {
  runs: SupervisorRunRepositoryPort;
  sessions: AcpCapacitySessionLifecyclePort;
  eventBus: EventBusPort;
  quota?: AcpCapacityQuotaPort;
  now?: () => string;
  createId?: (prefix: string) => string;
  quotaPollIntervalMs?: number;
}

export class AcpCapacityCoordinator {
  private readonly runs: SupervisorRunRepositoryPort;
  private readonly sessions: AcpCapacitySessionLifecyclePort;
  private readonly eventBus: EventBusPort;
  private readonly quota?: AcpCapacityQuotaPort;
  private readonly now: () => string;
  private readonly idFactory: (prefix: string) => string;
  private readonly quotaPollIntervalMs: number;
  private readonly lastQuotaPollAt = new Map<string, number>();

  constructor(deps: AcpCapacityCoordinatorDeps) {
    this.runs = deps.runs;
    this.sessions = deps.sessions;
    this.eventBus = deps.eventBus;
    this.quota = deps.quota;
    this.now = deps.now ?? (() => new Date().toISOString());
    this.idFactory = deps.createId ?? createId;
    this.quotaPollIntervalMs = Math.max(
      1000,
      deps.quotaPollIntervalMs ?? 30_000
    );
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Quota grouping, throttling, and owner-specific fail-closed suspension form one reconciliation flow.
  async reconcileQuota(
    input: { userIds?: string[]; now?: string } = {}
  ): Promise<{
    checkedProviders: number;
    suspendedWorkers: number;
    suspendedManagers: number;
  }> {
    if (!(this.quota && this.sessions.getModelId)) {
      return {
        checkedProviders: 0,
        suspendedWorkers: 0,
        suspendedManagers: 0,
      };
    }
    const now = input.now ?? this.now();
    const nowMs = Date.parse(now);
    const allowedUsers = input.userIds
      ? new Set(input.userIds.filter(Boolean))
      : undefined;
    const runs = (await this.runs.listNonTerminal()).filter(
      (run) => !allowedUsers || allowedUsers.has(run.userId)
    );
    const candidates = collectQuotaCandidates(
      runs,
      this.sessions.getModelId.bind(this.sessions)
    );
    const grouped = groupQuotaCandidates(candidates);
    let checkedProviders = 0;
    let suspendedWorkers = 0;
    let suspendedManagers = 0;

    for (const [key, group] of grouped) {
      const lastCheckedAt = this.lastQuotaPollAt.get(key) ?? 0;
      if (
        Number.isFinite(nowMs) &&
        nowMs - lastCheckedAt < this.quotaPollIntervalMs
      ) {
        continue;
      }
      this.lastQuotaPollAt.set(key, nowMs);
      const quota = await this.quota.refresh(group.userId, {
        providerId: group.providerId,
        includeUnavailable: true,
        force: true,
      });
      checkedProviders += 1;
      const snapshot = quota.providers.find(
        (provider) => provider.providerId === group.providerId
      );
      const exhausted =
        snapshot?.status === "ready"
          ? snapshot.windows.filter(isQuotaWindowExhausted)
          : [];
      if (!(snapshot && snapshot.status === "ready")) {
        continue;
      }
      if (exhausted.length === 0) {
        if (
          snapshot.windows.length > 0 &&
          group.candidates.some((candidate) => !candidate.suspendible)
        ) {
          await this.resumeDue({
            userId: group.userId,
            capacityGroup: group.providerId,
            now: "9999-12-31T23:59:59.999Z",
          });
        }
        continue;
      }
      const resetAt = latestResetAt(exhausted);
      const failure = {
        assistantFailure: `Usage limit reached for ${snapshot.displayName}.`,
        metadata: {
          providerId: group.providerId,
          ...(resetAt ? { resetAt } : {}),
        },
      };
      for (const candidate of group.candidates) {
        if (!candidate.suspendible) {
          continue;
        }
        if (candidate.owner === "manager") {
          const result = await this.suspendManager({
            runId: candidate.runId,
            userId: candidate.userId,
            capacityGroup: group.providerId,
            failure,
          });
          if (result.suspended) {
            suspendedManagers += 1;
          }
          continue;
        }
        const result = await this.suspendWorker({
          runId: candidate.runId,
          userId: candidate.userId,
          taskId: candidate.taskId,
          attemptId: candidate.attemptId,
          capacityGroup: group.providerId,
          failure,
        });
        if (result.suspended) {
          suspendedWorkers += 1;
        }
      }
    }
    return { checkedProviders, suspendedWorkers, suspendedManagers };
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
      const draftAttempt = requireAttempt(draftTask, input.attemptId);
      draftAttempt.status = "waiting_capacity";
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

  async resumeDue(
    input: {
      now?: string;
      userId?: string;
      capacityGroup?: string;
      forceDue?: boolean;
    } = {}
  ): Promise<{
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
        (item) =>
          (input.forceDue || Date.parse(item.retryAt) <= Date.parse(now)) &&
          (!input.capacityGroup || item.capacityGroup === input.capacityGroup)
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

interface QuotaCandidateBase {
  runId: string;
  userId: string;
  providerId: string;
  suspendible: boolean;
}

type QuotaCandidate =
  | (QuotaCandidateBase & { owner: "manager" })
  | (QuotaCandidateBase & {
      owner: "task";
      taskId: string;
      attemptId: string;
    });

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Candidate collection mirrors the persisted manager/task/wait ownership union.
function collectQuotaCandidates(
  runs: SupervisorRunState[],
  getModelId: (chatId: string) => string | undefined
): QuotaCandidate[] {
  const candidates: QuotaCandidate[] = [];
  for (const run of runs) {
    if (run.managerSession?.status === "running") {
      const providerId = resolveQuotaProviderId(
        getModelId(run.managerSession.chatId)
      );
      if (providerId) {
        candidates.push({
          owner: "manager",
          runId: run.runId,
          userId: run.userId,
          providerId,
          suspendible: true,
        });
      }
    }
    for (const task of run.tasks) {
      for (const attempt of task.attempts) {
        if (attempt.status !== "starting" && attempt.status !== "running") {
          continue;
        }
        const providerId = resolveQuotaProviderId(getModelId(attempt.chatId));
        if (!providerId) {
          continue;
        }
        candidates.push({
          owner: "task",
          runId: run.runId,
          userId: run.userId,
          providerId,
          suspendible: true,
          taskId: task.taskId,
          attemptId: attempt.attemptId,
        });
      }
    }
    for (const wait of run.capacityWaits) {
      const providerId = resolveQuotaProviderId(
        wait.capacityGroup ? `${wait.capacityGroup}/quota` : undefined
      );
      if (!providerId) {
        continue;
      }
      if (wait.owner === "manager") {
        candidates.push({
          owner: "manager",
          runId: run.runId,
          userId: run.userId,
          providerId,
          suspendible: false,
        });
      } else if (wait.taskId && wait.attemptId) {
        candidates.push({
          owner: "task",
          runId: run.runId,
          userId: run.userId,
          providerId,
          suspendible: false,
          taskId: wait.taskId,
          attemptId: wait.attemptId,
        });
      }
    }
  }
  return candidates;
}

function groupQuotaCandidates(candidates: QuotaCandidate[]) {
  const groups = new Map<
    string,
    {
      userId: string;
      providerId: string;
      candidates: QuotaCandidate[];
    }
  >();
  for (const candidate of candidates) {
    const key = `${candidate.userId}:${candidate.providerId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.candidates.push(candidate);
    } else {
      groups.set(key, {
        userId: candidate.userId,
        providerId: candidate.providerId,
        candidates: [candidate],
      });
    }
  }
  return groups;
}

function resolveQuotaProviderId(modelId: string | undefined) {
  const provider = modelId?.split("/", 1)[0]?.trim().toLowerCase();
  if (!provider) {
    return undefined;
  }
  if (provider === "zai" || provider === "zai-coding-plan") {
    return "zai";
  }
  if (provider === "minimax" || provider === "minimax-coding-plan") {
    return "minimax-coding-plan";
  }
  if (provider === "openai") {
    return "openai";
  }
  return undefined;
}

function isQuotaWindowExhausted(window: {
  percentRemaining?: number;
  remaining?: number;
  total?: number;
  unlimited?: boolean;
}) {
  if (window.unlimited) {
    return false;
  }
  if (window.percentRemaining !== undefined) {
    return window.percentRemaining <= 0;
  }
  return (
    window.remaining !== undefined &&
    window.remaining <= 0 &&
    window.total !== undefined &&
    window.total > 0
  );
}

function latestResetAt(windows: Array<{ resetAt?: string }>) {
  const resetTimes = windows
    .map((window) => window.resetAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  if (resetTimes.length === 0) {
    return undefined;
  }
  return new Date(Math.max(...resetTimes)).toISOString();
}

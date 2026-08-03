import { createId } from "#runtime/shared/utils/id.util";
import type {
  SupervisorRunState,
  SupervisorWorkerAttempt,
} from "../domain/supervisor-run.schemas";
import {
  SupervisorRunRevisionConflictError,
  transitionSupervisorRun,
} from "../domain/supervisor-run.transitions";
import type { SupervisorRunRepositoryPort } from "./ports/supervisor-run-repository.port";
import type {
  DispatchSupervisorWorkerInput,
  DispatchSupervisorWorkerResult,
  SupervisorWorkerBinding,
  WorkerSessionManagerPort,
} from "./ports/worker-session-manager.port";
import { buildWorkerPrompt } from "./worker-prompt.builder";

const MAX_RESERVATION_ATTEMPTS = 8;

export interface WorkerSessionCreatePort {
  execute(input: {
    userId: string;
    projectId?: string;
    projectRoot?: string;
    agentId?: string;
    chatId?: string;
  }): Promise<{
    id: string;
    sessionId?: string;
    models?: {
      currentModelId: string;
      availableModels: Array<{
        modelId: string;
        provider?: string;
        providers?: string[];
      }>;
    };
  }>;
}

export interface WorkerMessageSendPort {
  execute(input: {
    userId: string;
    chatId: string;
    text: string;
    source: "orchestrator";
  }): Promise<{ turnId: string }>;
}

export interface WorkerSessionStopPort {
  execute(userId: string, chatId: string): Promise<unknown>;
}

export interface WorkerSessionResumePort {
  execute(userId: string, chatId: string): Promise<unknown>;
}

export interface WorkerModelSetPort {
  execute(userId: string, chatId: string, modelId: string): Promise<unknown>;
}

export interface WorkerSessionManagerDeps {
  runs: SupervisorRunRepositoryPort;
  createSession: WorkerSessionCreatePort;
  sendMessage: WorkerMessageSendPort;
  stopSession: WorkerSessionStopPort;
  resumeSession: WorkerSessionResumePort;
  setModel?: WorkerModelSetPort;
  now?: () => string;
  createId?: (prefix: string) => string;
}

export class WorkerSessionManagerService implements WorkerSessionManagerPort {
  private readonly runs: SupervisorRunRepositoryPort;
  private readonly createSession: WorkerSessionCreatePort;
  private readonly sendMessage: WorkerMessageSendPort;
  private readonly stopSession: WorkerSessionStopPort;
  private readonly resumeSession: WorkerSessionResumePort;
  private readonly setModel?: WorkerModelSetPort;
  private readonly now: () => string;
  private readonly idFactory: (prefix: string) => string;

  constructor(deps: WorkerSessionManagerDeps) {
    this.runs = deps.runs;
    this.createSession = deps.createSession;
    this.sendMessage = deps.sendMessage;
    this.stopSession = deps.stopSession;
    this.resumeSession = deps.resumeSession;
    this.setModel = deps.setModel;
    this.now = deps.now ?? (() => new Date().toISOString());
    this.idFactory = deps.createId ?? createId;
  }

  async dispatch(
    input: DispatchSupervisorWorkerInput
  ): Promise<DispatchSupervisorWorkerResult> {
    const reservation = await this.reserveAttempt(input);
    if (!reservation.reserved) {
      return { attempt: reservation.attempt, alreadyDispatched: true };
    }
    const { attempt, run } = reservation;
    const task = requireTask(run, input.taskId);
    if (!task.preferredAgentId) {
      await this.markAttemptInterrupted(input, attempt.attemptId);
      throw new Error(`Task ${task.taskId} has no selected agent`);
    }

    let session: Awaited<ReturnType<WorkerSessionCreatePort["execute"]>>;
    try {
      session = await this.createSession.execute({
        userId: input.userId,
        ...(run.projectId ? { projectId: run.projectId } : {}),
        projectRoot:
          input.workspace?.projectRoot ??
          input.isolatedProjectRoot ??
          run.projectRoot,
        agentId: task.preferredAgentId,
        chatId: attempt.chatId,
      });
      if (session.id !== attempt.chatId) {
        throw new Error("Worker session returned a different chat id");
      }
      await this.assertAndSelectScheduledModel({
        userId: input.userId,
        run,
        chatId: attempt.chatId,
        models: session.models,
      });
      await this.updateAttempt(input, attempt.attemptId, (draftAttempt) => {
        draftAttempt.status = "running";
        if (session.sessionId) {
          draftAttempt.agentSessionId = session.sessionId;
        }
      });
      const latestRun = await this.requireRun(input.runId, input.userId);
      const latestTask = requireTask(latestRun, input.taskId);
      const result = await this.sendMessage.execute({
        userId: input.userId,
        chatId: attempt.chatId,
        source: "orchestrator",
        text: buildWorkerPrompt({
          run: latestRun,
          task: latestTask,
          attempt,
          dependencySummaries: collectDependencySummaries(
            latestRun,
            latestTask
          ),
        }),
      });
      const updated = await this.updateAttempt(
        input,
        attempt.attemptId,
        (draftAttempt) => {
          draftAttempt.turnId = result.turnId;
        }
      );
      return { attempt: updated, alreadyDispatched: false };
    } catch (error) {
      await this.stopSession
        .execute(input.userId, attempt.chatId)
        .catch(() => undefined);
      await this.markAttemptInterrupted(input, attempt.attemptId);
      throw error;
    }
  }

  async findBinding(input: {
    userId: string;
    chatId: string;
    turnId?: string;
  }): Promise<SupervisorWorkerBinding | null> {
    const runs = await this.runs.listNonTerminal();
    for (const run of runs) {
      if (run.userId !== input.userId) {
        continue;
      }
      for (const task of run.tasks) {
        const attempt = task.attempts.find(
          (candidate) =>
            candidate.chatId === input.chatId &&
            (!input.turnId || candidate.turnId === input.turnId)
        );
        if (attempt) {
          return {
            runId: run.runId,
            taskId: task.taskId,
            attemptId: attempt.attemptId,
            userId: run.userId,
            chatId: attempt.chatId,
            ...(attempt.turnId ? { turnId: attempt.turnId } : {}),
          };
        }
      }
    }
    return null;
  }

  async claimCompletedTurn(input: {
    userId: string;
    chatId: string;
    turnId: string;
  }): Promise<SupervisorWorkerBinding | null> {
    const eventId = `worker-turn:${input.chatId}:${input.turnId}`;
    for (let retry = 0; retry < MAX_RESERVATION_ATTEMPTS; retry += 1) {
      const binding = await this.findBinding(input);
      if (!binding) {
        return null;
      }
      const run = await this.requireRun(binding.runId, input.userId);
      if (run.processedEventIds.includes(eventId)) {
        return null;
      }
      const next = transitionSupervisorRun(run, {
        expectedRevision: run.revision,
        now: this.now(),
        mutate(draft) {
          draft.processedEventIds.push(eventId);
        },
      });
      try {
        await this.runs.save(next, run.revision);
        return binding;
      } catch (error) {
        if (!(error instanceof SupervisorRunRevisionConflictError)) {
          throw error;
        }
      }
    }
    throw new Error(
      "Could not claim completed worker turn after revision conflicts"
    );
  }

  async claimTerminalDecision(input: {
    userId: string;
    chatId: string;
    eventId: string;
  }): Promise<SupervisorWorkerBinding | null> {
    const eventId = `worker-terminal:${input.eventId}`;
    for (let retry = 0; retry < MAX_RESERVATION_ATTEMPTS; retry += 1) {
      const binding = await this.findBinding({
        userId: input.userId,
        chatId: input.chatId,
      });
      if (!binding) {
        return null;
      }
      const run = await this.requireRun(binding.runId, input.userId);
      if (run.processedEventIds.includes(eventId)) {
        return null;
      }
      const next = transitionSupervisorRun(run, {
        expectedRevision: run.revision,
        now: this.now(),
        mutate(draft) {
          draft.processedEventIds.push(eventId);
        },
      });
      try {
        await this.runs.save(next, run.revision);
        return binding;
      } catch (error) {
        if (!(error instanceof SupervisorRunRevisionConflictError)) {
          throw error;
        }
      }
    }
    throw new Error(
      "Could not claim terminal worker decision after revision conflicts"
    );
  }

  async stop(input: {
    runId: string;
    userId: string;
    taskId: string;
    attemptId: string;
  }): Promise<void> {
    const run = await this.requireRun(input.runId, input.userId);
    const attempt = requireAttempt(run, input.taskId, input.attemptId);
    await this.stopSession.execute(input.userId, attempt.chatId);
    await this.updateAttempt(input, input.attemptId, (draftAttempt, draft) => {
      draftAttempt.status = "interrupted";
      draftAttempt.finishedAt = this.now();
      const task = requireTask(draft, input.taskId);
      if (task.status !== "completed" && task.status !== "cancelled") {
        task.status = "cancelled";
      }
    });
  }

  async resume(input: {
    runId: string;
    userId: string;
    taskId: string;
    attemptId: string;
  }): Promise<void> {
    const run = await this.requireRun(input.runId, input.userId);
    const attempt = requireAttempt(run, input.taskId, input.attemptId);
    await this.resumeSession.execute(input.userId, attempt.chatId);
  }

  private async reserveAttempt(input: DispatchSupervisorWorkerInput): Promise<{
    run: SupervisorRunState;
    attempt: SupervisorWorkerAttempt;
    reserved: boolean;
  }> {
    for (let retry = 0; retry < MAX_RESERVATION_ATTEMPTS; retry += 1) {
      const run = await this.requireRun(input.runId, input.userId);
      const task = requireTask(run, input.taskId);
      const existing = task.attempts.find(
        (attempt) => attempt.idempotencyKey === input.idempotencyKey
      );
      if (existing) {
        return { run, attempt: existing, reserved: false };
      }
      if (task.status !== "queued") {
        throw new Error(`Task ${task.taskId} must be queued before dispatch`);
      }
      const now = this.now();
      const attempt: SupervisorWorkerAttempt = {
        attemptId: this.idFactory("attempt"),
        chatId: this.idFactory("chat"),
        agentId: task.preferredAgentId ?? "unassigned",
        ...(input.isolatedProjectRoot
          ? { isolatedProjectRoot: input.isolatedProjectRoot }
          : {}),
        ...(input.workspace
          ? {
              workspace: structuredClone(input.workspace),
              isolatedProjectRoot:
                input.workspace.kind === "isolated_git"
                  ? input.workspace.projectRoot
                  : undefined,
            }
          : {}),
        status: "starting",
        idempotencyKey: input.idempotencyKey,
        startedAt: now,
      };
      const next = transitionSupervisorRun(run, {
        expectedRevision: run.revision,
        now,
        mutate(draft) {
          const draftTask = requireTask(draft, input.taskId);
          draftTask.status = "running";
          draftTask.attempts.push(attempt);
          if (draft.status === "queued") {
            draft.status = "running";
          }
        },
      });
      try {
        const saved = await this.runs.save(next, run.revision);
        return {
          run: saved,
          attempt: requireAttempt(saved, input.taskId, attempt.attemptId),
          reserved: true,
        };
      } catch (error) {
        if (!(error instanceof SupervisorRunRevisionConflictError)) {
          throw error;
        }
      }
    }
    throw new Error(
      "Could not reserve worker attempt after revision conflicts"
    );
  }

  private async assertAndSelectScheduledModel(input: {
    userId: string;
    run: SupervisorRunState;
    chatId: string;
    models?: Awaited<ReturnType<WorkerSessionCreatePort["execute"]>>["models"];
  }): Promise<void> {
    if (!input.run.providerId) {
      return;
    }
    if (!input.models) {
      throw new Error(
        "Scheduled worker model provider could not be proven compatible"
      );
    }
    const modelId = input.run.workerModelId ?? input.models.currentModelId;
    const model = input.models.availableModels.find(
      (candidate) => candidate.modelId === modelId
    );
    if (!(model && workerModelMatchesProvider(model, input.run.providerId))) {
      throw new Error(
        `Scheduled worker model ${modelId} is incompatible with provider ${input.run.providerId}`
      );
    }
    if (input.models.currentModelId !== modelId) {
      if (!this.setModel) {
        throw new Error("Scheduled worker model selection is unavailable");
      }
      await this.setModel.execute(input.userId, input.chatId, modelId);
    }
  }

  private async updateAttempt(
    input: {
      runId: string;
      userId: string;
      taskId: string;
    },
    attemptId: string,
    mutate: (attempt: SupervisorWorkerAttempt, run: SupervisorRunState) => void
  ): Promise<SupervisorWorkerAttempt> {
    for (let retry = 0; retry < MAX_RESERVATION_ATTEMPTS; retry += 1) {
      const run = await this.requireRun(input.runId, input.userId);
      const next = transitionSupervisorRun(run, {
        expectedRevision: run.revision,
        now: this.now(),
        mutate(draft) {
          mutate(requireAttempt(draft, input.taskId, attemptId), draft);
        },
      });
      try {
        const saved = await this.runs.save(next, run.revision);
        return requireAttempt(saved, input.taskId, attemptId);
      } catch (error) {
        if (!(error instanceof SupervisorRunRevisionConflictError)) {
          throw error;
        }
      }
    }
    throw new Error("Could not update worker attempt after revision conflicts");
  }

  private async markAttemptInterrupted(
    input: {
      runId: string;
      userId: string;
      taskId: string;
    },
    attemptId: string
  ): Promise<void> {
    await this.updateAttempt(input, attemptId, (attempt, run) => {
      attempt.status = "interrupted";
      attempt.finishedAt = this.now();
      const task = requireTask(run, input.taskId);
      if (task.status === "running") {
        task.status = "failed";
      }
    });
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
  run: SupervisorRunState,
  taskId: string,
  attemptId: string
) {
  const attempt = requireTask(run, taskId).attempts.find(
    (candidate) => candidate.attemptId === attemptId
  );
  if (!attempt) {
    throw new Error(`Supervisor worker attempt not found: ${attemptId}`);
  }
  return attempt;
}

function collectDependencySummaries(
  run: SupervisorRunState,
  task: ReturnType<typeof requireTask>
) {
  return task.dependencies.map((dependencyId) => {
    const dependency = requireTask(run, dependencyId);
    const summary = [...dependency.attempts]
      .reverse()
      .find((attempt) => attempt.result)?.result?.outcomeSummary;
    if (!summary) {
      throw new Error(`Dependency ${dependencyId} has no structured result`);
    }
    return { taskId: dependencyId, summary };
  });
}

function workerModelMatchesProvider(
  model: {
    modelId: string;
    provider?: string;
    providers?: string[];
  },
  providerId: string
): boolean {
  const tokens = providerTokens(providerId);
  const declared = [model.provider, ...(model.providers ?? [])].filter(
    (value): value is string => Boolean(value)
  );
  if (declared.length > 0) {
    return declared.some((provider) =>
      tokens.some((token) => normalizeProvider(provider).includes(token))
    );
  }
  const modelId = normalizeProvider(model.modelId);
  return tokens.some((token) => modelId.includes(token));
}

function providerTokens(providerId: string): string[] {
  const normalized = normalizeProvider(providerId)
    .replace(/codingplan/g, "")
    .replace(/plan/g, "");
  if (normalized.includes("zai") || normalized.includes("zhipu")) {
    return ["zai", "zhipu", "glm"];
  }
  if (normalized.includes("minimax")) {
    return ["minimax"];
  }
  return normalized ? [normalized] : [];
}

function normalizeProvider(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

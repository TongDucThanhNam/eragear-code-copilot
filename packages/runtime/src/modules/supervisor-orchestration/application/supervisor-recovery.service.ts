import type {
  SupervisorRunState,
  SupervisorWorkerAttempt,
} from "../domain/supervisor-run.schemas";
import { transitionSupervisorRun } from "../domain/supervisor-run.transitions";
import type {
  SupervisorRecoverySessionPort,
  SupervisorRecoverySummary,
} from "./ports/supervisor-recovery.port";
import type { SupervisorRunRepositoryPort } from "./ports/supervisor-run-repository.port";
import type { WorkerSessionManagerPort } from "./ports/worker-session-manager.port";
import type { WorkerWorkspacePort } from "./ports/worker-workspace.port";
import type { SupervisorOrchestratorService } from "./supervisor-orchestrator.service";

export class SupervisorRecoveryService {
  private readonly runs: SupervisorRunRepositoryPort;
  private readonly sessions: SupervisorRecoverySessionPort;
  private readonly workers: Pick<WorkerSessionManagerPort, "resume">;
  private readonly workspaces: Pick<WorkerWorkspacePort, "dispose">;
  private readonly orchestrator: Pick<
    SupervisorOrchestratorService,
    "schedule" | "recordWorkerResult"
  >;
  private readonly now: () => string;

  constructor(
    runs: SupervisorRunRepositoryPort,
    sessions: SupervisorRecoverySessionPort,
    workers: Pick<WorkerSessionManagerPort, "resume">,
    workspaces: Pick<WorkerWorkspacePort, "dispose">,
    orchestrator: Pick<
      SupervisorOrchestratorService,
      "schedule" | "recordWorkerResult"
    >,
    now: () => string = () => new Date().toISOString()
  ) {
    this.runs = runs;
    this.sessions = sessions;
    this.workers = workers;
    this.workspaces = workspaces;
    this.orchestrator = orchestrator;
    this.now = now;
  }

  async reconcile(): Promise<SupervisorRecoverySummary> {
    const summary: SupervisorRecoverySummary = {
      runs: 0,
      live: 0,
      resumed: 0,
      interrupted: 0,
      cleaned: 0,
      paused: 0,
    };
    for (const run of await this.runs.listNonTerminal()) {
      summary.runs += 1;
      if (run.status === "paused") {
        summary.paused += 1;
        continue;
      }
      await this.reconcileRun(run, summary);
    }
    return summary;
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Recovery keeps live/resume/retry/cleanup decisions in one ordered transaction flow.
  private async reconcileRun(
    initial: SupervisorRunState,
    summary: SupervisorRecoverySummary
  ): Promise<void> {
    if (initial.status === "planning" || initial.status === "draft") {
      const next = transitionSupervisorRun(initial, {
        expectedRevision: initial.revision,
        now: this.now(),
        mutate(draft) {
          draft.status = "needs_user";
        },
      });
      await this.runs.save(next, initial.revision);
      return;
    }

    const interrupted = new Set<string>();
    for (const task of initial.tasks) {
      const latest = task.attempts.at(-1);
      if (latest?.status === "starting" || latest?.status === "running") {
        const state = await this.sessions.inspect({
          userId: initial.userId,
          chatId: latest.chatId,
        });
        if (state.status === "running") {
          summary.live += 1;
          continue;
        }
        if (state.status === "stopped" && state.resumable) {
          try {
            await this.workers.resume({
              runId: initial.runId,
              userId: initial.userId,
              taskId: task.taskId,
              attemptId: latest.attemptId,
            });
            summary.resumed += 1;
            continue;
          } catch {
            // A failed resume is reconciled as interrupted below.
          }
        }
        interrupted.add(latest.attemptId);
        await this.disposeAttempt(latest, summary);
      }
    }

    let run = initial;
    if (interrupted.size > 0) {
      const next = transitionSupervisorRun(run, {
        expectedRevision: run.revision,
        now: this.now(),
        mutate: (draft) => {
          let exhausted = false;
          for (const task of draft.tasks) {
            const attempt = task.attempts.find((candidate) =>
              interrupted.has(candidate.attemptId)
            );
            if (!attempt) {
              continue;
            }
            attempt.status = "interrupted";
            attempt.finishedAt = this.now();
            if (task.attempts.length < draft.limits.maxAttemptsPerTask) {
              task.status = "ready";
            } else {
              task.status = "needs_user";
              exhausted = true;
            }
          }
          if (exhausted) {
            draft.status = "needs_user";
          }
          draft.audit.push({
            auditId: `recovery-${draft.revision + 1}`,
            kind: "recovery_reconciled",
            actor: "system",
            summary: `Reconciled ${interrupted.size} interrupted worker attempts`,
            createdAt: this.now(),
          });
        },
      });
      run = await this.runs.save(next, run.revision);
      summary.interrupted += interrupted.size;
    }

    for (const task of run.tasks) {
      const attempt = task.attempts.at(-1);
      if (
        attempt?.result &&
        (task.status === "reviewing" || task.status === "integrating")
      ) {
        run = await this.orchestrator.recordWorkerResult({
          runId: run.runId,
          userId: run.userId,
          taskId: task.taskId,
          attemptId: attempt.attemptId,
          result: attempt.result,
        });
      } else if (
        attempt?.workspace &&
        (task.status === "completed" ||
          task.status === "failed" ||
          task.status === "cancelled")
      ) {
        await this.disposeAttempt(attempt, summary);
      }
    }

    if (run.status === "queued" || run.status === "running") {
      await this.orchestrator.schedule(run.runId, run.userId);
    }
  }

  private async disposeAttempt(
    attempt: SupervisorWorkerAttempt,
    summary: SupervisorRecoverySummary
  ): Promise<void> {
    if (!attempt.workspace) {
      return;
    }
    await this.workspaces.dispose(attempt.workspace).catch(() => undefined);
    summary.cleaned += 1;
  }
}

import { CryptoHasher } from "bun";
import type { WorkflowEventInput } from "../../workflow/application/contracts/workflow-journal.contract";
import type { SupervisorWorkflowUnitOfWorkPort } from "../../workflow/application/ports/supervisor-workflow-unit-of-work.port";
import type {
  SupervisorRunListInput,
  SupervisorRunRepositoryPort,
} from "../application/ports/supervisor-run-repository.port";
import type { SupervisorRunState } from "../domain/supervisor-run.schemas";
import { SupervisorRunRevisionConflictError } from "../domain/supervisor-run.transitions";

export class JournaledSupervisorRunRepository
  implements SupervisorRunRepositoryPort
{
  private readonly reads: SupervisorRunRepositoryPort;
  private readonly unitOfWork: SupervisorWorkflowUnitOfWorkPort;

  constructor(
    reads: SupervisorRunRepositoryPort,
    unitOfWork: SupervisorWorkflowUnitOfWorkPort
  ) {
    this.reads = reads;
    this.unitOfWork = unitOfWork;
  }

  async create(run: SupervisorRunState): Promise<SupervisorRunState> {
    try {
      const committed = await this.unitOfWork.commitRunTransition({
        expectedRevision: null,
        snapshot: run,
        event: createRunEvent(run, null, "supervisor_run_created"),
      });
      return committed.snapshot;
    } catch (error) {
      throw await this.toRevisionConflict(run, null, error);
    }
  }

  get(runId: string, userId: string): Promise<SupervisorRunState | null> {
    return this.reads.get(runId, userId);
  }

  list(input: SupervisorRunListInput): Promise<SupervisorRunState[]> {
    return this.reads.list(input);
  }

  listNonTerminal(): Promise<SupervisorRunState[]> {
    return this.reads.listNonTerminal();
  }

  async save(
    run: SupervisorRunState,
    expectedRevision: number
  ): Promise<SupervisorRunState> {
    try {
      const committed = await this.unitOfWork.commitRunTransition({
        expectedRevision,
        snapshot: run,
        event: createRunEvent(
          run,
          expectedRevision,
          "supervisor_run_transitioned"
        ),
      });
      return committed.snapshot;
    } catch (error) {
      throw await this.toRevisionConflict(run, expectedRevision, error);
    }
  }

  private async toRevisionConflict(
    run: SupervisorRunState,
    expectedRevision: number | null,
    error: unknown
  ): Promise<unknown> {
    if (!isWorkflowConflict(error)) {
      return error;
    }
    const current = await this.reads.get(run.runId, run.userId);
    return new SupervisorRunRevisionConflictError(
      run.runId,
      expectedRevision ?? -1,
      current?.revision ?? -1
    );
  }
}

export function createRunEvent(
  run: SupervisorRunState,
  previousRevision: number | null,
  eventType: string
): WorkflowEventInput {
  const occurredAtMs = Date.parse(run.updatedAt);
  if (!Number.isFinite(occurredAtMs)) {
    throw new Error(`Invalid Supervisor run updatedAt: ${run.updatedAt}`);
  }
  return {
    eventId: stableEventId(run.runId, run.revision, eventType),
    runId: run.runId,
    revision: run.revision,
    eventType,
    payloadVersion: 1,
    payload: {
      previousRevision,
      desiredState: run.desiredState,
      phase: run.phase,
      outcome: run.outcome ?? null,
    },
    occurredAtMs,
  };
}

function stableEventId(
  runId: string,
  revision: number,
  eventType: string
): string {
  const digest = CryptoHasher.hash(
    "sha256",
    `${runId}\0${revision}\0${eventType}`,
    "hex"
  );
  return `supervisor-workflow-event-${digest}`;
}

function isWorkflowConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "WorkflowJournalConflictError" ||
      ("code" in error && error.code === "WORKFLOW_JOURNAL_CONFLICT"))
  );
}

import { callSqliteWorker } from "#runtime/platform/storage/sqlite-worker-client";
import type {
  SupervisorRunListInput,
  SupervisorRunRepositoryPort,
} from "../application/ports/supervisor-run-repository.port";
import type { SupervisorRunState } from "../domain/supervisor-run.schemas";

export class SupervisorRunSqliteWorkerRepository
  implements SupervisorRunRepositoryPort
{
  create(run: SupervisorRunState): Promise<SupervisorRunState> {
    return callSqliteWorker("supervisorRuns", "create", [run]);
  }

  get(runId: string, userId: string): Promise<SupervisorRunState | null> {
    return callSqliteWorker("supervisorRuns", "get", [runId, userId]);
  }

  list(input: SupervisorRunListInput): Promise<SupervisorRunState[]> {
    return callSqliteWorker("supervisorRuns", "list", [input]);
  }

  listNonTerminal(): Promise<SupervisorRunState[]> {
    return callSqliteWorker("supervisorRuns", "listNonTerminal", []);
  }

  save(
    run: SupervisorRunState,
    expectedRevision: number
  ): Promise<SupervisorRunState> {
    return callSqliteWorker("supervisorRuns", "save", [run, expectedRevision]);
  }
}

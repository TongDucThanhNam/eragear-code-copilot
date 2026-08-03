import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";
import type {
  SupervisorRunListInput,
  SupervisorRunRepositoryPort,
} from "../application/ports/supervisor-run-repository.port";
import { createClientSafeSupervisorRunUpdate } from "../application/supervisor-run-events.service";
import type { SupervisorRunState } from "../domain/supervisor-run.schemas";

export class NotifyingSupervisorRunRepository
  implements SupervisorRunRepositoryPort
{
  private readonly inner: SupervisorRunRepositoryPort;
  private readonly eventBus: EventBusPort;
  private readonly logger: LoggerPort;

  constructor(
    inner: SupervisorRunRepositoryPort,
    eventBus: EventBusPort,
    logger: LoggerPort
  ) {
    this.inner = inner;
    this.eventBus = eventBus;
    this.logger = logger;
  }

  async create(run: SupervisorRunState): Promise<SupervisorRunState> {
    const saved = await this.inner.create(run);
    await this.publish(saved);
    return saved;
  }

  get(runId: string, userId: string) {
    return this.inner.get(runId, userId);
  }

  list(input: SupervisorRunListInput) {
    return this.inner.list(input);
  }

  listNonTerminal() {
    return this.inner.listNonTerminal();
  }

  async save(run: SupervisorRunState, expectedRevision: number) {
    const saved = await this.inner.save(run, expectedRevision);
    await this.publish(saved);
    return saved;
  }

  private async publish(run: SupervisorRunState): Promise<void> {
    await this.eventBus
      .publish({
        type: "supervisor_run_updated",
        userId: run.userId,
        ...(run.projectId ? { projectId: run.projectId } : {}),
        update: createClientSafeSupervisorRunUpdate(run),
      })
      .catch((error) => {
        this.logger.warn("Supervisor run update publish failed", {
          runId: run.runId,
          revision: run.revision,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
}

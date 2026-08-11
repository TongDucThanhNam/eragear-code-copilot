import type {
  SupervisorManagerInboxItem,
  SupervisorManagerInboxRunUpdate,
  SupervisorRunClientUpdate,
} from "@eragear-code-copilot/shared";
import type { SupervisorOrchestratorService } from "./supervisor-orchestrator.service";
import type { SupervisorRunEventsService } from "./supervisor-run-events.service";
import { createClientSafeSupervisorRunUpdate } from "./supervisor-run-events.service";

export interface ListSupervisorManagerInboxInput {
  userId: string;
  projectId?: string;
  includeResolved?: boolean;
}

export interface SubscribeSupervisorManagerInboxInput
  extends ListSupervisorManagerInboxInput {
  listener: (update: SupervisorManagerInboxRunUpdate) => void;
}

export class SupervisorManagerInboxService {
  private readonly orchestrator: SupervisorOrchestratorService;
  private readonly events: SupervisorRunEventsService;

  constructor(
    orchestrator: SupervisorOrchestratorService,
    events: SupervisorRunEventsService
  ) {
    this.orchestrator = orchestrator;
    this.events = events;
  }

  async list(
    input: ListSupervisorManagerInboxInput
  ): Promise<SupervisorManagerInboxItem[]> {
    const runs = await this.orchestrator.list({
      userId: input.userId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      includeTerminal: true,
    });
    return runs
      .flatMap((run) =>
        collectSupervisorManagerInboxItems(
          createClientSafeSupervisorRunUpdate(run),
          input.includeResolved ?? false
        )
      )
      .sort(compareInboxItems);
  }

  subscribe(input: SubscribeSupervisorManagerInboxInput): () => void {
    return this.events.subscribe({
      userId: input.userId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      listener: (run) => {
        input.listener({
          runId: run.runId,
          revision: run.revision,
          items: collectSupervisorManagerInboxItems(
            run,
            input.includeResolved ?? false
          ),
        });
      },
    });
  }
}

export function collectSupervisorManagerInboxItems(
  run: SupervisorRunClientUpdate,
  includeResolved = false
): SupervisorManagerInboxItem[] {
  return run.decisions
    .filter((decision) => includeResolved || decision.status === "open")
    .map((decision) => ({
      runId: run.runId,
      revision: run.revision,
      ...(run.projectId ? { projectId: run.projectId } : {}),
      runStatus: run.status,
      priority: run.priority,
      decisionId: decision.decisionId,
      kind: decision.kind,
      status: decision.status,
      prompt: decision.prompt,
      createdAt: decision.createdAt,
      ...(decision.answeredAt ? { answeredAt: decision.answeredAt } : {}),
    }));
}

function compareInboxItems(
  left: SupervisorManagerInboxItem,
  right: SupervisorManagerInboxItem
): number {
  const weights = { urgent: 4, high: 3, normal: 2, low: 1 } as const;
  return (
    weights[right.priority] - weights[left.priority] ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.decisionId.localeCompare(right.decisionId)
  );
}

import type { SupervisorRunState } from "../../domain/supervisor-run.schemas";

export interface SupervisorRunListInput {
  userId: string;
  projectId?: string;
  projectRoot?: string;
  includeTerminal?: boolean;
}

export interface SupervisorRunRepositoryPort {
  create(run: SupervisorRunState): Promise<SupervisorRunState>;
  get(runId: string, userId: string): Promise<SupervisorRunState | null>;
  list(input: SupervisorRunListInput): Promise<SupervisorRunState[]>;
  listNonTerminal(): Promise<SupervisorRunState[]>;
  save(
    run: SupervisorRunState,
    expectedRevision: number
  ): Promise<SupervisorRunState>;
}

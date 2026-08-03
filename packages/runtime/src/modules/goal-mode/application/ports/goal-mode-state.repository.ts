import type { SupervisorGoalState } from "../goal-mode.schemas";

export interface GoalModeStateRepositoryPort {
  get(goalId: string, userId?: string): Promise<SupervisorGoalState | null>;
  save(state: SupervisorGoalState): Promise<void>;
}

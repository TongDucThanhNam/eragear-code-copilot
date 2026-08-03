import type { SupervisorGoalState } from "../application/goal-mode.schemas";
import type { GoalModeStateRepositoryPort } from "../application/ports/goal-mode-state.repository";

export class InMemoryGoalModeStateRepository
  implements GoalModeStateRepositoryPort
{
  private readonly states = new Map<string, SupervisorGoalState>();

  get(goalId: string, userId?: string): Promise<SupervisorGoalState | null> {
    const state = this.states.get(goalId);
    return Promise.resolve(
      state && (!userId || state.userId === userId)
        ? cloneGoalState(state)
        : null
    );
  }

  save(state: SupervisorGoalState): Promise<void> {
    this.states.set(state.goalId, cloneGoalState(state));
    return Promise.resolve();
  }
}

function cloneGoalState(state: SupervisorGoalState): SupervisorGoalState {
  return JSON.parse(JSON.stringify(state)) as SupervisorGoalState;
}

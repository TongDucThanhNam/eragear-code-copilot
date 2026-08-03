import type { SupervisorPlannerContext } from "../contracts/supervisor-planner.contract";

export interface SupervisorPlannerPort {
  propose(context: SupervisorPlannerContext): Promise<unknown>;
}

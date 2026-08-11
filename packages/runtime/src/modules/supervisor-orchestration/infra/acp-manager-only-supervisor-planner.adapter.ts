import type { SupervisorPlannerPort } from "../application/ports/supervisor-planner.port";

/**
 * Keeps deterministic `SupervisorPlannerService` validation reusable while
 * making direct model planning impossible in production composition.
 */
export class AcpManagerOnlySupervisorPlannerAdapter
  implements SupervisorPlannerPort
{
  propose(): Promise<never> {
    return Promise.reject(
      new Error(
        "Direct Supervisor planner prompting is disabled; use the sticky ACP manager session"
      )
    );
  }
}

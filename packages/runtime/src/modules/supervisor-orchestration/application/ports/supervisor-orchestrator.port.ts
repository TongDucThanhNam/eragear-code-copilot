import type {
  SupervisorRunLimits,
  SupervisorRunPriority,
  SupervisorRunState,
  SupervisorVerificationEvidence,
} from "../../domain/supervisor-run.schemas";
import type { SupervisorPlannerAgent } from "../contracts/supervisor-planner.contract";

export interface SupervisorAgentCatalogPort {
  listEligible(input: {
    userId: string;
    projectId?: string;
  }): Promise<SupervisorPlannerAgent[]>;
}

export interface SupervisorBaseSnapshotPort {
  capture(input: {
    projectRoot: string;
  }): Promise<SupervisorRunState["baseSnapshot"]>;
}

export interface SupervisorFinalVerifierPort {
  verify(input: {
    projectRoot: string;
    commands: string[];
  }): Promise<SupervisorVerificationEvidence[]>;
}

export interface CreateSupervisorRunDraftInput {
  userId: string;
  projectId: string;
  projectRoot: string;
  intent?: string;
  /** Deprecated internal compatibility field; transport never accepts it. */
  originalIntent?: string;
  constraints?: string[];
  priority?: SupervisorRunPriority;
  agentAllowlist?: string[];
  /** Deprecated telemetry-only compatibility fields. */
  eligibleAgentIds?: string[];
  workerModelId?: string;
  providerId?: string;
  scheduleId?: string;
  /** Internal bounded context assembled by runtime services. */
  projectIndexSummary?: string;
  scopeResolutionSummary?: string;
  /** Internal caps may narrow configuration; never accepted from transport. */
  limits?: Partial<SupervisorRunLimits>;
}

export type StartSupervisorRunInput = CreateSupervisorRunDraftInput;

export interface SupervisorDispatchAdmissionPort {
  admit(input: {
    userId: string;
    runId: string;
    scheduleId: string;
    providerId: string;
    taskId: string;
  }): Promise<{ eligible: boolean; reason?: string; nextCheckAt?: number }>;
}

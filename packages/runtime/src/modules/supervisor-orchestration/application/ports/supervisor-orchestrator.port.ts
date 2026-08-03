import type {
  SupervisorRunLimits,
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

export interface StartSupervisorRunInput {
  userId: string;
  projectId?: string;
  projectRoot: string;
  originatingChatId?: string;
  originalIntent: string;
  constraints?: string[];
  limits?: Partial<SupervisorRunLimits>;
  projectIndexSummary?: string;
  scopeResolutionSummary?: string;
  eligibleAgentIds?: string[];
  workerModelId?: string;
  providerId?: string;
  scheduleId?: string;
}

export interface SupervisorDispatchAdmissionPort {
  admit(input: {
    userId: string;
    runId: string;
    scheduleId: string;
    providerId: string;
    taskId: string;
  }): Promise<{ eligible: boolean; reason?: string; nextCheckAt?: number }>;
}

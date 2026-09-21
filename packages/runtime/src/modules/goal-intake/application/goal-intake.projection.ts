import type {
  GoalConsultationRequest,
  GoalIntakeState,
} from "../domain/goal-intake.schemas";

export interface GoalIntakeClientProjection {
  intakeId: string;
  revision: number;
  projectId: string;
  title?: string;
  roughOutcome: string;
  depth: GoalIntakeState["depth"];
  providers: GoalIntakeState["providers"];
  status: GoalIntakeState["status"];
  discoveryRoundCount: number;
  minimumDiscoveryRounds: number;
  messages: GoalIntakeState["messages"];
  pendingReasoning: boolean;
  reasoningState: "idle" | "active" | "resumable";
  reasoningError?: string;
  contractRevisions: GoalIntakeState["contractRevisions"];
  activeContractRevisionId?: string;
  consultations: Omit<GoalConsultationRequest, "packet">[];
  approval?: GoalIntakeState["approval"];
  convertedRunId?: string;
  createdAt: string;
  updatedAt: string;
}

export function createClientSafeGoalIntakeProjection(
  state: GoalIntakeState,
  minimumDiscoveryRounds: number,
  reasoningActive = false
): GoalIntakeClientProjection {
  let reasoningState: GoalIntakeClientProjection["reasoningState"] = "idle";
  if (state.pendingTurn) {
    reasoningState = reasoningActive ? "active" : "resumable";
  }
  return {
    intakeId: state.intakeId,
    revision: state.revision,
    projectId: state.projectId,
    ...(state.title ? { title: state.title } : {}),
    roughOutcome: state.roughOutcome,
    depth: state.depth,
    providers: [...state.providers],
    status: state.status,
    discoveryRoundCount: state.discoveryRoundCount,
    minimumDiscoveryRounds,
    messages: structuredClone(state.messages),
    pendingReasoning: Boolean(state.pendingTurn),
    reasoningState,
    ...(state.reasoningError ? { reasoningError: state.reasoningError } : {}),
    contractRevisions: structuredClone(state.contractRevisions),
    ...(state.activeContractRevisionId
      ? { activeContractRevisionId: state.activeContractRevisionId }
      : {}),
    consultations: state.consultations.map(({ packet: _packet, ...request }) =>
      structuredClone(request)
    ),
    ...(state.approval ? { approval: structuredClone(state.approval) } : {}),
    ...(state.convertedRunId ? { convertedRunId: state.convertedRunId } : {}),
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
}

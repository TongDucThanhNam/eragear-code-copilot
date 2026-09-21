export type GoalIntakeDepth = "quick" | "thorough" | "exhaustive";
export type GoalConsultationProvider = "chatgpt" | "gemini";
export type GoalIntakeStatus =
  | "interviewing"
  | "contract_ready"
  | "approved"
  | "converting"
  | "converted"
  | "cancelled";

export interface GoalIntakeMessageView {
  messageId: string;
  role: "user" | "supervisor";
  kind: "seed" | "answer" | "question" | "synthesis" | "system";
  content: string;
  idempotencyKey?: string;
  createdAt: string;
}

export interface GoalAcceptanceCriterionView {
  criterionId: string;
  statement: string;
  evidence: "machine" | "user";
}

export interface GoalAuthorityPolicyView {
  scopedCodeChange: "auto" | "ask";
  architectureChange: "auto" | "ask";
  dependencyChange: "auto" | "ask";
  destructiveAction: "ask";
  finalIntegration: "auto" | "ask";
}

export interface GoalContractRevisionView {
  revisionId: string;
  intakeId: string;
  revision: number;
  hash: string;
  title: string;
  objective: string;
  lockedStrategicDecisions: string[];
  assumptions: string[];
  nonGoals: string[];
  changeBoundary: string[];
  acceptanceCriteria: GoalAcceptanceCriterionView[];
  trustedVerificationCommands: string[];
  authority: GoalAuthorityPolicyView;
  unresolvedQuestions: string[];
  createdAt: string;
}

export interface GoalConsultationView {
  consultationId: string;
  provider: GoalConsultationProvider;
  status: "prepared" | "imported" | "cancelled";
  reason: string;
  packetHash: string;
  contractRevisionId?: string;
  contractHash?: string;
  result?: {
    response: string;
    importedAt: string;
    importedByUserId?: string;
  };
  createdAt: string;
}

export interface PreparedGoalConsultationView extends GoalConsultationView {
  packet: string;
}

export interface GoalIntakeView {
  intakeId: string;
  revision: number;
  projectId: string;
  title?: string;
  roughOutcome: string;
  depth: GoalIntakeDepth;
  providers: GoalConsultationProvider[];
  status: GoalIntakeStatus;
  discoveryRoundCount: number;
  minimumDiscoveryRounds: number;
  messages: GoalIntakeMessageView[];
  pendingReasoning: boolean;
  reasoningState: "idle" | "active" | "resumable";
  reasoningError?: string;
  contractRevisions: GoalContractRevisionView[];
  activeContractRevisionId?: string;
  consultations: GoalConsultationView[];
  approval?: {
    revisionId: string;
    hash: string;
    approvedAt: string;
    approvedByUserId?: string;
  };
  convertedRunId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PreparedGoalConsultationsView {
  intake: GoalIntakeView;
  requests: PreparedGoalConsultationView[];
}

export interface GoalIntakeAnswerDraft {
  message: string;
  idempotencyKey: string;
  targetKey: string;
}

export interface GoalIntakeAnswerTarget {
  intakeId: string;
  targetKey?: string;
}

export interface GoalDiscoveryStepView {
  answer?: GoalIntakeMessageView;
  question: GoalIntakeMessageView;
  stepNumber: number;
}

export type GoalIntakePhaseId = "discover" | "consult" | "review" | "run";
export type GoalIntakePhaseState = "complete" | "current" | "upcoming";

export interface GoalIntakePhaseView {
  id: GoalIntakePhaseId;
  label: string;
  state: GoalIntakePhaseState;
}

export interface AnswerGoalIntakeClientInput {
  intakeId: string;
  message: string;
  expectedRevision: number;
  idempotencyKey: string;
}

export interface ResumeGoalIntakeClientInput {
  intakeId: string;
  expectedRevision: number;
}

export interface PrepareGoalConsultationClientInput {
  intakeId: string;
  providers: GoalConsultationProvider[];
  reason: string;
  expectedRevision: number;
}

export interface ImportGoalConsultationClientInput {
  intakeId: string;
  consultationId: string;
  response: string;
  expectedRevision: number;
}

export interface ExportGoalConsultationClientInput {
  intakeId: string;
  consultationId: string;
}

export interface ApproveGoalIntakeClientInput {
  intakeId: string;
  revisionId: string;
  hash: string;
  expectedRevision: number;
}

export interface ConvertGoalIntakeClientInput {
  intakeId: string;
  expectedRevision: number;
}

export function getCurrentGoalIntakeQuestion(
  intake: GoalIntakeView
): GoalIntakeMessageView | undefined {
  if (intake.status !== "interviewing") {
    return undefined;
  }
  const latestSupervisorMessage = intake.messages.findLast(
    (message) => message.role === "supervisor"
  );
  if (latestSupervisorMessage?.kind !== "question") {
    return undefined;
  }
  const latestStep = getGoalDiscoverySteps(intake).find(
    (step) => step.question.messageId === latestSupervisorMessage.messageId
  );
  return latestStep?.answer ? undefined : latestStep?.question;
}

export function getGoalDiscoverySteps(
  intake: GoalIntakeView
): GoalDiscoveryStepView[] {
  const steps: GoalDiscoveryStepView[] = [];
  let openStep: GoalDiscoveryStepView | undefined;
  for (const message of intake.messages) {
    if (message.role === "supervisor" && message.kind === "question") {
      openStep = {
        question: message,
        stepNumber: steps.length + 1,
      };
      steps.push(openStep);
      continue;
    }
    if (message.role === "user" && message.kind === "answer" && openStep) {
      openStep.answer = message;
      openStep = undefined;
      continue;
    }
    openStep = undefined;
  }
  return steps;
}

export function getGoalIntakeAnswerTargetKey(
  intake: GoalIntakeView
): string | undefined {
  const question = getCurrentGoalIntakeQuestion(intake);
  if (question) {
    return `question:${question.messageId}`;
  }
  const contract = getActiveGoalContract(intake);
  if (intake.status === "contract_ready" && contract) {
    return `contract:${contract.revisionId}:${contract.hash}`;
  }
  return undefined;
}

export function getActiveGoalContract(
  intake: GoalIntakeView
): GoalContractRevisionView | undefined {
  return intake.contractRevisions.find(
    (revision) => revision.revisionId === intake.activeContractRevisionId
  );
}

export function getMissingGoalConsultationProviders(
  intake: GoalIntakeView
): GoalConsultationProvider[] {
  const activeContract = getActiveGoalContract(intake);
  if (!activeContract) {
    return [...intake.providers];
  }
  const importedProviders = new Set(
    intake.consultations
      .filter(
        (consultation) =>
          consultation.status === "imported" &&
          consultation.contractRevisionId === activeContract.revisionId &&
          consultation.contractHash === activeContract.hash
      )
      .map((consultation) => consultation.provider)
  );
  return intake.providers.filter(
    (provider) => !importedProviders.has(provider)
  );
}

export function getGoalIntakePhases(
  intake: GoalIntakeView
): GoalIntakePhaseView[] {
  const activeContract = getActiveGoalContract(intake);
  const discoveryComplete =
    intake.status !== "interviewing" && Boolean(activeContract);
  const contract = discoveryComplete ? activeContract : undefined;
  const executionStarted =
    intake.status === "approved" ||
    intake.status === "converting" ||
    intake.status === "converted";
  const consultationComplete = Boolean(
    contract && getMissingGoalConsultationProviders(intake).length === 0
  );
  let consultState: GoalIntakePhaseState = "upcoming";
  if (executionStarted || consultationComplete) {
    consultState = "complete";
  } else if (contract) {
    consultState = "current";
  }
  let reviewState: GoalIntakePhaseState = "upcoming";
  if (executionStarted) {
    reviewState = "complete";
  } else if (contract && consultationComplete) {
    reviewState = "current";
  }
  let runState: GoalIntakePhaseState = "upcoming";
  if (intake.status === "converted") {
    runState = "complete";
  } else if (executionStarted) {
    runState = "current";
  }

  return [
    {
      id: "discover",
      label: "Discover",
      state: discoveryComplete ? "complete" : "current",
    },
    {
      id: "consult",
      label: "Consult",
      state: consultState,
    },
    {
      id: "review",
      label: "Review",
      state: reviewState,
    },
    {
      id: "run",
      label: "Run",
      state: runState,
    },
  ];
}

export function upsertGoalIntake<T extends GoalIntakeView>(
  current: T[] | undefined,
  update: T,
  includeConverted = false
): T[] {
  const existing = current ?? [];
  const previous = existing.find(
    (intake) => intake.intakeId === update.intakeId
  );
  if (previous && previous.revision > update.revision) {
    return existing;
  }
  const withoutUpdate = existing.filter(
    (intake) => intake.intakeId !== update.intakeId
  );
  if (!includeConverted && update.status === "converted") {
    return withoutUpdate;
  }
  return [update, ...withoutUpdate].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
}

export function createGoalIntakeAnswerIdempotencyKey(
  randomSuffix: () => string = defaultRandomSuffix
): string {
  const suffix = randomSuffix()
    .replaceAll(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 120);
  return `goal-answer-${suffix || Date.now().toString(36)}`;
}

export function ensureGoalIntakeAnswerDrafts(
  current: Record<string, GoalIntakeAnswerDraft>,
  targets: GoalIntakeAnswerTarget[],
  createKey: () => string = createGoalIntakeAnswerIdempotencyKey
): Record<string, GoalIntakeAnswerDraft> {
  let changed = false;
  const next = { ...current };
  const trackedIntakeIds = new Set(targets.map((target) => target.intakeId));
  for (const intakeId of Object.keys(next)) {
    if (!trackedIntakeIds.has(intakeId)) {
      delete next[intakeId];
      changed = true;
    }
  }
  for (const target of targets) {
    if (!target.targetKey) {
      if (next[target.intakeId]) {
        delete next[target.intakeId];
        changed = true;
      }
      continue;
    }
    if (next[target.intakeId]?.targetKey !== target.targetKey) {
      next[target.intakeId] = {
        message: "",
        idempotencyKey: createKey(),
        targetKey: target.targetKey,
      };
      changed = true;
    }
  }
  return changed ? next : current;
}

export async function copyGoalConsultationPacket(
  packet: string,
  clipboard: { writeText(text: string): Promise<void> } | undefined
): Promise<void> {
  if (!clipboard) {
    throw new Error("Clipboard access is unavailable.");
  }
  await clipboard.writeText(packet);
}

export async function openExternalGoalConsultation(
  provider: GoalConsultationProvider,
  launcher: ((provider: GoalConsultationProvider) => Promise<void>) | undefined
): Promise<void> {
  if (!launcher) {
    throw new Error("External AI consultation launcher is unavailable.");
  }
  await launcher(provider);
}

export async function runGoalIntakeMutationWithRecovery<T>(
  execute: () => Promise<T>,
  recover: () => Promise<unknown>
): Promise<T> {
  try {
    return await execute();
  } catch (error) {
    await recover().catch(() => undefined);
    throw error;
  }
}

function defaultRandomSuffix(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

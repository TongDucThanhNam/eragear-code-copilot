import {
  Check,
  ClipboardCopy,
  ExternalLink,
  LoaderCircle,
  RotateCcw,
  Send,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  type AnswerGoalIntakeClientInput,
  type ApproveGoalIntakeClientInput,
  type ConvertGoalIntakeClientInput,
  copyGoalConsultationPacket,
  createGoalIntakeAnswerIdempotencyKey,
  type ExportGoalConsultationClientInput,
  ensureGoalIntakeAnswerDrafts,
  type GoalConsultationProvider,
  type GoalIntakeAnswerDraft,
  type GoalIntakeView,
  getActiveGoalContract,
  getCurrentGoalIntakeQuestion,
  getGoalDiscoverySteps,
  getGoalIntakeAnswerTargetKey,
  getGoalIntakePhases,
  getMissingGoalConsultationProviders,
  type ImportGoalConsultationClientInput,
  openExternalGoalConsultation,
  type PreparedGoalConsultationsView,
  type PreparedGoalConsultationView,
  type PrepareGoalConsultationClientInput,
  type ResumeGoalIntakeClientInput,
} from "./managed-goal-intake";

const DEFAULT_CONSULTATION_REASON =
  "Challenge this goal for missing assumptions, risks, scope boundaries, and acceptance evidence.";

export interface ConsultationDraft {
  reason: string;
  providers: GoalConsultationProvider[];
}

export interface ManagedGoalIntakeActions {
  answer(input: AnswerGoalIntakeClientInput): Promise<GoalIntakeView>;
  resume(input: ResumeGoalIntakeClientInput): Promise<GoalIntakeView>;
  prepareConsultation(
    input: PrepareGoalConsultationClientInput
  ): Promise<PreparedGoalConsultationsView>;
  exportConsultation(
    input: ExportGoalConsultationClientInput
  ): Promise<PreparedGoalConsultationView>;
  importConsultation(
    input: ImportGoalConsultationClientInput
  ): Promise<GoalIntakeView>;
  approve(input: ApproveGoalIntakeClientInput): Promise<GoalIntakeView>;
  convert(input: ConvertGoalIntakeClientInput): Promise<GoalIntakeView>;
}

export interface ManagedGoalIntakeCardsProps {
  actions: ManagedGoalIntakeActions;
  error?: string | null;
  initialPreparedPackets?: Record<string, PreparedGoalConsultationView>;
  intakes: GoalIntakeView[];
  loading?: boolean;
  projectName: string;
}

export interface ManagedGoalIntakeCardProps {
  actionError?: string;
  answerDraft: GoalIntakeAnswerDraft;
  consultationDraft: ConsultationDraft;
  consultationResponses: Record<string, string>;
  intake: GoalIntakeView;
  pending: boolean;
  pendingAction?: string;
  preparedPackets: Record<string, PreparedGoalConsultationView>;
  projectName: string;
  onAnswerChange: (message: string) => void;
  onApprove: () => void;
  onConsultationReasonChange: (reason: string) => void;
  onConsultationResponseChange: (
    consultationId: string,
    response: string
  ) => void;
  onConvert: () => void;
  onCopyPacket: (packet: PreparedGoalConsultationView) => void;
  onImportConsultation: (consultationId: string) => void;
  onOpenProvider: (provider: GoalConsultationProvider) => void;
  onPrepareConsultation: () => void;
  onRecoverPacket: (consultationId: string) => void;
  onResume: () => void;
  onSendAnswer: () => void;
  onToggleConsultationProvider: (
    provider: GoalConsultationProvider,
    enabled: boolean
  ) => void;
}

export function ManagedGoalIntakeCards({
  actions,
  error,
  initialPreparedPackets = {},
  intakes,
  loading = false,
  projectName,
}: ManagedGoalIntakeCardsProps) {
  const [answerDrafts, setAnswerDrafts] = useState<
    Record<string, GoalIntakeAnswerDraft>
  >({});
  const [consultationDrafts, setConsultationDrafts] = useState<
    Record<string, ConsultationDraft>
  >({});
  const [consultationResponses, setConsultationResponses] = useState<
    Record<string, string>
  >({});
  const [preparedPackets, setPreparedPackets] = useState<
    Record<string, PreparedGoalConsultationView>
  >(initialPreparedPackets);
  const [pendingActions, setPendingActions] = useState<Record<string, string>>(
    {}
  );
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setAnswerDrafts((current) =>
      ensureGoalIntakeAnswerDrafts(
        current,
        intakes.map((intake) => ({
          intakeId: intake.intakeId,
          targetKey: getGoalIntakeAnswerTargetKey(intake),
        }))
      )
    );
  }, [intakes]);

  const clearAnswerDraft = (intakeId: string) => {
    setAnswerDrafts((current) => {
      if (!current[intakeId]) {
        return current;
      }
      const next = { ...current };
      delete next[intakeId];
      return next;
    });
  };

  const runAction = async <T,>(
    intakeId: string,
    action: string,
    execute: () => Promise<T>
  ): Promise<T | undefined> => {
    const actionKey = `${intakeId}:${action}`;
    setPendingActions((current) =>
      setGoalIntakePendingAction(current, intakeId, actionKey)
    );
    setActionErrors((current) => ({ ...current, [intakeId]: "" }));
    try {
      return await execute();
    } catch (actionError) {
      setActionErrors((current) => ({
        ...current,
        [intakeId]: toActionErrorMessage(actionError),
      }));
      return undefined;
    } finally {
      setPendingActions((current) =>
        clearGoalIntakePendingAction(current, intakeId, actionKey)
      );
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-dashed bg-card/50 p-6 text-center text-muted-foreground text-xs">
        Loading goal discovery…
      </div>
    );
  }
  if (error) {
    return (
      <div
        className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-destructive text-xs"
        role="alert"
      >
        {error}
      </div>
    );
  }
  if (intakes.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-card/50 p-6 text-center text-muted-foreground text-xs">
        No active goal discoveries for this project.
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {intakes.map((intake) => {
        const answerDraft = answerDrafts[intake.intakeId] ?? {
          message: "",
          idempotencyKey: "",
          targetKey: getGoalIntakeAnswerTargetKey(intake) ?? "",
        };
        const consultationDraft = consultationDrafts[intake.intakeId] ?? {
          reason: DEFAULT_CONSULTATION_REASON,
          providers: [...intake.providers],
        };
        const updateConsultationDraft = (
          update: (current: ConsultationDraft) => ConsultationDraft
        ) => {
          setConsultationDrafts((current) => ({
            ...current,
            [intake.intakeId]: update(
              current[intake.intakeId] ?? consultationDraft
            ),
          }));
        };

        return (
          <ManagedGoalIntakeCard
            actionError={actionErrors[intake.intakeId]}
            answerDraft={answerDraft}
            consultationDraft={consultationDraft}
            consultationResponses={consultationResponses}
            intake={intake}
            key={intake.intakeId}
            onAnswerChange={(message) => {
              const targetKey = getGoalIntakeAnswerTargetKey(intake);
              if (!targetKey) {
                return;
              }
              setAnswerDrafts((current) => {
                const existing = current[intake.intakeId];
                return {
                  ...current,
                  [intake.intakeId]: {
                    message,
                    idempotencyKey:
                      existing?.targetKey === targetKey
                        ? existing.idempotencyKey
                        : createGoalIntakeAnswerIdempotencyKey(),
                    targetKey,
                  },
                };
              });
            }}
            onApprove={() => {
              const contract = getActiveGoalContract(intake);
              if (!contract) {
                return;
              }
              return runAction(intake.intakeId, "approve", () =>
                actions.approve({
                  intakeId: intake.intakeId,
                  revisionId: contract.revisionId,
                  hash: contract.hash,
                  expectedRevision: intake.revision,
                })
              );
            }}
            onConsultationReasonChange={(reason) =>
              updateConsultationDraft((current) => ({ ...current, reason }))
            }
            onConsultationResponseChange={(consultationId, response) =>
              setConsultationResponses((current) => ({
                ...current,
                [consultationId]: response,
              }))
            }
            onConvert={() => {
              return runAction(intake.intakeId, "convert", () =>
                actions.convert({
                  intakeId: intake.intakeId,
                  expectedRevision: intake.revision,
                })
              );
            }}
            onCopyPacket={(packet) => {
              return runAction(
                intake.intakeId,
                `copy-${packet.consultationId}`,
                async () => {
                  await copyGoalConsultationPacket(
                    packet.packet,
                    navigator.clipboard
                  );
                  toast.success("Frozen consultation packet copied");
                }
              );
            }}
            onImportConsultation={(consultationId) => {
              const response = consultationResponses[consultationId]?.trim();
              if (!response) {
                return;
              }
              return runAction(
                intake.intakeId,
                `import-${consultationId}`,
                () =>
                  actions
                    .importConsultation({
                      intakeId: intake.intakeId,
                      consultationId,
                      response,
                      expectedRevision: intake.revision,
                    })
                    .then((updated) => {
                      setConsultationResponses((current) => ({
                        ...current,
                        [consultationId]: "",
                      }));
                      return updated;
                    })
              );
            }}
            onOpenProvider={(provider) => {
              return runAction(
                intake.intakeId,
                `open-${provider}`,
                async () => {
                  await openExternalGoalConsultation(
                    provider,
                    window.eragearDesktop?.openExternalAiConsultation
                  );
                }
              );
            }}
            onPrepareConsultation={() => {
              const reason = consultationDraft.reason.trim();
              if (!(reason && consultationDraft.providers.length > 0)) {
                return;
              }
              return runAction(intake.intakeId, "prepare-consultation", () =>
                actions
                  .prepareConsultation({
                    intakeId: intake.intakeId,
                    providers: consultationDraft.providers,
                    reason,
                    expectedRevision: intake.revision,
                  })
                  .then((prepared) => {
                    setPreparedPackets((current) => ({
                      ...current,
                      ...Object.fromEntries(
                        prepared.requests.map((request) => [
                          request.consultationId,
                          request,
                        ])
                      ),
                    }));
                    return prepared;
                  })
              );
            }}
            onRecoverPacket={(consultationId) => {
              return runAction(
                intake.intakeId,
                `recover-${consultationId}`,
                () =>
                  actions
                    .exportConsultation({
                      intakeId: intake.intakeId,
                      consultationId,
                    })
                    .then((packet) => {
                      setPreparedPackets((current) => ({
                        ...current,
                        [packet.consultationId]: packet,
                      }));
                      return packet;
                    })
              );
            }}
            onResume={() => {
              return runAction(intake.intakeId, "resume", () =>
                actions
                  .resume({
                    intakeId: intake.intakeId,
                    expectedRevision: intake.revision,
                  })
                  .then((updated) => {
                    clearAnswerDraft(intake.intakeId);
                    return updated;
                  })
              );
            }}
            onSendAnswer={() => {
              const message = answerDraft.message.trim();
              const currentTargetKey = getGoalIntakeAnswerTargetKey(intake);
              if (
                !(message && currentTargetKey) ||
                answerDraft.targetKey !== currentTargetKey
              ) {
                return;
              }
              const idempotencyKey =
                answerDraft.idempotencyKey ||
                createGoalIntakeAnswerIdempotencyKey();
              return runAction(intake.intakeId, "answer", () =>
                actions
                  .answer({
                    intakeId: intake.intakeId,
                    message,
                    expectedRevision: intake.revision,
                    idempotencyKey,
                  })
                  .then((updated) => {
                    clearAnswerDraft(intake.intakeId);
                    return updated;
                  })
              );
            }}
            onToggleConsultationProvider={(provider, enabled) =>
              updateConsultationDraft((current) => ({
                ...current,
                providers: enabled
                  ? [...new Set([...current.providers, provider])]
                  : current.providers.filter(
                      (candidate) => candidate !== provider
                    ),
              }))
            }
            pending={Boolean(pendingActions[intake.intakeId])}
            pendingAction={pendingActions[intake.intakeId]}
            preparedPackets={preparedPackets}
            projectName={projectName}
          />
        );
      })}
    </div>
  );
}

export function ManagedGoalIntakeCard({
  actionError,
  answerDraft,
  consultationDraft,
  consultationResponses,
  intake,
  pending,
  pendingAction,
  preparedPackets,
  projectName,
  onAnswerChange,
  onApprove,
  onConsultationReasonChange,
  onConsultationResponseChange,
  onConvert,
  onCopyPacket,
  onImportConsultation,
  onOpenProvider,
  onPrepareConsultation,
  onRecoverPacket,
  onResume,
  onSendAnswer,
  onToggleConsultationProvider,
}: ManagedGoalIntakeCardProps) {
  const id = useId();
  const currentQuestion = getCurrentGoalIntakeQuestion(intake);
  const discoverySteps = getGoalDiscoverySteps(intake);
  const contract = getActiveGoalContract(intake);
  const contractHasOpenQuestions = Boolean(
    contract?.unresolvedQuestions.length
  );
  const missingConsultationProviders =
    getMissingGoalConsultationProviders(intake);
  const consultationIsCurrent =
    getGoalIntakePhases(intake).find((phase) => phase.id === "consult")
      ?.state === "current";
  const reasoningMutationPending =
    pendingAction === `${intake.intakeId}:answer` ||
    pendingAction === `${intake.intakeId}:resume`;
  const reasoningActive =
    intake.reasoningState === "active" || reasoningMutationPending;
  const effectivePendingReasoning =
    intake.pendingReasoning || reasoningMutationPending;
  const isTerminal =
    intake.status === "converted" || intake.status === "cancelled";

  return (
    <article className="grid gap-4 rounded-xl border bg-card p-4 shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium text-sm">
            {intake.title ?? "Untitled goal discovery"}
          </h3>
          <p className="mt-1 text-muted-foreground text-xs">
            Project · {projectName} · revision {intake.revision}
          </p>
          <p className="mt-1 text-muted-foreground text-xs">
            {intake.depth} discovery · round {intake.discoveryRoundCount}/
            {intake.minimumDiscoveryRounds} minimum
          </p>
        </div>
        <Badge
          variant={
            intake.reasoningState !== "active" && intake.reasoningError
              ? "destructive"
              : "outline"
          }
        >
          {intake.status.replaceAll("_", " ")}
        </Badge>
      </header>

      <GoalIntakePhaseRail intake={intake} />

      <details className="rounded-lg border bg-background px-3 py-2">
        <summary className="cursor-pointer font-medium text-xs">
          Goal brief
        </summary>
        <p className="mt-2 whitespace-pre-wrap text-xs/relaxed">
          {intake.roughOutcome}
        </p>
      </details>

      <GoalDiscoveryTimeline
        currentQuestion={currentQuestion}
        intake={intake}
        reasoningActive={reasoningActive}
        steps={discoverySteps}
      />

      {!isTerminal &&
      contract &&
      (intake.providers.length > 0 || intake.consultations.length > 0) ? (
        <ExternalAdvisoryPanel
          consultationDraft={consultationDraft}
          consultationResponses={consultationResponses}
          editable={consultationIsCurrent}
          id={id}
          intake={intake}
          onConsultationReasonChange={onConsultationReasonChange}
          onConsultationResponseChange={onConsultationResponseChange}
          onCopyPacket={onCopyPacket}
          onImportConsultation={onImportConsultation}
          onOpenProvider={onOpenProvider}
          onPrepareConsultation={onPrepareConsultation}
          onRecoverPacket={onRecoverPacket}
          onToggleConsultationProvider={onToggleConsultationProvider}
          open={consultationIsCurrent}
          pending={pending}
          preparedPackets={preparedPackets}
        />
      ) : null}

      {contract ? (
        <details
          className="rounded-lg border bg-background px-3 py-2"
          open={intake.status === "contract_ready" && !consultationIsCurrent}
        >
          <summary className="cursor-pointer font-medium text-xs">
            Review Goal Contract v{contract.revision}
          </summary>
          <div className="mt-3">
            <GoalContractReview contract={contract} />
          </div>
        </details>
      ) : null}

      {(intake.status === "approved" || intake.status === "converting") &&
      contract ? (
        <ConversionActionDock onConvert={onConvert} pending={pending} />
      ) : null}

      {intake.convertedRunId ? (
        <p className="font-mono text-[11px] text-muted-foreground">
          Managed run: {intake.convertedRunId}
        </p>
      ) : null}

      {actionError ? (
        <p
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-destructive text-xs"
          role="alert"
        >
          {actionError}
        </p>
      ) : null}

      {effectivePendingReasoning ? (
        <ReasoningActionDock
          active={reasoningActive}
          error={intake.reasoningError}
          onResume={onResume}
          pending={pending}
        />
      ) : null}

      {!effectivePendingReasoning &&
      intake.status === "interviewing" &&
      currentQuestion ? (
        <AnswerActionDock
          answerDraft={answerDraft}
          id={id}
          onAnswerChange={onAnswerChange}
          onSendAnswer={onSendAnswer}
          pending={pending}
        />
      ) : null}

      {!effectivePendingReasoning &&
      intake.status === "contract_ready" &&
      contract &&
      !consultationIsCurrent ? (
        <ContractReviewActionDock
          answerDraft={answerDraft}
          contract={contract}
          contractHasOpenQuestions={contractHasOpenQuestions}
          id={id}
          missingConsultationProviders={missingConsultationProviders}
          onAnswerChange={onAnswerChange}
          onApprove={onApprove}
          onSendAnswer={onSendAnswer}
          pending={pending}
        />
      ) : null}
      {pendingAction ? (
        <p aria-live="polite" className="sr-only">
          Goal discovery action in progress: {pendingAction}
        </p>
      ) : null}
    </article>
  );
}

function GoalIntakePhaseRail({ intake }: { intake: GoalIntakeView }) {
  const phases = getGoalIntakePhases(intake);
  return (
    <nav aria-label="Goal intake progress">
      <ol className="grid grid-cols-4 overflow-hidden rounded-lg border bg-background">
        {phases.map((phase, index) => (
          <li
            aria-current={phase.state === "current" ? "step" : undefined}
            aria-label={`${phase.label}: ${phase.state}`}
            className={`relative flex min-w-0 items-center gap-2 px-2 py-2.5 text-[11px] sm:px-3 ${
              index > 0 ? "border-l" : ""
            } ${
              phase.state === "current"
                ? "bg-primary/8 text-foreground"
                : "text-muted-foreground"
            }`}
            key={phase.id}
          >
            <span
              className={`flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] ${getPhaseIndicatorClass(phase.state)}`}
            >
              {phase.state === "complete" ? (
                <Check className="size-3" />
              ) : (
                index + 1
              )}
            </span>
            <span className="truncate font-medium">{phase.label}</span>
            <span className="sr-only"> · {phase.state}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function getPhaseIndicatorClass(
  state: ReturnType<typeof getGoalIntakePhases>[number]["state"]
): string {
  if (state === "complete") {
    return "border-primary bg-primary text-primary-foreground";
  }
  if (state === "current") {
    return "border-primary text-primary";
  }
  return "border-muted-foreground/30";
}

function GoalDiscoveryTimeline({
  currentQuestion,
  intake,
  reasoningActive,
  steps,
}: {
  currentQuestion?: ReturnType<typeof getCurrentGoalIntakeQuestion>;
  intake: GoalIntakeView;
  reasoningActive: boolean;
  steps: ReturnType<typeof getGoalDiscoverySteps>;
}) {
  const completedSteps = steps.filter((step) => step.answer);
  const effectivePendingReasoning = intake.pendingReasoning || reasoningActive;
  const activeStep = currentQuestion
    ? steps.find(
        (step) => step.question.messageId === currentQuestion.messageId
      )
    : undefined;
  const nextStepNumber = activeStep?.stepNumber ?? completedSteps.length + 1;

  return (
    <section aria-labelledby={`${intake.intakeId}-discovery-heading`}>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h4
            className="font-medium text-sm"
            id={`${intake.intakeId}-discovery-heading`}
          >
            Discovery interview
          </h4>
          <p className="mt-0.5 text-muted-foreground text-xs">
            {completedSteps.length} answer
            {completedSteps.length === 1 ? "" : "s"} captured · target at least{" "}
            {intake.minimumDiscoveryRounds} rounds
          </p>
        </div>
        <Badge variant="secondary">
          {intake.status === "interviewing" ? "In progress" : "Complete"}
        </Badge>
      </div>

      <ol className="grid gap-2">
        {completedSteps.map((step) => (
          <li key={step.question.messageId}>
            <details className="group rounded-lg border bg-background px-3 py-2">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-xs [&::-webkit-details-marker]:hidden">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-3" />
                </span>
                <span className="font-medium">Step {step.stepNumber}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {step.question.content}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  Complete
                </span>
              </summary>
              <div className="mt-3 ml-7 grid gap-3 border-l pl-3 text-xs/relaxed">
                <div>
                  <p className="font-medium text-muted-foreground">
                    Supervisor
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">
                    {step.question.content}
                  </p>
                </div>
                <div>
                  <p className="font-medium text-muted-foreground">You</p>
                  <p className="mt-1 whitespace-pre-wrap">
                    {step.answer?.content}
                  </p>
                </div>
              </div>
            </details>
          </li>
        ))}

        {effectivePendingReasoning ? (
          <li>
            <section
              aria-live="polite"
              className={`rounded-lg border p-3 ${getReasoningStepClassName(
                reasoningActive,
                Boolean(intake.reasoningError)
              )}`}
            >
              <div className="flex items-start gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-primary text-primary">
                  {reasoningActive ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    nextStepNumber
                  )}
                </span>
                <div>
                  <p className="font-medium text-xs">
                    Step {nextStepNumber} ·{" "}
                    {getReasoningStepTitle(
                      reasoningActive,
                      Boolean(intake.reasoningError)
                    )}
                  </p>
                  <p className="mt-1 text-muted-foreground text-xs">
                    {getReasoningStepDescription(
                      reasoningActive,
                      intake.reasoningError
                    )}
                  </p>
                </div>
              </div>
            </section>
          </li>
        ) : null}

        {!effectivePendingReasoning && activeStep ? (
          <li>
            <section
              aria-labelledby={`${intake.intakeId}-active-question`}
              className="rounded-lg border border-primary/40 bg-primary/5 p-3"
            >
              <div className="flex items-start gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-primary font-medium text-primary text-xs">
                  {activeStep.stepNumber}
                </span>
                <div>
                  <p
                    className="font-medium text-[11px] text-primary uppercase tracking-wide"
                    id={`${intake.intakeId}-active-question`}
                  >
                    Current question
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm/relaxed">
                    {activeStep.question.content}
                  </p>
                </div>
              </div>
            </section>
          </li>
        ) : null}
      </ol>
    </section>
  );
}

function getReasoningStepTitle(
  activeMutation: boolean,
  hasError: boolean
): string {
  if (activeMutation) {
    return "Supervisor is shaping the next question";
  }
  return hasError ? "Reasoning paused" : "Reasoning turn pending";
}

function getReasoningStepClassName(active: boolean, hasError: boolean): string {
  if (active) {
    return "border-primary/30 bg-primary/5";
  }
  return hasError ? "border-amber-500/40 bg-amber-500/5" : "bg-muted/30";
}

function getReasoningStepDescription(active: boolean, error?: string): string {
  if (active) {
    return "The Supervisor still owns this durable turn. You can leave this page while it finishes.";
  }
  if (error) {
    return error;
  }
  return "The durable turn is not active. Resume it without resending your answer, or return later.";
}

function AnswerActionDock({
  answerDraft,
  id,
  onAnswerChange,
  onSendAnswer,
  pending,
}: Pick<
  ManagedGoalIntakeCardProps,
  "answerDraft" | "onAnswerChange" | "onSendAnswer" | "pending"
> & { id: string }) {
  return (
    <section
      aria-label="Answer the current Supervisor question"
      className="sticky bottom-0 z-20 -mx-4 -mb-4 grid gap-2 border-t bg-card/95 p-3 shadow-[0_-8px_24px_-20px_rgba(0,0,0,0.8)] backdrop-blur sm:p-4"
    >
      <Label htmlFor={`${id}-answer`}>Your answer</Label>
      <Textarea
        aria-label="Answer the current Supervisor question"
        className="min-h-20 resize-y bg-background"
        disabled={pending}
        id={`${id}-answer`}
        maxLength={16_000}
        onChange={(event) => onAnswerChange(event.target.value)}
        placeholder="Add constraints, evidence, tradeoffs, or correct the premise"
        value={answerDraft.message}
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-xs">
          This advances discovery only. No worker starts yet.
        </p>
        <Button
          className="w-full gap-1.5 sm:w-auto"
          disabled={pending || !answerDraft.message.trim()}
          onClick={onSendAnswer}
          size="sm"
          type="button"
        >
          <Send className="size-3.5" />{" "}
          {pending ? "Sending…" : "Answer & continue"}
        </Button>
      </div>
    </section>
  );
}

function ReasoningActionDock({
  active,
  error,
  onResume,
  pending,
}: {
  active: boolean;
  error?: string;
  onResume: () => void;
  pending: boolean;
}) {
  return (
    <section className="sticky bottom-0 z-20 -mx-4 -mb-4 flex flex-col gap-3 border-t bg-card/95 p-3 shadow-[0_-8px_24px_-20px_rgba(0,0,0,0.8)] backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:p-4">
      <div className="flex items-center gap-2">
        {active ? (
          <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" />
        ) : (
          <RotateCcw
            className={`size-4 shrink-0 ${error ? "text-amber-500" : "text-muted-foreground"}`}
          />
        )}
        <div>
          <p className="font-medium text-xs">
            {active
              ? "Reasoning in progress"
              : "The durable turn is ready to resume"}
          </p>
          <p className="mt-0.5 text-muted-foreground text-xs">
            {active
              ? "The Supervisor still owns this turn. You can leave this page while it finishes."
              : "Resume the same persisted turn without resending your answer."}
          </p>
        </div>
      </div>
      {active ? null : (
        <Button
          className="w-full shrink-0 gap-1.5 sm:w-auto"
          disabled={pending}
          onClick={onResume}
          size="sm"
          type="button"
          variant="outline"
        >
          <RotateCcw className="size-3.5" />{" "}
          {error ? "Retry current turn" : "Resume pending turn"}
        </Button>
      )}
    </section>
  );
}

function ContractReviewActionDock({
  answerDraft,
  contract,
  contractHasOpenQuestions,
  id,
  missingConsultationProviders,
  onAnswerChange,
  onApprove,
  onSendAnswer,
  pending,
}: Pick<
  ManagedGoalIntakeCardProps,
  "answerDraft" | "onAnswerChange" | "onApprove" | "onSendAnswer" | "pending"
> & {
  contract: NonNullable<ReturnType<typeof getActiveGoalContract>>;
  contractHasOpenQuestions: boolean;
  id: string;
  missingConsultationProviders: GoalConsultationProvider[];
}) {
  const approvalBlocked =
    contractHasOpenQuestions || missingConsultationProviders.length > 0;
  return (
    <section className="sticky bottom-0 z-20 -mx-4 -mb-4 grid gap-2 border-t bg-card/95 p-3 shadow-[0_-8px_24px_-20px_rgba(0,0,0,0.8)] backdrop-blur sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={`${id}-contract-challenge`}>
          Challenge or revise this contract
        </Label>
        <span className="font-mono text-[10px] text-muted-foreground">
          v{contract.revision} · {contract.hash.slice(0, 10)}
        </span>
      </div>
      <Textarea
        aria-label="Challenge or revise this contract"
        className="min-h-16 resize-y bg-background"
        disabled={pending}
        id={`${id}-contract-challenge`}
        maxLength={16_000}
        onChange={(event) => onAnswerChange(event.target.value)}
        placeholder="Optional: challenge assumptions, scope, or acceptance evidence"
        value={answerDraft.message}
      />
      {approvalBlocked ? (
        <p className="text-amber-600 text-xs dark:text-amber-400">
          {contractHasOpenQuestions
            ? "Resolve every open contract question before approval."
            : `Finish the ${missingConsultationProviders
                .map((provider) =>
                  provider === "chatgpt" ? "ChatGPT" : "Gemini"
                )
                .join(" and ")} consultation before approval.`}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          disabled={pending || !answerDraft.message.trim()}
          onClick={onSendAnswer}
          size="sm"
          type="button"
          variant="outline"
        >
          <Send className="mr-1.5 size-3.5" /> Send challenge
        </Button>
        <Button
          className="gap-1.5"
          disabled={pending || approvalBlocked}
          onClick={onApprove}
          size="sm"
          type="button"
        >
          <ShieldCheck className="size-3.5" /> Approve contract &amp; create run
        </Button>
      </div>
    </section>
  );
}

function ConversionActionDock({
  onConvert,
  pending,
}: Pick<ManagedGoalIntakeCardProps, "onConvert" | "pending">) {
  return (
    <section className="sticky bottom-0 z-20 -mx-4 -mb-4 flex flex-col gap-3 border-t bg-card/95 p-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:p-4">
      <div>
        <p className="font-medium text-xs">Conversion needs recovery</p>
        <p className="mt-1 text-muted-foreground text-xs">
          Continue the exact approved revision without approving it again.
        </p>
      </div>
      <Button
        className="w-full shrink-0 gap-1.5 sm:w-auto"
        disabled={pending}
        onClick={onConvert}
        size="sm"
        type="button"
        variant="outline"
      >
        <RotateCcw className="size-3.5" /> Resume conversion
      </Button>
    </section>
  );
}

type ExternalAdvisoryPanelProps = Pick<
  ManagedGoalIntakeCardProps,
  | "consultationDraft"
  | "consultationResponses"
  | "intake"
  | "onConsultationReasonChange"
  | "onConsultationResponseChange"
  | "onCopyPacket"
  | "onImportConsultation"
  | "onOpenProvider"
  | "onPrepareConsultation"
  | "onRecoverPacket"
  | "onToggleConsultationProvider"
  | "pending"
  | "preparedPackets"
> & { editable: boolean; id: string; open: boolean };

function ExternalAdvisoryPanel({
  consultationDraft,
  consultationResponses,
  editable,
  id,
  intake,
  onConsultationReasonChange,
  onConsultationResponseChange,
  onCopyPacket,
  onImportConsultation,
  onOpenProvider,
  onPrepareConsultation,
  onRecoverPacket,
  onToggleConsultationProvider,
  open,
  pending,
  preparedPackets,
}: ExternalAdvisoryPanelProps) {
  return (
    <details className="rounded-lg border bg-background px-3 py-2" open={open}>
      <summary className="cursor-pointer font-medium text-xs">
        {editable ? "Consult external advisors" : "External advisory history"}
        {intake.consultations.length > 0
          ? ` · ${intake.consultations.length} packet${intake.consultations.length === 1 ? "" : "s"}`
          : ""}
      </summary>
      <div className="mt-3 grid gap-3 border-t pt-3">
        {editable ? (
          <>
            <div>
              <p className="text-muted-foreground text-xs">
                External output is advisory. Importing it resumes Supervisor
                discovery; it never approves the contract or starts execution.
              </p>
              <p className="mt-1 text-muted-foreground text-xs">
                This is a secure manual bridge: copy the frozen packet, open
                ChatGPT or Gemini in your default browser to reuse its existing
                login, paste the packet there, then import the response. Eragear
                does not read or control the external page and never reads your
                clipboard; it writes only this packet when you click Copy.
                Automatically gathered project context is limited to sanitized,
                repo-relative paths, symbols, and route structure; it excludes
                source excerpts, vault content, diffs, environment values, and
                credential values. Your consultation request, Goal rough
                outcome, interview messages, and contract text are included
                verbatim and may contain secrets. Eragear does not scan or
                redact that user-authored text. Review and scrub it before Copy
                or send.
              </p>
            </div>
            {intake.providers.length > 0 ? (
              <div className="flex flex-wrap gap-4">
                {intake.providers.map((provider) => (
                  <Label
                    className="flex items-center gap-2 text-xs"
                    htmlFor={`${id}-prepare-${provider}`}
                    key={provider}
                  >
                    <Checkbox
                      checked={consultationDraft.providers.includes(provider)}
                      disabled={pending}
                      id={`${id}-prepare-${provider}`}
                      onCheckedChange={(checked) =>
                        onToggleConsultationProvider(provider, checked === true)
                      }
                    />
                    {provider === "chatgpt" ? "ChatGPT" : "Gemini"}
                  </Label>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">
                No external advisors were enabled for this discovery.
              </p>
            )}
            <Textarea
              aria-label={`Consultation reason for ${intake.intakeId}`}
              className="min-h-20 resize-y bg-background"
              disabled={pending}
              maxLength={4000}
              onChange={(event) =>
                onConsultationReasonChange(event.target.value)
              }
              value={consultationDraft.reason}
            />
            <div className="flex justify-end">
              <Button
                disabled={
                  pending ||
                  consultationDraft.providers.length === 0 ||
                  !consultationDraft.reason.trim()
                }
                onClick={onPrepareConsultation}
                size="sm"
                type="button"
                variant="outline"
              >
                Prepare frozen packet
              </Button>
            </div>
          </>
        ) : (
          <p className="text-muted-foreground text-xs">
            Consultation controls are closed outside the Consult phase. Previous
            advisor evidence remains readable below.
          </p>
        )}
        {intake.consultations.map((consultation) => (
          <ConsultationPacket
            consultation={consultation}
            editable={editable}
            id={id}
            key={consultation.consultationId}
            onConsultationResponseChange={onConsultationResponseChange}
            onCopyPacket={onCopyPacket}
            onImportConsultation={onImportConsultation}
            onOpenProvider={onOpenProvider}
            onRecoverPacket={onRecoverPacket}
            packet={preparedPackets[consultation.consultationId]}
            pending={pending}
            response={consultationResponses[consultation.consultationId] ?? ""}
          />
        ))}
      </div>
    </details>
  );
}

function ConsultationPacket({
  consultation,
  editable,
  id,
  onConsultationResponseChange,
  onCopyPacket,
  onImportConsultation,
  onOpenProvider,
  onRecoverPacket,
  packet,
  pending,
  response,
}: Pick<
  ManagedGoalIntakeCardProps,
  | "onConsultationResponseChange"
  | "onCopyPacket"
  | "onImportConsultation"
  | "onOpenProvider"
  | "onRecoverPacket"
  | "pending"
> & {
  consultation: GoalIntakeView["consultations"][number];
  editable: boolean;
  id: string;
  packet?: PreparedGoalConsultationView;
  response: string;
}) {
  const providerLabel =
    consultation.provider === "chatgpt" ? "ChatGPT" : "Gemini";
  return (
    <article className="grid gap-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-xs">{providerLabel}</p>
          <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
            packet {consultation.packetHash}
          </p>
          {consultation.contractRevisionId ? (
            <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
              contract {consultation.contractRevisionId} ·{" "}
              {consultation.contractHash}
            </p>
          ) : null}
        </div>
        <Badge variant="outline">{consultation.status}</Badge>
      </div>
      <p className="text-muted-foreground text-xs">{consultation.reason}</p>
      {editable && packet ? (
        <>
          <Textarea
            aria-label={`${providerLabel} frozen consultation packet`}
            className="max-h-64 min-h-32 resize-y bg-muted/20 font-mono text-[11px]"
            readOnly
            value={packet.packet}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              className="gap-1.5"
              disabled={pending}
              onClick={() => onCopyPacket(packet)}
              size="sm"
              type="button"
              variant="outline"
            >
              <ClipboardCopy className="size-3.5" /> Copy packet
            </Button>
            <Button
              className="gap-1.5"
              disabled={pending}
              onClick={() => onOpenProvider(consultation.provider)}
              size="sm"
              type="button"
              variant="outline"
            >
              <ExternalLink className="size-3.5" /> Open {providerLabel}
            </Button>
          </div>
        </>
      ) : null}
      {editable && !packet && consultation.status === "prepared" ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">
            Recover the exact frozen body before copying it.
          </p>
          <Button
            disabled={pending}
            onClick={() => onRecoverPacket(consultation.consultationId)}
            size="sm"
            type="button"
            variant="outline"
          >
            Recover frozen packet
          </Button>
        </div>
      ) : null}
      {editable && consultation.status === "prepared" ? (
        <div className="grid gap-2 border-t pt-3">
          <Label htmlFor={`${id}-response-${consultation.consultationId}`}>
            Paste the advisor response
          </Label>
          <Textarea
            className="min-h-28 resize-y bg-background"
            disabled={pending}
            id={`${id}-response-${consultation.consultationId}`}
            maxLength={64_000}
            onChange={(event) =>
              onConsultationResponseChange(
                consultation.consultationId,
                event.target.value
              )
            }
            placeholder={`Paste ${providerLabel}'s advisory output exactly as returned`}
            value={response}
          />
          <p className="text-muted-foreground text-xs">
            Keep the final <code>RESULT {consultation.consultationId}</code>{" "}
            line so Eragear can reject a response pasted from another packet.
          </p>
          <div className="flex justify-end">
            <Button
              disabled={pending || !response.trim()}
              onClick={() => onImportConsultation(consultation.consultationId)}
              size="sm"
              type="button"
            >
              Import advisory result
            </Button>
          </div>
        </div>
      ) : null}
      {consultation.status === "imported" && consultation.result ? (
        <details className="border-t pt-3">
          <summary className="cursor-pointer font-medium text-xs">
            Imported advisory result
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-xs/relaxed">
            {consultation.result.response}
          </p>
        </details>
      ) : null}
    </article>
  );
}

function GoalContractReview({
  contract,
}: {
  contract: NonNullable<ReturnType<typeof getActiveGoalContract>>;
}) {
  return (
    <section className="grid gap-3 rounded-lg border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-sm">
            Goal Contract v{contract.revision}
          </p>
          <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
            {contract.revisionId} · {contract.hash}
          </p>
        </div>
        <Badge variant="secondary">Review exact revision</Badge>
      </div>
      <div>
        <p className="font-medium text-xs">{contract.title}</p>
        <p className="mt-1 whitespace-pre-wrap text-xs/relaxed">
          {contract.objective}
        </p>
      </div>
      <ContractList
        empty="No locked strategic decisions."
        items={contract.lockedStrategicDecisions}
        title="Locked strategic decisions"
      />
      <ContractList
        empty="No assumptions recorded."
        items={contract.assumptions}
        title="Assumptions"
      />
      <ContractList
        empty="No non-goals recorded."
        items={contract.nonGoals}
        title="Non-goals"
      />
      <ContractList
        empty="No change boundary recorded."
        items={contract.changeBoundary}
        title="Change boundary"
      />
      <div>
        <p className="font-medium text-xs">Acceptance criteria</p>
        <ul className="mt-1 grid gap-1 text-xs">
          {contract.acceptanceCriteria.map((criterion) => (
            <li
              className="rounded border bg-muted/20 p-2"
              key={criterion.criterionId}
            >
              <span className="font-mono text-[10px] text-muted-foreground">
                {criterion.criterionId} · {criterion.evidence}
              </span>
              <p className="mt-1">{criterion.statement}</p>
            </li>
          ))}
        </ul>
      </div>
      <ContractList
        empty="No trusted verification commands recorded."
        items={contract.trustedVerificationCommands}
        monospace
        title="Trusted verification"
      />
      <div>
        <p className="font-medium text-xs">Authority</p>
        <dl className="mt-1 grid gap-1 text-xs sm:grid-cols-2">
          {Object.entries(contract.authority).map(([boundary, policy]) => (
            <div
              className="flex justify-between gap-2 rounded border bg-muted/20 px-2 py-1"
              key={boundary}
            >
              <dt>{boundary}</dt>
              <dd className="font-mono">{policy}</dd>
            </div>
          ))}
        </dl>
      </div>
      <ContractList
        empty="No unresolved questions."
        items={contract.unresolvedQuestions}
        title="Unresolved questions"
      />
    </section>
  );
}

function ContractList({
  empty,
  items,
  monospace = false,
  title,
}: {
  empty: string;
  items: string[];
  monospace?: boolean;
  title: string;
}) {
  return (
    <div>
      <p className="font-medium text-xs">{title}</p>
      {items.length > 0 ? (
        <ul
          className={`mt-1 list-disc space-y-1 pl-4 text-xs ${
            monospace ? "font-mono" : ""
          }`}
        >
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-muted-foreground text-xs">{empty}</p>
      )}
    </div>
  );
}

function toActionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Goal discovery action failed. Your input is still here.";
}

export function setGoalIntakePendingAction(
  current: Record<string, string>,
  intakeId: string,
  actionKey: string
): Record<string, string> {
  return { ...current, [intakeId]: actionKey };
}

export function clearGoalIntakePendingAction(
  current: Record<string, string>,
  intakeId: string,
  expectedActionKey: string
): Record<string, string> {
  if (current[intakeId] !== expectedActionKey) {
    return current;
  }
  const next = { ...current };
  delete next[intakeId];
  return next;
}

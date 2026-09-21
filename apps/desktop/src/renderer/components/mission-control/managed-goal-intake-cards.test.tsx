import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  type GoalContractRevisionView,
  type GoalIntakeView,
  getGoalIntakeAnswerTargetKey,
  type PreparedGoalConsultationView,
} from "./managed-goal-intake";
import {
  type ConsultationDraft,
  clearGoalIntakePendingAction,
  ManagedGoalIntakeCard,
  type ManagedGoalIntakeCardProps,
  ManagedGoalIntakeCards,
  setGoalIntakePendingAction,
} from "./managed-goal-intake-cards";

const HASH = "b".repeat(64);
const PACKET_HASH = "c".repeat(64);
const NOW = "2026-08-18T08:00:00.000Z";
const noAction = () => undefined;

const contract: GoalContractRevisionView = {
  revisionId: "contract-7",
  intakeId: "intake-1",
  revision: 7,
  hash: HASH,
  title: "Production cutover",
  objective: "Reach a reviewable production checkpoint.",
  lockedStrategicDecisions: ["SQLite is execution truth."],
  assumptions: ["The runtime can restart."],
  nonGoals: ["No autonomous architecture changes."],
  changeBoundary: ["apps/desktop/src/renderer"],
  acceptanceCriteria: [
    {
      criterionId: "criterion-1",
      statement: "Goal discovery is durable.",
      evidence: "machine",
    },
  ],
  trustedVerificationCommands: ["bun test"],
  authority: {
    scopedCodeChange: "auto",
    architectureChange: "ask",
    dependencyChange: "ask",
    destructiveAction: "ask",
    finalIntegration: "ask",
  },
  unresolvedQuestions: [],
  createdAt: NOW,
};

const packet: PreparedGoalConsultationView = {
  consultationId: "consultation-chatgpt",
  provider: "chatgpt",
  status: "prepared",
  reason: "Challenge the boundary.",
  packet: "# Frozen goal consultation packet",
  packetHash: PACKET_HASH,
  contractRevisionId: contract.revisionId,
  contractHash: contract.hash,
  createdAt: NOW,
};

function createIntake(overrides: Partial<GoalIntakeView> = {}): GoalIntakeView {
  return {
    intakeId: "intake-1",
    revision: 9,
    projectId: "project-1",
    title: "Production cutover",
    roughOutcome: "Reach a reviewable checkpoint without babysitting.",
    depth: "exhaustive",
    providers: ["chatgpt", "gemini"],
    status: "interviewing",
    discoveryRoundCount: 2,
    minimumDiscoveryRounds: 3,
    messages: [
      {
        messageId: "message-1",
        role: "user",
        kind: "seed",
        content: "Reach a reviewable checkpoint.",
        createdAt: NOW,
      },
      {
        messageId: "message-2",
        role: "supervisor",
        kind: "question",
        content: "What evidence makes the checkpoint reviewable?",
        createdAt: NOW,
      },
    ],
    pendingReasoning: false,
    reasoningState: "idle",
    contractRevisions: [],
    consultations: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const consultationDraft: ConsultationDraft = {
  reason: "Challenge the goal.",
  providers: ["chatgpt", "gemini"],
};

function createCardProps(
  intake: GoalIntakeView,
  overrides: Partial<ManagedGoalIntakeCardProps> = {}
): ManagedGoalIntakeCardProps {
  return {
    answerDraft: {
      message: "",
      idempotencyKey: "answer-key-1",
      targetKey: getGoalIntakeAnswerTargetKey(intake) ?? "",
    },
    consultationDraft,
    consultationResponses: {},
    intake,
    pending: false,
    preparedPackets: {},
    projectName: "Eragear",
    onAnswerChange: noAction,
    onApprove: noAction,
    onConsultationReasonChange: noAction,
    onConsultationResponseChange: noAction,
    onConvert: noAction,
    onCopyPacket: noAction,
    onImportConsultation: noAction,
    onOpenProvider: noAction,
    onPrepareConsultation: noAction,
    onRecoverPacket: noAction,
    onResume: noAction,
    onSendAnswer: noAction,
    onToggleConsultationProvider: noAction,
    ...overrides,
  };
}

describe("ManagedGoalIntakeCards", () => {
  test("tracks simultaneous actions independently by intake", () => {
    const withFirst = setGoalIntakePendingAction(
      {},
      "intake-1",
      "intake-1:answer"
    );
    const withBoth = setGoalIntakePendingAction(
      withFirst,
      "intake-2",
      "intake-2:resume"
    );

    expect(withBoth).toEqual({
      "intake-1": "intake-1:answer",
      "intake-2": "intake-2:resume",
    });
    expect(
      clearGoalIntakePendingAction(withBoth, "intake-1", "stale-action-key")
    ).toBe(withBoth);
    expect(
      clearGoalIntakePendingAction(withBoth, "intake-1", "intake-1:answer")
    ).toEqual({ "intake-2": "intake-2:resume" });
  });

  test("renders completed question-answer steps and one active question", () => {
    const intake = createIntake({
      messages: [
        ...createIntake().messages,
        {
          messageId: "message-3",
          role: "user",
          kind: "answer",
          content: "A passing production smoke run and a reviewable diff.",
          createdAt: NOW,
        },
        {
          messageId: "message-4",
          role: "supervisor",
          kind: "question",
          content: "Which rollout boundary must remain locked?",
          createdAt: NOW,
        },
      ],
    });
    const html = renderToStaticMarkup(
      <ManagedGoalIntakeCards
        actions={{
          answer: async (input) =>
            createIntake({ revision: input.expectedRevision + 1 }),
          resume: async (input) =>
            createIntake({ revision: input.expectedRevision + 1 }),
          prepareConsultation: async () => ({
            intake: createIntake(),
            requests: [],
          }),
          exportConsultation: async () => packet,
          importConsultation: async () => createIntake(),
          approve: async () => createIntake(),
          convert: async () => createIntake(),
        }}
        intakes={[intake]}
        projectName="Eragear"
      />
    );

    expect(html).toContain("Goal intake progress");
    expect(html).toContain("Discover");
    expect(html).toContain("Consult");
    expect(html).toContain("Review");
    expect(html).toContain("Run");
    expect(html).toContain('aria-label="Discover: current"');
    expect(html).toContain('aria-label="Consult: upcoming"');
    expect(html).toContain("Project · Eragear · revision 9");
    expect(html).not.toContain("intake-1 · revision");
    expect(html).toContain("Step 1");
    expect(html).toContain("Complete");
    expect(html).toContain("What evidence makes the checkpoint reviewable?");
    expect(html).toContain(
      "A passing production smoke run and a reviewable diff."
    );
    expect(html).toContain("Current question");
    expect(html).toContain("Which rollout boundary must remain locked?");
    expect(html.match(/Answer the current Supervisor question/g)?.length).toBe(
      2
    );
    expect(html).not.toContain("Discovery transcript");
    expect(html).not.toContain("Idempotency key");
    expect(html).not.toContain("answer-key");
  });

  test("uses server reasoning ownership after remount and exposes only resumable turns", () => {
    const answeredMessages: GoalIntakeView["messages"] = [
      ...createIntake().messages,
      {
        messageId: "message-3",
        role: "user",
        kind: "answer",
        content: "A smoke run is the evidence.",
        createdAt: NOW,
      },
    ];
    const pendingIntake = createIntake({
      messages: answeredMessages,
      pendingReasoning: true,
      reasoningState: "resumable",
    });
    const resumableHtml = renderToStaticMarkup(
      <ManagedGoalIntakeCard {...createCardProps(pendingIntake)} />
    );
    expect(resumableHtml).toContain("Step 2 · Reasoning turn pending");
    expect(resumableHtml).toContain("Resume pending turn");
    expect(resumableHtml).not.toContain("Reasoning in progress");
    expect(resumableHtml).not.toContain("animate-spin");

    const serverActiveAfterRemountHtml = renderToStaticMarkup(
      <ManagedGoalIntakeCard
        {...createCardProps(
          createIntake({
            messages: answeredMessages,
            pendingReasoning: true,
            reasoningState: "active",
          })
        )}
      />
    );
    expect(serverActiveAfterRemountHtml).toContain("Step 2");
    expect(serverActiveAfterRemountHtml).toContain(
      "Supervisor is shaping the next question"
    );
    expect(serverActiveAfterRemountHtml).toContain("Reasoning in progress");
    expect(serverActiveAfterRemountHtml).toContain("animate-spin");
    expect(serverActiveAfterRemountHtml).not.toContain("Resume pending turn");
    expect(serverActiveAfterRemountHtml).not.toContain("Retry current turn");

    const optimisticActiveHtml = renderToStaticMarkup(
      <ManagedGoalIntakeCard
        {...createCardProps(pendingIntake, {
          pending: true,
          pendingAction: "intake-1:resume",
        })}
      />
    );
    expect(optimisticActiveHtml).toContain("Reasoning in progress");
    expect(optimisticActiveHtml).toContain("animate-spin");
    expect(optimisticActiveHtml).not.toContain("Resume pending turn");

    const immediateActiveHtml = renderToStaticMarkup(
      <ManagedGoalIntakeCard
        {...createCardProps(createIntake(), {
          pending: true,
          pendingAction: "intake-1:answer",
        })}
      />
    );
    expect(immediateActiveHtml).toContain(
      "Supervisor is shaping the next question"
    );
    expect(immediateActiveHtml).not.toContain("Current question");
    expect(immediateActiveHtml).not.toContain(
      'aria-label="Answer the current Supervisor question"'
    );

    const errorHtml = renderToStaticMarkup(
      <ManagedGoalIntakeCard
        {...createCardProps(
          createIntake({
            messages: answeredMessages,
            pendingReasoning: true,
            reasoningState: "resumable",
            reasoningError: "Reasoner connection was interrupted.",
          })
        )}
      />
    );
    expect(errorHtml).toContain("Step 2 · Reasoning paused");
    expect(errorHtml).toContain("Reasoner connection was interrupted.");
    expect(errorHtml).toContain("Retry current turn");
    expect(errorHtml).not.toContain(
      'aria-label="Answer the current Supervisor question"'
    );
  });

  test("keeps the Consult phase focused on packet export and import", () => {
    const intake = createIntake({
      status: "contract_ready",
      activeContractRevisionId: contract.revisionId,
      contractRevisions: [contract],
      consultations: [
        packet,
        {
          ...packet,
          consultationId: "consultation-gemini",
          provider: "gemini",
        },
      ],
    });
    const html = renderToStaticMarkup(
      <ManagedGoalIntakeCard
        {...createCardProps(intake, {
          answerDraft: {
            message: "Tighten the acceptance boundary.",
            idempotencyKey: "answer-key-preserved",
            targetKey: getGoalIntakeAnswerTargetKey(intake) ?? "",
          },
          consultationResponses: {
            "consultation-chatgpt": "Advisory response",
          },
          preparedPackets: {
            [packet.consultationId]: packet,
          },
        })}
      />
    );

    expect(html).toContain("Goal Contract v7");
    expect(html).toContain(contract.revisionId);
    expect(html).toContain(contract.hash);
    expect(html).toContain("Copy packet");
    expect(html).toContain("Open ChatGPT");
    expect(html).toContain("Recover frozen packet");
    expect(html).toContain("Import advisory result");
    expect(html).toContain("External output is advisory");
    expect(html).toContain('aria-label="Consult: current"');
    expect(html).not.toContain("Challenge or revise this contract");
    expect(html).not.toContain("Approve contract &amp; create run");
  });

  test("renders advisory evidence as read-only outside the Consult phase", () => {
    const importedPacket: PreparedGoalConsultationView = {
      ...packet,
      status: "imported",
      result: {
        response: "Imported advisor evidence",
        importedAt: NOW,
      },
    };
    const intake = createIntake({
      status: "approved",
      activeContractRevisionId: contract.revisionId,
      contractRevisions: [contract],
      consultations: [importedPacket],
    });
    const html = renderToStaticMarkup(
      <ManagedGoalIntakeCard
        {...createCardProps(intake, {
          preparedPackets: {
            [importedPacket.consultationId]: importedPacket,
          },
        })}
      />
    );

    expect(html).toContain("External advisory history");
    expect(html).toContain("Imported advisor evidence");
    expect(html).toContain('aria-label="Consult: complete"');
    expect(html).not.toContain("Prepare frozen packet");
    expect(html).not.toContain("Copy packet");
    expect(html).not.toContain("Open ChatGPT");
    expect(html).not.toContain("Import advisory result");
  });

  test("shows one contract challenge form after consultation is complete", () => {
    const intake = createIntake({
      status: "contract_ready",
      activeContractRevisionId: contract.revisionId,
      contractRevisions: [contract],
      providers: [],
    });
    const html = renderToStaticMarkup(
      <ManagedGoalIntakeCard
        {...createCardProps(intake, {
          answerDraft: {
            message: "Tighten the acceptance boundary.",
            idempotencyKey: "answer-key-preserved",
            targetKey: getGoalIntakeAnswerTargetKey(intake) ?? "",
          },
        })}
      />
    );

    expect(html).toContain("Challenge or revise this contract");
    expect(html).toContain(">Tighten the acceptance boundary.</textarea>");
    expect(html).not.toContain("answer-key-preserved");
    expect(html).toContain("Approve contract &amp; create run");
  });

  test("keeps the challenge draft visible beside a mutation error", () => {
    const intake = createIntake({
      status: "contract_ready",
      activeContractRevisionId: contract.revisionId,
      contractRevisions: [contract],
      providers: [],
    });
    const html = renderToStaticMarkup(
      <ManagedGoalIntakeCard
        {...createCardProps(intake, {
          actionError: "Reasoner failed after persisting the pending turn.",
          answerDraft: {
            message: "Do not lose this challenge.",
            idempotencyKey: "same-key-on-retry",
            targetKey: getGoalIntakeAnswerTargetKey(intake) ?? "",
          },
        })}
      />
    );

    expect(html).toContain(">Do not lose this challenge.</textarea>");
    expect(html).not.toContain("same-key-on-retry");
    expect(html).toContain(
      "Reasoner failed after persisting the pending turn."
    );
    expect(html).toContain('role="alert"');
  });

  test("offers conversion recovery without repeating approval", () => {
    const html = renderToStaticMarkup(
      <ManagedGoalIntakeCard
        {...createCardProps(
          createIntake({
            status: "converting",
            activeContractRevisionId: contract.revisionId,
            contractRevisions: [contract],
          })
        )}
      />
    );

    expect(html).toContain("Conversion needs recovery");
    expect(html).toContain("Resume conversion");
    expect(html).not.toContain("Approve exact contract");
  });

  test("renders loading, query failure, and empty states", () => {
    const actions = {
      answer: async () => createIntake(),
      resume: async () => createIntake(),
      prepareConsultation: async () => ({
        intake: createIntake(),
        requests: [],
      }),
      exportConsultation: async () => packet,
      importConsultation: async () => createIntake(),
      approve: async () => createIntake(),
      convert: async () => createIntake(),
    };
    expect(
      renderToStaticMarkup(
        <ManagedGoalIntakeCards
          actions={actions}
          intakes={[]}
          loading
          projectName="Eragear"
        />
      )
    ).toContain("Loading goal discovery");
    expect(
      renderToStaticMarkup(
        <ManagedGoalIntakeCards
          actions={actions}
          error="Cannot load discoveries"
          intakes={[]}
          projectName="Eragear"
        />
      )
    ).toContain('role="alert"');
    expect(
      renderToStaticMarkup(
        <ManagedGoalIntakeCards
          actions={actions}
          intakes={[]}
          projectName="Eragear"
        />
      )
    ).toContain("No active goal discoveries");
  });
});

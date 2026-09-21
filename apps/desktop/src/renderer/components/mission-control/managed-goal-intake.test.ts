import { describe, expect, test } from "bun:test";
import {
  copyGoalConsultationPacket,
  createGoalIntakeAnswerIdempotencyKey,
  ensureGoalIntakeAnswerDrafts,
  type GoalContractRevisionView,
  type GoalIntakeView,
  getActiveGoalContract,
  getCurrentGoalIntakeQuestion,
  getGoalDiscoverySteps,
  getGoalIntakeAnswerTargetKey,
  getGoalIntakePhases,
  getMissingGoalConsultationProviders,
  openExternalGoalConsultation,
  runGoalIntakeMutationWithRecovery,
  upsertGoalIntake,
} from "./managed-goal-intake";

const HASH = "a".repeat(64);
const NOW = "2026-08-18T08:00:00.000Z";

function createContractRevision(): GoalContractRevisionView {
  return {
    revisionId: "contract-2",
    intakeId: "intake-1",
    revision: 2,
    hash: HASH,
    title: "Production cutover",
    objective: "Cut over safely.",
    lockedStrategicDecisions: [],
    assumptions: [],
    nonGoals: [],
    changeBoundary: ["apps/desktop"],
    acceptanceCriteria: [
      {
        criterionId: "criterion-1",
        statement: "UI passes",
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
}

function createIntake(overrides: Partial<GoalIntakeView> = {}): GoalIntakeView {
  return {
    intakeId: "intake-1",
    revision: 3,
    projectId: "project-1",
    title: "Production cutover",
    roughOutcome: "Reach a reviewable checkpoint.",
    depth: "exhaustive",
    providers: ["chatgpt", "gemini"],
    status: "interviewing",
    discoveryRoundCount: 1,
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
        content: "Which checkpoint is acceptable?",
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

describe("managed goal intake helpers", () => {
  test("derives only a currently actionable Supervisor question", () => {
    const intake = createIntake();
    expect(getCurrentGoalIntakeQuestion(intake)?.messageId).toBe("message-2");

    const synthesized = createIntake({
      messages: [
        ...intake.messages,
        {
          messageId: "message-3",
          role: "supervisor",
          kind: "synthesis",
          content: "Drafted the contract.",
          createdAt: NOW,
        },
      ],
    });
    expect(getCurrentGoalIntakeQuestion(synthesized)).toBeUndefined();
  });

  test("pairs each Supervisor question with only its following user answer", () => {
    const intake = createIntake();
    const secondQuestion = {
      messageId: "message-4",
      role: "supervisor" as const,
      kind: "question" as const,
      content: "Which rollout boundary is locked?",
      createdAt: NOW,
    };
    const steps = getGoalDiscoverySteps(
      createIntake({
        messages: [
          ...intake.messages,
          {
            messageId: "message-3",
            role: "user",
            kind: "answer",
            content: "A smoke run is enough.",
            createdAt: NOW,
          },
          {
            messageId: "message-unmatched-answer",
            role: "user",
            kind: "answer",
            content: "This must not overwrite the first answer.",
            createdAt: NOW,
          },
          secondQuestion,
        ],
      })
    );

    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({
      stepNumber: 1,
      question: { messageId: "message-2" },
      answer: { messageId: "message-3" },
    });
    expect(steps[1]).toEqual({ stepNumber: 2, question: secondQuestion });
    expect(
      getGoalDiscoverySteps(
        createIntake({
          messages: [
            {
              messageId: "message-unmatched",
              role: "user",
              kind: "answer",
              content: "There is no preceding question.",
              createdAt: NOW,
            },
            {
              messageId: "message-system",
              role: "supervisor",
              kind: "system",
              content: "System note",
              createdAt: NOW,
            },
          ],
        })
      )
    ).toEqual([]);

    const boundarySteps = getGoalDiscoverySteps(
      createIntake({
        messages: [
          ...intake.messages,
          {
            messageId: "message-boundary",
            role: "supervisor",
            kind: "system",
            content: "A durable boundary intervened.",
            createdAt: NOW,
          },
          {
            messageId: "message-late-answer",
            role: "user",
            kind: "answer",
            content: "This answer must not cross the boundary.",
            createdAt: NOW,
          },
        ],
      })
    );
    expect(boundarySteps[0]?.answer).toBeUndefined();
  });

  test("derives Discover, Consult, Review, and Run progress from durable facts", () => {
    expect(
      getGoalIntakePhases(createIntake()).map((phase) => phase.state)
    ).toEqual(["current", "upcoming", "upcoming", "upcoming"]);

    const contract = createContractRevision();
    expect(
      getGoalIntakePhases(
        createIntake({
          activeContractRevisionId: contract.revisionId,
          contractRevisions: [contract],
          pendingReasoning: true,
          reasoningState: "active",
          status: "interviewing",
        })
      ).map((phase) => phase.state)
    ).toEqual(["current", "upcoming", "upcoming", "upcoming"]);
    expect(
      getGoalIntakePhases(
        createIntake({
          activeContractRevisionId: contract.revisionId,
          contractRevisions: [contract],
          status: "contract_ready",
        })
      ).map((phase) => phase.state)
    ).toEqual(["complete", "current", "upcoming", "upcoming"]);

    const reviewing = createIntake({
      activeContractRevisionId: contract.revisionId,
      contractRevisions: [contract],
      providers: [],
      status: "contract_ready",
    });
    expect(getGoalIntakePhases(reviewing).map((phase) => phase.state)).toEqual([
      "complete",
      "complete",
      "current",
      "upcoming",
    ]);
    expect(
      getGoalIntakePhases(
        createIntake({
          activeContractRevisionId: contract.revisionId,
          contractRevisions: [contract],
          providers: [],
          status: "converted",
        })
      ).map((phase) => phase.state)
    ).toEqual(["complete", "complete", "complete", "complete"]);
  });

  test("selects the exact active contract revision", () => {
    const contract = createContractRevision();
    const intake = createIntake({
      activeContractRevisionId: contract.revisionId,
      contractRevisions: [contract],
    });

    expect(getActiveGoalContract(intake)).toBe(contract);
  });

  test("reports selected advisors without an exact-contract result", () => {
    const contract = createContractRevision();
    const intake = createIntake({
      activeContractRevisionId: contract.revisionId,
      contractRevisions: [contract],
      consultations: [
        {
          consultationId: "consultation-chatgpt",
          provider: "chatgpt",
          status: "imported",
          reason: "Challenge the goal",
          packetHash: HASH,
          contractRevisionId: contract.revisionId,
          contractHash: contract.hash,
          result: {
            response: "Useful critique",
            importedAt: NOW,
          },
          createdAt: NOW,
        },
        {
          consultationId: "consultation-stale-gemini",
          provider: "gemini",
          status: "imported",
          reason: "Challenge an older goal",
          packetHash: HASH,
          contractRevisionId: "contract-1",
          contractHash: "b".repeat(64),
          result: {
            response: "Stale critique",
            importedAt: NOW,
          },
          createdAt: NOW,
        },
      ],
    });

    expect(getMissingGoalConsultationProviders(intake)).toEqual(["gemini"]);
    expect(getMissingGoalConsultationProviders(createIntake())).toEqual([
      "chatgpt",
      "gemini",
    ]);
  });

  test("upserts newest projections and removes converted intakes", () => {
    const existing = createIntake({ revision: 4 });
    expect(upsertGoalIntake([existing], createIntake({ revision: 3 }))).toEqual(
      [existing]
    );

    const newer = createIntake({
      revision: 5,
      updatedAt: "2026-08-18T09:00:00.000Z",
    });
    expect(upsertGoalIntake([existing], newer)).toEqual([newer]);
    expect(
      upsertGoalIntake(
        [newer],
        createIntake({ revision: 6, status: "converted" })
      )
    ).toEqual([]);
  });

  test("binds each idempotent draft to one question or contract target", () => {
    expect(createGoalIntakeAnswerIdempotencyKey(() => "stable key!* 42")).toBe(
      "goal-answer-stablekey42"
    );

    expect(getGoalIntakeAnswerTargetKey(createIntake())).toBe(
      "question:message-2"
    );
    const first = ensureGoalIntakeAnswerDrafts(
      {},
      [{ intakeId: "intake-1", targetKey: "question:message-2" }],
      () => "key-1"
    );
    first["intake-1"].message = "Keep this answer";
    const unchanged = ensureGoalIntakeAnswerDrafts(
      first,
      [{ intakeId: "intake-1", targetKey: "question:message-2" }],
      () => "replacement"
    );
    expect(unchanged).toBe(first);
    expect(unchanged["intake-1"]).toEqual({
      message: "Keep this answer",
      idempotencyKey: "key-1",
      targetKey: "question:message-2",
    });

    expect(
      ensureGoalIntakeAnswerDrafts(
        unchanged,
        [{ intakeId: "intake-1", targetKey: "question:message-4" }],
        () => "key-2"
      )["intake-1"]
    ).toEqual({
      message: "",
      idempotencyKey: "key-2",
      targetKey: "question:message-4",
    });
    expect(
      ensureGoalIntakeAnswerDrafts(unchanged, [
        { intakeId: "intake-1", targetKey: undefined },
      ])
    ).toEqual({});

    const contract = createContractRevision();
    expect(
      getGoalIntakeAnswerTargetKey(
        createIntake({
          activeContractRevisionId: contract.revisionId,
          contractRevisions: [contract],
          status: "contract_ready",
        })
      )
    ).toBe(`contract:${contract.revisionId}:${contract.hash}`);
  });

  test("copies exact packets and opens only a typed external provider", async () => {
    const copied: string[] = [];
    const opened: string[] = [];
    await copyGoalConsultationPacket("frozen packet", {
      writeText(text) {
        copied.push(text);
        return Promise.resolve();
      },
    });
    await openExternalGoalConsultation("gemini", (provider) => {
      opened.push(provider);
      return Promise.resolve();
    });

    expect(copied).toEqual(["frozen packet"]);
    expect(opened).toEqual(["gemini"]);
    await expect(
      copyGoalConsultationPacket("packet", undefined)
    ).rejects.toThrow("Clipboard access is unavailable.");
  });

  test("refreshes durable state before surfacing a mutation error", async () => {
    const originalError = new Error("reasoner failed after persistence");
    const order: string[] = [];
    const result = runGoalIntakeMutationWithRecovery(
      () => {
        order.push("execute");
        return Promise.reject(originalError);
      },
      () => {
        order.push("recover");
        return Promise.resolve();
      }
    );

    await expect(result).rejects.toBe(originalError);
    expect(order).toEqual(["execute", "recover"]);
  });

  test("preserves the original mutation error if cache recovery also fails", async () => {
    const originalError = new Error("mutation failed");
    await expect(
      runGoalIntakeMutationWithRecovery(
        () => Promise.reject(originalError),
        () => Promise.reject(new Error("refresh failed"))
      )
    ).rejects.toBe(originalError);
  });
});

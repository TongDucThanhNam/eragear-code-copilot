import { describe, expect, test } from "bun:test";
import {
  deriveWorkItemStates,
  RunReconciler,
  type RunReconcilerSnapshot,
  type WorkflowVerificationFacts,
  type WorkflowWorkItemSnapshot,
} from "./run-reconciler";

const NOW = "2026-08-18T10:00:00.000Z";

function verification(
  status: WorkflowVerificationFacts["status"] = "not_required",
  overrides: Partial<WorkflowVerificationFacts> = {}
): WorkflowVerificationFacts {
  return {
    verificationId: "verification-1",
    status,
    evidenceRefs: [],
    ...overrides,
  };
}

function workItem(
  overrides: Partial<WorkflowWorkItemSnapshot> = {}
): WorkflowWorkItemSnapshot {
  return {
    workItemId: "work-1",
    dependencies: [],
    assignedAgentIdentityId: "agent-1",
    ...overrides,
  };
}

function leasedWorkItem(
  workItemId: string,
  overrides: Partial<WorkflowWorkItemSnapshot> = {}
): WorkflowWorkItemSnapshot {
  return workItem({
    workItemId,
    dispatch: {
      dispatchId: `dispatch-${workItemId}`,
      state: "leased",
    },
    capacityLease: {
      leaseId: `lease-${workItemId}`,
      agentIdentityId: "agent-1",
      expiresAt: "2026-08-18T11:00:00.000Z",
    },
    ...overrides,
  });
}

function snapshot(
  overrides: Partial<RunReconcilerSnapshot> = {}
): RunReconcilerSnapshot {
  return {
    runId: "run-1",
    desiredState: "running",
    phase: "executing",
    plan: {
      goalRevisionId: "goal-revision-1",
      status: "approved",
      planVersion: 1,
    },
    finalVerification: verification("not_required", {
      verificationId: "final-verification",
    }),
    workItems: [workItem()],
    maxParallel: 1,
    occupiedEffectDedupeKeys: [],
    ...overrides,
  };
}

describe("RunReconciler derived work-item state", () => {
  test("derives readiness and UI status from independent facts", () => {
    const acceptedDependency = workItem({
      workItemId: "dependency-done",
      outcome: {
        status: "succeeded",
        acceptance: "machine_verified",
        evidenceRefs: ["evidence:dependency"],
      },
    });
    const pendingDependency = workItem({ workItemId: "dependency-pending" });
    const cases: Array<{
      name: string;
      workItems: WorkflowWorkItemSnapshot[];
      targetId: string;
      expected: {
        uiStatus: string;
        ready: boolean;
        needsUser: boolean;
        waitingCapacity: boolean;
      };
    }> = [
      {
        name: "ready",
        workItems: [workItem({ workItemId: "target" })],
        targetId: "target",
        expected: {
          uiStatus: "ready",
          ready: true,
          needsUser: false,
          waitingCapacity: false,
        },
      },
      {
        name: "blocked dependency",
        workItems: [
          pendingDependency,
          workItem({
            workItemId: "target",
            dependencies: [pendingDependency.workItemId],
          }),
        ],
        targetId: "target",
        expected: {
          uiStatus: "blocked",
          ready: false,
          needsUser: false,
          waitingCapacity: false,
        },
      },
      {
        name: "accepted dependency",
        workItems: [
          acceptedDependency,
          workItem({
            workItemId: "target",
            dependencies: [acceptedDependency.workItemId],
          }),
        ],
        targetId: "target",
        expected: {
          uiStatus: "ready",
          ready: true,
          needsUser: false,
          waitingCapacity: false,
        },
      },
      {
        name: "not before",
        workItems: [
          workItem({
            workItemId: "target",
            notBefore: "2026-08-18T10:05:00.000Z",
          }),
        ],
        targetId: "target",
        expected: {
          uiStatus: "scheduled",
          ready: false,
          needsUser: false,
          waitingCapacity: false,
        },
      },
      {
        name: "blocking decision",
        workItems: [
          workItem({ workItemId: "target", blockingDecisionId: "decision-1" }),
        ],
        targetId: "target",
        expected: {
          uiStatus: "needs_user",
          ready: false,
          needsUser: true,
          waitingCapacity: false,
        },
      },
      {
        name: "uncertain dispatch",
        workItems: [
          workItem({
            workItemId: "target",
            activeAttempt: {
              attemptId: "attempt-uncertain",
              binding: { chatId: "chat-uncertain" },
              status: "uncertain",
            },
          }),
        ],
        targetId: "target",
        expected: {
          uiStatus: "dispatch_uncertain",
          ready: false,
          needsUser: false,
          waitingCapacity: false,
        },
      },
      {
        name: "capacity wait",
        workItems: [
          workItem({
            workItemId: "target",
            activeAttempt: {
              attemptId: "attempt-waiting",
              binding: { chatId: "chat-waiting" },
              status: "waiting_capacity",
              retryAt: "2026-08-18T10:05:00.000Z",
            },
          }),
        ],
        targetId: "target",
        expected: {
          uiStatus: "waiting_capacity",
          ready: false,
          needsUser: false,
          waitingCapacity: true,
        },
      },
      {
        name: "accepted completion",
        workItems: [
          workItem({
            workItemId: "target",
            outcome: {
              status: "succeeded",
              acceptance: "user_accepted",
              evidenceRefs: [],
            },
          }),
        ],
        targetId: "target",
        expected: {
          uiStatus: "completed",
          ready: false,
          needsUser: false,
          waitingCapacity: false,
        },
      },
    ];

    for (const tableCase of cases) {
      const state = deriveWorkItemStates(
        snapshot({ workItems: tableCase.workItems }),
        NOW
      ).find((item) => item.workItemId === tableCase.targetId);
      expect(state, tableCase.name).toMatchObject(tableCase.expected);
    }
  });
});

describe("RunReconciler effects", () => {
  test("inspects uncertain turns and never starts or resends them", () => {
    const input = snapshot({
      workItems: [
        leasedWorkItem("work-uncertain", {
          activeAttempt: {
            attemptId: "attempt-1",
            binding: {
              chatId: "chat-1",
              agentSessionId: "agent-session-1",
            },
            status: "uncertain",
            uncertaintyId: "uncertainty-1",
          },
        }),
      ],
    });
    const reconciler = new RunReconciler();
    const first = reconciler.decide(input, NOW);
    const second = reconciler.decide(input, NOW);

    expect(first).toEqual(second);
    expect(first.effects.map((effect) => effect.type)).toEqual([
      "inspect_uncertain_turn",
    ]);
    expect(first.effects).not.toContainEqual(
      expect.objectContaining({ type: "start_turn" })
    );
    expect(first.effects).not.toContainEqual(
      expect.objectContaining({ type: "resume_session" })
    );

    const inspectKey = first.effects[0]?.dedupeKey;
    expect(inspectKey).toBeDefined();
    expect(
      reconciler.decide(
        { ...input, occupiedEffectDedupeKeys: [inspectKey as string] },
        NOW
      ).effects
    ).toEqual([]);
  });

  test("schedules only the earliest future quota wakeup and resumes when due", () => {
    const future = snapshot({
      maxParallel: 2,
      workItems: [
        workItem({
          workItemId: "work-a",
          activeAttempt: {
            attemptId: "attempt-a",
            binding: { chatId: "chat-a" },
            status: "waiting_capacity",
            retryAt: "2026-08-18T10:10:00.000Z",
          },
        }),
        workItem({
          workItemId: "work-b",
          activeAttempt: {
            attemptId: "attempt-b",
            binding: { chatId: "chat-b" },
            status: "waiting_capacity",
            retryAt: "2026-08-18T10:05:00.000Z",
          },
        }),
      ],
    });
    const reconciler = new RunReconciler();
    const waiting = reconciler.decide(future, NOW);

    expect(waiting.earliestWakeupAt).toBe("2026-08-18T10:05:00.000Z");
    expect(waiting.effects).toEqual([
      expect.objectContaining({
        type: "schedule_wakeup",
        at: "2026-08-18T10:05:00.000Z",
      }),
    ]);

    const due = reconciler.decide(future, "2026-08-18T10:05:00.000Z");
    expect(due.effects).toContainEqual(
      expect.objectContaining({
        type: "resume_session",
        workItemId: "work-b",
        attemptId: "attempt-b",
      })
    );
    expect(due.effects).not.toContainEqual(
      expect.objectContaining({
        type: "start_turn",
        workItemId: "work-b",
      })
    );
  });

  test("a decision blocks only its affected work item", () => {
    const decision = new RunReconciler().decide(
      snapshot({
        workItems: [
          workItem({
            workItemId: "work-blocked",
            blockingDecisionId: "decision-work-blocked",
          }),
          leasedWorkItem("work-runnable"),
        ],
      }),
      NOW
    );

    expect(decision.effects.map((effect) => effect.type)).toEqual([
      "request_decision",
      "start_turn",
    ]);
    expect(decision.effects).toContainEqual(
      expect.objectContaining({
        type: "request_decision",
        decisionId: "decision-work-blocked",
        workItemId: "work-blocked",
      })
    );
    expect(decision.effects).toContainEqual(
      expect.objectContaining({
        type: "start_turn",
        workItemId: "work-runnable",
      })
    );
  });

  test("runs item and final verification before exposing completion eligibility", () => {
    const itemNeedsVerification = workItem({
      outcome: {
        status: "succeeded",
        acceptance: "pending",
        evidenceRefs: [],
      },
      verification: verification("not_started", {
        verificationId: "item-verification",
      }),
    });
    const reconciler = new RunReconciler();
    const itemDecision = reconciler.decide(
      snapshot({ workItems: [itemNeedsVerification] }),
      NOW
    );
    expect(itemDecision.effects).toEqual([
      expect.objectContaining({
        type: "run_verification",
        scope: "work_item",
        workItemId: "work-1",
      }),
    ]);
    expect(itemDecision.readyForFinalization).toBe(false);

    const verifiedItem = workItem({
      ...itemNeedsVerification,
      verification: verification("passed", {
        verificationId: "item-verification",
        evidenceRefs: ["evidence:item-test"],
      }),
    });
    const finalDecision = reconciler.decide(
      snapshot({
        phase: "finalizing",
        workItems: [verifiedItem],
        finalVerification: verification("not_started", {
          verificationId: "final-verification",
        }),
      }),
      NOW
    );
    expect(finalDecision.readyForFinalization).toBe(true);
    expect(finalDecision.completionEligible).toBe(false);
    expect(finalDecision.effects).toEqual([
      expect.objectContaining({
        type: "run_verification",
        scope: "run",
        verificationId: "final-verification",
      }),
    ]);

    const completionCases = [
      {
        name: "machine evidence",
        finalVerification: verification("passed", {
          verificationId: "final-verification",
          evidenceRefs: ["evidence:aggregate-test"],
        }),
        expected: true,
      },
      {
        name: "explicit acceptance",
        finalVerification: verification("accepted", {
          verificationId: "final-verification",
        }),
        expected: true,
      },
      {
        name: "claim without evidence",
        finalVerification: verification("passed", {
          verificationId: "final-verification",
        }),
        expected: false,
      },
    ];
    for (const tableCase of completionCases) {
      const result = reconciler.decide(
        snapshot({
          phase: "finalizing",
          workItems: [verifiedItem],
          finalVerification: tableCase.finalVerification,
        }),
        NOW
      );
      expect(result.completionEligible, tableCase.name).toBe(
        tableCase.expected
      );
    }
  });

  test("requires machine evidence or explicit acceptance for a successful item", () => {
    const reconciler = new RunReconciler();
    const pending = reconciler.decide(
      snapshot({
        workItems: [
          workItem({
            outcome: {
              status: "succeeded",
              acceptance: "pending",
              evidenceRefs: [],
            },
            verification: verification("not_required"),
          }),
        ],
      }),
      NOW
    );
    expect(pending.readyForFinalization).toBe(false);
    expect(pending.workItems[0]?.uiStatus).not.toBe("completed");

    const acceptedCases: Array<{
      name: string;
      item: WorkflowWorkItemSnapshot;
    }> = [
      {
        name: "machine evidence",
        item: workItem({
          outcome: {
            status: "succeeded",
            acceptance: "machine_verified",
            evidenceRefs: ["evidence:trusted-check"],
          },
        }),
      },
      {
        name: "verification evidence",
        item: workItem({
          outcome: {
            status: "succeeded",
            acceptance: "pending",
            evidenceRefs: [],
          },
          verification: verification("passed", {
            evidenceRefs: ["evidence:trusted-check"],
          }),
        }),
      },
      {
        name: "user acceptance",
        item: workItem({
          outcome: {
            status: "succeeded",
            acceptance: "user_accepted",
            evidenceRefs: [],
          },
        }),
      },
      {
        name: "waiver",
        item: workItem({
          outcome: {
            status: "succeeded",
            acceptance: "waived",
            evidenceRefs: [],
          },
        }),
      },
    ];
    for (const tableCase of acceptedCases) {
      expect(
        reconciler.decide(snapshot({ workItems: [tableCase.item] }), NOW)
          .readyForFinalization,
        tableCase.name
      ).toBe(true);
    }
  });

  test("respects pause, cancellation, and the parallel cap", () => {
    const input = snapshot({
      maxParallel: 1,
      workItems: [leasedWorkItem("work-a"), leasedWorkItem("work-b")],
    });
    const reconciler = new RunReconciler();
    const running = reconciler.decide(input, NOW);
    expect(
      running.effects.filter((effect) => effect.type === "start_turn")
    ).toHaveLength(1);
    expect(running.availableParallelism).toBe(0);
    expect(
      reconciler.decide({ ...input, desiredState: "paused" }, NOW).effects
    ).toEqual([]);
    expect(
      reconciler.decide({ ...input, desiredState: "cancelled" }, NOW).effects
    ).toEqual([]);
  });

  test("occupied dedupe keys do not consume a slot and expired leases do not wake", () => {
    const reconciler = new RunReconciler();
    const parallel = snapshot({
      maxParallel: 1,
      workItems: [leasedWorkItem("work-a"), leasedWorkItem("work-b")],
    });
    const firstStart = reconciler
      .decide(parallel, NOW)
      .effects.find((effect) => effect.type === "start_turn");
    if (!firstStart) {
      throw new Error("Expected the first start intent");
    }
    const afterOccupiedDedupe = reconciler.decide(
      {
        ...parallel,
        occupiedEffectDedupeKeys: [firstStart.dedupeKey],
      },
      NOW
    );
    expect(afterOccupiedDedupe.effects).toContainEqual(
      expect.objectContaining({ type: "start_turn", workItemId: "work-b" })
    );

    const expiredLease = leasedWorkItem("work-expired", {
      capacityLease: {
        leaseId: "lease-expired",
        agentIdentityId: "agent-1",
        expiresAt: "2026-08-18T09:59:59.000Z",
      },
    });
    const expired = reconciler.decide(
      snapshot({ workItems: [expiredLease] }),
      NOW
    );
    expect(expired.effects).toEqual([
      expect.objectContaining({
        type: "request_capacity",
        workItemId: "work-expired",
      }),
    ]);
    expect(expired.earliestWakeupAt).toBeUndefined();
  });

  test("proposes stable plan and integration intents", () => {
    const reconciler = new RunReconciler();
    const planning = snapshot({
      phase: "planning",
      plan: {
        goalRevisionId: "goal-revision-42",
        status: "missing",
      },
      workItems: [],
    });
    const planDecision = reconciler.decide(planning, NOW);
    expect(planDecision.effects).toEqual([
      expect.objectContaining({
        type: "request_plan",
        goalRevisionId: "goal-revision-42",
      }),
    ]);
    expect(reconciler.decide(planning, NOW)).toEqual(planDecision);
    expect(
      reconciler.decide(
        {
          ...planning,
          occupiedEffectDedupeKeys: [
            planDecision.effects[0]?.dedupeKey as string,
          ],
        },
        NOW
      ).effects
    ).toEqual([]);

    const integrationDecision = reconciler.decide(
      snapshot({
        workItems: [
          workItem({
            outcome: {
              status: "succeeded",
              acceptance: "machine_verified",
              evidenceRefs: ["evidence:worker-diff"],
            },
            activeAttempt: {
              attemptId: "attempt-complete",
              binding: { chatId: "chat-complete" },
              status: "completed",
            },
            integration: {
              integrationId: "integration-1",
              workspaceId: "workspace-1",
              status: "pending",
            },
          }),
        ],
      }),
      NOW
    );
    expect(integrationDecision.effects).toEqual([
      expect.objectContaining({
        type: "integrate_workspace",
        attemptId: "attempt-complete",
        workspaceId: "workspace-1",
      }),
    ]);
    expect(integrationDecision.readyForFinalization).toBe(false);

    for (const status of ["running", "failed"] as const) {
      const blockedIntegration = reconciler.decide(
        snapshot({
          workItems: [
            workItem({
              outcome: {
                status: "succeeded",
                acceptance: "machine_verified",
                evidenceRefs: ["evidence:worker-diff"],
              },
              activeAttempt: {
                attemptId: "attempt-complete",
                binding: { chatId: "chat-complete" },
                status: "completed",
              },
              integration: {
                integrationId: "integration-1",
                workspaceId: "workspace-1",
                status,
              },
            }),
          ],
        }),
        NOW
      );
      expect(blockedIntegration.readyForFinalization, status).toBe(false);
      expect(blockedIntegration.effects, status).toEqual([]);
    }

    const completedIntegration = reconciler.decide(
      snapshot({
        workItems: [
          workItem({
            outcome: {
              status: "succeeded",
              acceptance: "machine_verified",
              evidenceRefs: ["evidence:worker-diff"],
            },
            activeAttempt: {
              attemptId: "attempt-complete",
              binding: { chatId: "chat-complete" },
              status: "completed",
            },
            integration: {
              integrationId: "integration-1",
              workspaceId: "workspace-1",
              status: "succeeded",
            },
          }),
        ],
      }),
      NOW
    );
    expect(completedIntegration.readyForFinalization).toBe(true);
  });
});

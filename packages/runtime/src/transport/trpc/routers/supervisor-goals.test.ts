import { describe, expect, test } from "bun:test";
import type {
  GoalConsultationRequest,
  GoalIntakeClientProjection,
} from "#runtime/modules/goal-intake";
import { supervisorGoalsRouter } from "./supervisor-goals";

const NOW = "2026-08-18T00:00:00.000Z";

function projection(
  overrides: Partial<GoalIntakeClientProjection> = {}
): GoalIntakeClientProjection {
  return {
    intakeId: "intake-1",
    revision: 3,
    projectId: "project-1",
    title: "Durable Goal",
    roughOutcome: "Ship a durable controller",
    depth: "exhaustive",
    providers: ["chatgpt", "gemini"],
    status: "contract_ready",
    discoveryRoundCount: 3,
    minimumDiscoveryRounds: 3,
    messages: [],
    pendingReasoning: false,
    reasoningState: "idle",
    contractRevisions: [],
    consultations: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function consultation(): GoalConsultationRequest {
  return {
    consultationId: "consultation-1",
    provider: "chatgpt",
    status: "prepared",
    reason: "Challenge the contract",
    packet: "FROZEN CONSULTATION PACKET",
    packetHash: "a".repeat(64),
    createdAt: NOW,
  };
}

function createCaller(
  input: {
    userId?: string;
    projectExists?: boolean;
    consultationExists?: boolean;
    current?: GoalIntakeClientProjection;
  } = {}
) {
  const calls: Array<{ method: string; input: Record<string, unknown> }> = [];
  let current = input.current ?? projection();
  const record = (
    method: string,
    value: Record<string, unknown>,
    result: unknown = current
  ) => {
    calls.push({ method, input: value });
    return Promise.resolve(result);
  };
  const caller = supervisorGoalsRouter.createCaller({
    auth: { type: "local", userId: input.userId ?? "user-1" },
    appConfig: {},
    useCases: {
      project: {
        list: {
          execute: () =>
            Promise.resolve({
              projects:
                input.projectExists === false
                  ? []
                  : [{ id: "project-1", path: "C:/owned/repo" }],
              activeProjectId: "project-1",
            }),
        },
      },
      goalIntake: {
        intake: {
          create: (value: Record<string, unknown>) => record("create", value),
          get: (value: Record<string, unknown>) =>
            record("get", value, current),
          list: (value: Record<string, unknown>) =>
            record("list", value, [current]),
          answer: (value: Record<string, unknown>) => record("answer", value),
          resume: (value: Record<string, unknown>) => record("resume", value),
          prepareConsultation: (value: Record<string, unknown>) =>
            record("prepareConsultation", value, {
              intake: current,
              requests: [consultation()],
            }),
          exportConsultation: (value: Record<string, unknown>) =>
            input.consultationExists === false
              ? Promise.reject(
                  new Error(
                    `Consultation request not found: ${String(value.consultationId)}`
                  )
                )
              : record("exportConsultation", value, consultation()),
          importConsultation: (value: Record<string, unknown>) =>
            record("importConsultation", value),
          approveContract: (value: Record<string, unknown>) => {
            current = projection({
              revision: 4,
              status: "approved",
              approval: {
                revisionId: "contract-1",
                hash: "b".repeat(64),
                approvedAt: NOW,
                approvedByUserId: "user-1",
              },
            });
            return record("approveContract", value, current);
          },
          convert: (value: Record<string, unknown>) => {
            current = projection({
              revision: 6,
              status: "converted",
              approval: {
                revisionId: "contract-1",
                hash: "b".repeat(64),
                approvedAt: NOW,
                approvedByUserId: "user-1",
              },
              convertedRunId: "run-1",
            });
            return record("convert", value, current);
          },
        },
      },
    },
  } as never);
  return { caller, calls };
}

describe("supervisorGoalsRouter", () => {
  test("exposes the typed Goal Intake surface", () => {
    const procedures = supervisorGoalsRouter._def.procedures as Record<
      string,
      unknown
    >;
    for (const name of [
      "create",
      "get",
      "list",
      "answer",
      "resume",
      "prepareConsultation",
      "exportConsultation",
      "importConsultation",
      "approve",
      "convert",
    ]) {
      expect(procedures[name]).toBeDefined();
    }
  });

  test("derives owner and project root and never accepts them from clients", async () => {
    const { caller, calls } = createCaller();
    await caller.create({
      projectId: "project-1",
      title: "Durable Goal",
      roughOutcome: "Ship a durable controller",
    });
    expect(calls[0]).toEqual({
      method: "create",
      input: {
        userId: "user-1",
        projectId: "project-1",
        projectRoot: "C:/owned/repo",
        title: "Durable Goal",
        roughOutcome: "Ship a durable controller",
        depth: "exhaustive",
        providers: ["chatgpt", "gemini"],
      },
    });

    await expect(
      caller.create({
        projectId: "project-1",
        roughOutcome: "Attempt to inject ownership",
        userId: "attacker",
        projectRoot: "C:/attacker",
      } as never)
    ).rejects.toThrow();
  });

  test("rejects creation for a project outside authenticated ownership", async () => {
    const { caller } = createCaller({ projectExists: false });
    await expect(
      caller.create({
        projectId: "project-1",
        roughOutcome: "Cross-project goal",
      })
    ).rejects.toThrow("Project not found or does not belong to the user");
  });

  test("injects authenticated ownership and returns frozen consultation packets", async () => {
    const { caller, calls } = createCaller();
    await caller.get({ intakeId: "intake-1" });
    await caller.list();
    await caller.answer({
      intakeId: "intake-1",
      message: "The executable evidence is a passing focused test.",
      expectedRevision: 3,
      idempotencyKey: "answer-1",
    });
    await caller.resume({ intakeId: "intake-1", expectedRevision: 3 });
    const prepared = await caller.prepareConsultation({
      intakeId: "intake-1",
      providers: ["chatgpt"],
      reason: "Challenge the contract",
      expectedRevision: 3,
    });
    const exported = await caller.exportConsultation({
      intakeId: "intake-1",
      consultationId: "consultation-1",
    });
    await caller.importConsultation({
      intakeId: "intake-1",
      consultationId: "consultation-1",
      response: "Advisory response",
      expectedRevision: 3,
    });

    expect(prepared.requests[0]?.packet).toBe("FROZEN CONSULTATION PACKET");
    expect(exported.packet).toBe("FROZEN CONSULTATION PACKET");
    expect(calls.every((call) => call.input.userId === "user-1")).toBe(true);
  });

  test("recovers only an owned frozen packet and keeps ordinary reads redacted", async () => {
    const { packet: _packet, ...redacted } = consultation();
    const { caller, calls } = createCaller({
      current: projection({ consultations: [redacted] }),
    });

    const ordinary = await caller.get({ intakeId: "intake-1" });
    const exported = await caller.exportConsultation({
      intakeId: "intake-1",
      consultationId: "consultation-1",
    });

    if (!ordinary) {
      throw new Error("Expected owned Goal Intake projection");
    }
    expect("packet" in (ordinary.consultations[0] ?? {})).toBe(false);
    expect(exported.packet).toBe("FROZEN CONSULTATION PACKET");
    expect(calls.at(-1)).toEqual({
      method: "exportConsultation",
      input: {
        intakeId: "intake-1",
        consultationId: "consultation-1",
        userId: "user-1",
      },
    });
    await expect(
      caller.exportConsultation({
        intakeId: "intake-1",
        consultationId: "consultation-1",
        userId: "attacker",
      } as never)
    ).rejects.toThrow();
  });

  test("fails closed when the owned consultation does not exist", async () => {
    const { caller } = createCaller({ consultationExists: false });
    await expect(
      caller.exportConsultation({
        intakeId: "intake-1",
        consultationId: "missing-consultation",
      })
    ).rejects.toThrow("Consultation request not found: missing-consultation");
  });

  test("approve binds the exact contract then converts from the committed revision", async () => {
    const { caller, calls } = createCaller();
    const result = await caller.approve({
      intakeId: "intake-1",
      revisionId: "contract-1",
      hash: "b".repeat(64),
      expectedRevision: 3,
    });

    expect(result.convertedRunId).toBe("run-1");
    expect(calls.slice(-2)).toEqual([
      {
        method: "approveContract",
        input: {
          intakeId: "intake-1",
          revisionId: "contract-1",
          hash: "b".repeat(64),
          expectedRevision: 3,
          userId: "user-1",
        },
      },
      {
        method: "convert",
        input: {
          intakeId: "intake-1",
          userId: "user-1",
          expectedRevision: 4,
        },
      },
    ]);
  });
});

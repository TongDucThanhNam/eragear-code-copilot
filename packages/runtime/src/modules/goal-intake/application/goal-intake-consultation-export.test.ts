import { describe, expect, test } from "bun:test";
import {
  GOAL_INTAKE_SCHEMA_VERSION,
  type GoalIntakeState,
  GoalIntakeStateSchema,
} from "../domain/goal-intake.schemas";
import { GoalIntakeService } from "./goal-intake.service";
import {
  buildGoalIntakeReasonerPrompt,
  computeGoalIntakeTextHash,
} from "./goal-intake-prompt.builder";
import type { GoalIntakeReasonerSnapshot } from "./ports/goal-intake-reasoner.port";

const NOW = "2026-08-18T00:00:00.000Z";
const PACKET = "Frozen consultation packet\nwith exact restart-safe content.";

function intake(): GoalIntakeState {
  return GoalIntakeStateSchema.parse({
    schemaVersion: GOAL_INTAKE_SCHEMA_VERSION,
    intakeId: "intake-1",
    revision: 4,
    userId: "user-1",
    projectId: "project-1",
    projectRoot: "C:/owned/repo",
    roughOutcome: "Ship a durable controller",
    depth: "exhaustive",
    providers: ["chatgpt", "gemini"],
    status: "interviewing",
    discoveryRoundCount: 1,
    messages: [
      {
        messageId: "message-1",
        role: "user",
        kind: "seed",
        content: "Ship a durable controller",
        createdAt: NOW,
      },
    ],
    contractRevisions: [],
    consultations: [
      {
        consultationId: "consultation-1",
        provider: "chatgpt",
        status: "prepared",
        reason: "Challenge hidden assumptions",
        packet: PACKET,
        packetHash: computeGoalIntakeTextHash(PACKET),
        createdAt: NOW,
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function service(state = intake()): GoalIntakeService {
  return new GoalIntakeService({
    repository: {
      get(intakeId: string, userId: string) {
        return Promise.resolve(
          intakeId === state.intakeId && userId === state.userId
            ? structuredClone(state)
            : null
        );
      },
    } as never,
    reasoner: {} as never,
    goalRun: {} as never,
    projectSummary: {
      build: () =>
        Promise.resolve({
          status: "unavailable",
          symbolExtractionMode: "none",
          graphNodes: [],
          symbolMatches: [],
          routeMap: [],
        }),
    } as never,
  });
}

describe("GoalIntakeService consultation export", () => {
  test("keeps ordinary projection redacted but exports the exact frozen packet", async () => {
    const intakeService = service();

    const ordinary = await intakeService.get({
      intakeId: "intake-1",
      userId: "user-1",
    });
    const exported = await intakeService.exportConsultation({
      intakeId: "intake-1",
      consultationId: "consultation-1",
      userId: "user-1",
    });

    expect("packet" in (ordinary?.consultations[0] ?? {})).toBe(false);
    expect(exported.packet).toBe(PACKET);
    expect(exported.packetHash).toBe(computeGoalIntakeTextHash(PACKET));
  });

  test("fails closed for a different owner or missing consultation", async () => {
    const intakeService = service();

    await expect(
      intakeService.exportConsultation({
        intakeId: "intake-1",
        consultationId: "consultation-1",
        userId: "attacker",
      })
    ).rejects.toThrow("Goal intake not found: intake-1");
    await expect(
      intakeService.exportConsultation({
        intakeId: "intake-1",
        consultationId: "missing-consultation",
        userId: "user-1",
      })
    ).rejects.toThrow("Consultation request not found: missing-consultation");
  });

  test("fails closed instead of truncating discovery prompts or consultation packets", async () => {
    const longMessages = Array.from({ length: 5 }, (_, index) => ({
      messageId: `long-message-${index}`,
      role: "user" as const,
      kind: "answer" as const,
      content: `${index}:${"x".repeat(15_990)}`,
      createdAt: NOW,
    }));
    const snapshot: GoalIntakeReasonerSnapshot = {
      intakeId: "intake-1",
      userId: "user-1",
      projectId: "project-1",
      projectRoot: "C:/owned/repo",
      roughOutcome: "Ship a durable controller",
      depth: "exhaustive",
      minimumRounds: 3,
      discoveryRoundCount: 3,
      messages: longMessages,
      importedConsultations: [],
    };
    expect(() => buildGoalIntakeReasonerPrompt(snapshot)).toThrow(
      "reasoning prompt exceeds the 64000-character limit"
    );

    const state = GoalIntakeStateSchema.parse({
      ...intake(),
      messages: longMessages,
    });
    await expect(
      service(state).prepareConsultation({
        intakeId: "intake-1",
        userId: "user-1",
        providers: ["chatgpt"],
        reason: "Challenge the oversized context without losing the footer",
        expectedRevision: state.revision,
      })
    ).rejects.toThrow("packet exceeds the 64000-character limit");
  });
});

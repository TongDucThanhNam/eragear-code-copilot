import { describe, expect, test } from "bun:test";
import {
  computeGoalContractHash,
  type GoalContractProposal,
  type GoalContractRevision,
} from "#runtime/modules/goal-intake";
import {
  renderGoalContractConstraints,
  renderGoalContractIntent,
  SupervisorGoalRunAdapter,
} from "./goal-intake-services";

const NOW = "2026-08-18T00:00:00.000Z";

function proposal(
  overrides: Partial<GoalContractProposal> = {}
): GoalContractProposal {
  return {
    title: "Durable Goal",
    objective: "Ship the approved contract without changing its authority.",
    lockedStrategicDecisions: ["SQLite remains execution truth"],
    assumptions: ["The repository is already initialized"],
    nonGoals: ["Do not redesign the desktop shell"],
    changeBoundary: ["packages/runtime/src/modules/workflow"],
    acceptanceCriteria: [
      {
        criterionId: "criterion-1",
        statement: "Focused workflow tests pass",
        evidence: "machine",
      },
    ],
    trustedVerificationCommands: ["bun test workflow"],
    authority: {
      scopedCodeChange: "auto",
      architectureChange: "ask",
      dependencyChange: "ask",
      destructiveAction: "ask",
      finalIntegration: "ask",
    },
    unresolvedQuestions: ["Which semantic outcome needs user acceptance?"],
    ...overrides,
  };
}

function revision(contract = proposal()): GoalContractRevision {
  return {
    ...contract,
    intakeId: "intake-1",
    revisionId: "contract-1",
    revision: 1,
    hash: computeGoalContractHash(contract),
    createdAt: NOW,
  };
}

describe("SupervisorGoalRunAdapter", () => {
  test("creates a run from only the exact frozen Goal Contract", async () => {
    const drafts: Record<string, unknown>[] = [];
    const adapter = new SupervisorGoalRunAdapter({
      createDraft(input: Record<string, unknown>) {
        drafts.push(input);
        return Promise.resolve({ runId: "run-1", status: "planning" });
      },
    } as never);
    const contract = revision();

    const result = await adapter.createFromContract({
      sourceIntakeId: "intake-1",
      userId: "user-1",
      projectId: "project-1",
      projectRoot: "C:/owned/repo",
      contractRevision: contract,
      consultationResults: [
        {
          consultationId: "consultation-1",
          provider: "chatgpt",
          response: "RAW ADVISORY RESPONSE MUST NOT REACH THE RUN",
        },
      ],
    });

    expect(result).toEqual({ runId: "run-1", status: "planning" });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.sourceGoalContract).toEqual({
      intakeId: "intake-1",
      revisionId: "contract-1",
      revision: 1,
      hash: contract.hash,
      createdAt: NOW,
      contract: proposal(),
    });
    expect(JSON.stringify(drafts[0])).not.toContain("RAW ADVISORY RESPONSE");
  });

  test("rejects a mutated frozen contract before creating a run", async () => {
    let called = false;
    const adapter = new SupervisorGoalRunAdapter({
      createDraft() {
        called = true;
        return Promise.resolve({ runId: "run-1", status: "planning" });
      },
    } as never);
    const contract = revision();
    contract.objective = "Mutated after hashing";

    await expect(
      adapter.createFromContract({
        sourceIntakeId: "intake-1",
        userId: "user-1",
        projectId: "project-1",
        projectRoot: "C:/owned/repo",
        contractRevision: contract,
        consultationResults: [],
      })
    ).rejects.toThrow("hash does not match");
    expect(called).toBe(false);
  });
});

describe("Goal Contract run rendering", () => {
  test("chunks long labeled facts without losing criterion or authority content", () => {
    const statement = `criterion-start:${"x".repeat(3990)}:criterion-end`;
    const contract = proposal({
      acceptanceCriteria: [
        { criterionId: "criterion-long", statement, evidence: "user" },
      ],
    });

    const constraints = renderGoalContractConstraints(contract);
    const criterion = joinLabeledParts(
      constraints,
      "Acceptance criterion 1 (criterion-long, user evidence)"
    );
    const authority = joinLabeledParts(constraints, "Authority policy");

    expect(constraints.every((item) => item.length <= 4000)).toBe(true);
    expect(criterion).toBe(statement);
    expect(authority).toBe(JSON.stringify(contract.authority));
    expect(
      constraints.some((item) => item.includes("Unresolved question"))
    ).toBe(true);
  });

  test("fails closed instead of dropping an oversized approved contract", () => {
    const tooManyConstraints = proposal({
      changeBoundary: Array.from(
        { length: 128 },
        (_, index) => `${index}:${"x".repeat(3998)}`
      ),
    });
    expect(() => renderGoalContractConstraints(tooManyConstraints)).toThrow(
      "exceeding the run limit of 128"
    );

    const tooLongIntent = proposal({ objective: "x".repeat(32_000) });
    expect(() => renderGoalContractIntent(tooLongIntent)).toThrow(
      "exceeds the 32000-character run limit"
    );
  });
});

function joinLabeledParts(constraints: string[], label: string): string {
  return constraints
    .filter((item) => item.startsWith(`${label} [part `))
    .map((item) => item.slice(item.indexOf(": ") + 2))
    .join("");
}

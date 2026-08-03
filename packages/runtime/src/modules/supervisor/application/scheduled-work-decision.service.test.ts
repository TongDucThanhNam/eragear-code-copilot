import { describe, expect, it } from "bun:test";
import type { ScheduledWorkDecisionSnapshot } from "./scheduled-work-decision.contract";
import { ScheduledWorkDecisionService } from "./scheduled-work-decision.service";

describe("ScheduledWorkDecisionService", () => {
  it("reads fresh project state for every decision and does not replay an obsolete prompt", async () => {
    let contextRevision = 0;
    const captured: ScheduledWorkDecisionSnapshot[] = [];
    const service = new ScheduledWorkDecisionService({
      now: () => 1234,
      projectContext: {
        build: () => {
          contextRevision += 1;
          return Promise.resolve({
            topLevelEntries: ["src"],
            files: [
              {
                path: "src/state.ts",
                kind: "entry" as const,
                excerpt: `revision-${contextRevision}`,
              },
            ],
            diagnostics: [],
          });
        },
      },
      projectIntelligence: {
        analyze: async () => ({
          status: "ready",
          symbolExtractionMode: "ast",
          graphNodes: [],
          symbolMatches: [],
          routeMap: [],
          diagnostics: [],
        }),
      },
      memory: {
        lookup: async () => ({ results: [] }),
        appendLog: async () => undefined,
      },
      research: { search: async () => [] },
      decision: {
        decide: (snapshot) => {
          captured.push(snapshot);
          const revision = snapshot.projectContext.files[0]?.excerpt;
          return Promise.resolve({
            action: "dispatch",
            prompt: `Continue from ${revision}`,
            rationale: `Observed ${revision}`,
            evidenceSummary: `Fresh context contains ${revision}`,
          } as const);
        },
      },
    });
    const input = {
      scheduleId: "schedule-1",
      userId: "user-1",
      projectId: "project-1",
      projectRoot: "C:/repo",
      objective: "Finish the objective",
      workMode: "adaptive_session" as const,
      priorEvidence: [
        {
          runId: "run-old",
          status: "completed",
          completionState: "work_completed",
          promptHash: "a".repeat(64),
        },
      ],
    };

    const first = await service.execute(input);
    const second = await service.execute(input);

    expect(first.prompt).toBe("Continue from revision-1");
    expect(second.prompt).toBe("Continue from revision-2");
    expect(second.decidedAt).toBe(1234);
    expect(captured).toHaveLength(2);
    expect(captured[1]?.priorEvidence).toEqual(input.priorEvidence);
  });

  it("returns Supervisor completion without manufacturing a dispatch prompt", async () => {
    const service = new ScheduledWorkDecisionService({
      projectContext: {
        build: async () => ({
          topLevelEntries: [],
          files: [],
          diagnostics: [],
        }),
      },
      memory: {
        lookup: async () => ({ results: [] }),
        appendLog: async () => undefined,
      },
      research: { search: async () => [] },
      decision: {
        decide: async () => ({
          action: "complete",
          rationale: "All acceptance checks pass.",
          evidenceSummary:
            "The focused tests and final verification are green.",
        }),
      },
    });

    const result = await service.execute({
      scheduleId: "schedule-1",
      userId: "user-1",
      projectRoot: "C:/repo",
      objective: "Finish the objective",
      workMode: "supervisor_run",
      priorEvidence: [],
    });

    expect(result.action).toBe("complete");
    expect("prompt" in result).toBe(false);
  });
});

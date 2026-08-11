import { describe, expect, test } from "bun:test";
import type { SupervisorRunClientUpdate } from "@eragear-code-copilot/shared";
import { collectSupervisorManagerInboxItems } from "./supervisor-manager-inbox.service";

describe("collectSupervisorManagerInboxItems", () => {
  test("projects only durable open decisions by default", () => {
    const run: SupervisorRunClientUpdate = {
      runId: "run-1",
      revision: 7,
      projectId: "project-1",
      status: "needs_user",
      priority: "urgent",
      tasks: [],
      gates: [],
      capacityWaits: [],
      decisions: [
        {
          decisionId: "open-1",
          kind: "product_ambiguity",
          status: "open",
          prompt: "Which API behavior is required?",
          createdAt: "2026-08-10T01:00:00.000Z",
        },
        {
          decisionId: "answered-1",
          kind: "permission",
          status: "answered",
          prompt: "Allow the extra scope?",
          createdAt: "2026-08-10T00:00:00.000Z",
          answeredAt: "2026-08-10T00:05:00.000Z",
        },
      ],
      finalVerification: [],
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T01:00:00.000Z",
    };

    expect(collectSupervisorManagerInboxItems(run)).toEqual([
      {
        runId: "run-1",
        revision: 7,
        projectId: "project-1",
        runStatus: "needs_user",
        priority: "urgent",
        decisionId: "open-1",
        kind: "product_ambiguity",
        status: "open",
        prompt: "Which API behavior is required?",
        createdAt: "2026-08-10T01:00:00.000Z",
      },
    ]);
    expect(collectSupervisorManagerInboxItems(run, true)).toHaveLength(2);
  });
});

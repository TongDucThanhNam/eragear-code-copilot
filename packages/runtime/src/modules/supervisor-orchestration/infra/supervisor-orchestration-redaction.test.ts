import { describe, expect, test } from "bun:test";
import { createClientSafeSupervisorRunUpdate } from "../application/supervisor-run-events.service";
import { createSupervisorRunFixture } from "../domain/supervisor-run.test-fixture";

describe("supervisor orchestration redaction", () => {
  test("omits API keys, env values, prompts, transcripts, and patch bodies", () => {
    const secrets = [
      "sk-live-secret",
      "MINIMAX_API_KEY=secret",
      "raw worker prompt",
      "full sibling transcript",
      "diff --git a/secret b/secret",
    ];
    const run = createSupervisorRunFixture({
      originalIntent: secrets.join(" "),
      constraints: secrets,
      audit: [
        {
          auditId: "audit-1",
          kind: "run_created",
          actor: "user",
          summary: secrets.join(" "),
          createdAt: "2026-07-11T00:00:00.000Z",
        },
      ],
    });
    const exported = JSON.stringify(createClientSafeSupervisorRunUpdate(run));
    for (const secret of secrets) {
      expect(exported).not.toContain(secret);
    }
    expect(exported).not.toContain("stateJson");
    expect(exported).not.toContain("storageRef");
  });
});

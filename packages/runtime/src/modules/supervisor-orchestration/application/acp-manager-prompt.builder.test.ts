import { describe, expect, test } from "bun:test";
import { createSupervisorRunFixture } from "../domain/supervisor-run.test-fixture";
import { buildAcpManagerPrompt } from "./acp-manager-prompt.builder";

describe("buildAcpManagerPrompt", () => {
  test("requires the authoritative intent to be copied verbatim into the envelope", () => {
    const run = createSupervisorRunFixture({ status: "planning" });

    const prompt = buildAcpManagerPrompt({ run, turnKind: "plan" });

    expect(prompt).toContain(
      "copy the supplied intent verbatim into envelope.goal"
    );
    expect(prompt).toContain(
      "task.role must be exactly one of research, implementation, test, review, or integration"
    );
    expect(prompt).toContain(
      "task.dependencies, task.scopeIntent, and task.verificationRequirements must each be JSON arrays of strings"
    );
    expect(prompt).toContain(
      "Every task.scopeIntent item must be an exact repo-relative file path from envelope.fileScopes"
    );
    expect(prompt).toContain(
      "Worker task titles, goals, and verificationRequirements must never instruct commit, push, PR, deploy, branch switching, delivery, or runtime state transitions"
    );
    expect(prompt).toContain(
      "Use destructiveActions=[] when none are requested"
    );
    expect(prompt).toContain(
      "delivery must contain createCommit, targetBranch, targetHead, and allowDefaultBranch"
    );
    expect(prompt).toContain(JSON.stringify(run.originalIntent));
  });
});

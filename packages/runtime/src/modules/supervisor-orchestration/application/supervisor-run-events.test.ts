import { describe, expect, test } from "bun:test";
import { SUPERVISOR_RUN_UPDATE_SCHEMA } from "@eragear-code-copilot/shared";
import { createSupervisorRunFixture } from "../domain/supervisor-run.test-fixture";
import { createClientSafeSupervisorRunUpdate } from "./supervisor-run-events.service";

describe("supervisor run client events", () => {
  test("maps strict status evidence without prompts, secrets, transcripts, or patches", () => {
    const secret = "sk-secret-value";
    const run = createSupervisorRunFixture({
      originalIntent: `Do work with ${secret}`,
      constraints: [`Never print ${secret}`],
    });
    const update = createClientSafeSupervisorRunUpdate(run);
    const json = JSON.stringify(update);

    expect(SUPERVISOR_RUN_UPDATE_SCHEMA.parse(update)).toEqual(update);
    expect(json).not.toContain(secret);
    expect(json).not.toContain("originalIntent");
    expect(json).not.toContain("constraints");
    expect(json).not.toContain("storageRef");
    expect(json).not.toContain("resultText");
    expect(json).not.toContain("rawTranscript");
  });
});

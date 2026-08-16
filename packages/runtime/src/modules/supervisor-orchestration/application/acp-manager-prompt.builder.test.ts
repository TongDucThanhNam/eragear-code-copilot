import { describe, expect, test } from "bun:test";
import { createSupervisorRunFixture } from "../domain/supervisor-run.test-fixture";
import { buildAcpManagerPrompt } from "./acp-manager-prompt.builder";

describe("buildAcpManagerPrompt", () => {
  test("requires the authoritative intent to be copied verbatim into the envelope", () => {
    const run = createSupervisorRunFixture({ status: "planning" });

    const prompt = buildAcpManagerPrompt({
      run,
      turnKind: "plan",
      trustedVerificationCommands: ["bun test"],
    });

    expect(prompt).toContain(
      "copy the supplied intent verbatim into envelope.goal"
    );
    expect(prompt).toContain(
      "task.role must be exactly one of research, implementation, test, review, or integration"
    );
    expect(prompt).toContain(
      "task.dependencies, task.scopeIntent, and task.verificationRequirements must each be JSON arrays of strings"
    );
    expect(prompt).toContain("optional preferredModelId");
    expect(prompt).toContain("copy that id exactly without an effort suffix");
    expect(prompt).toContain(
      "Every task.scopeIntent item must be an exact repo-relative file path from envelope.fileScopes"
    );
    expect(prompt).toContain(
      "Keep the entire JSON response at or below 12000 characters"
    );
    expect(prompt).toContain(
      "optional top-level runId may be included only when it exactly equals the supplied runId"
    );
    expect(prompt).toContain(
      "a directory root covers its descendants, so do not enumerate files"
    );
    expect(prompt).toContain(
      "do not create separate research or per-deliverable verification tasks"
    );
    expect(prompt).toContain(
      "must omit every runtime-owned delivery, repository-mutation, credential, permission, and destructive-action term entirely"
    );
    expect(prompt).toContain("even inside a negative prohibition");
    expect(prompt).toContain("scans the literal task text");
    expect(prompt).toContain(
      "Use destructiveActions=[] when none are requested"
    );
    expect(prompt).toContain(
      "delivery must contain createCommit, targetBranch, targetHead, and allowDefaultBranch"
    );
    expect(prompt).toContain("top-level discriminator field is named kind");
    expect(prompt).toContain("Never prefix the selected root folder name");
    expect(prompt).toContain(
      "Copy context.trustedVerificationCommands exactly"
    );
    expect(prompt).toContain("Set delivery.allowDefaultBranch=true");
    expect(prompt).toContain(JSON.stringify(run.originalIntent));
    expect(prompt).toContain('"trustedVerificationCommands":["bun test"]');
  });

  test("adds a research-first Arena planning contract without granting component writes", () => {
    const run = createSupervisorRunFixture({
      status: "planning",
      originalIntent: "Create an AWWWARDS Arena entry in demos/gilt-and-brine",
    });

    const prompt = buildAcpManagerPrompt({ run, turnKind: "plan" });

    expect(prompt).toContain("This is an AWWWARDS Arena entry");
    expect(prompt).toContain("inspect LIBRARY.md before source");
    expect(prompt).toContain("at least three shortlisted components");
    expect(prompt).toContain("never inspect an unrequested demos/<slug> entry");
    expect(prompt).toContain("read-only benchmark audit");
    expect(prompt).toContain("Reject safe AI art direction");
    expect(prompt).toContain("benchmark-relative creative gate");
    expect(prompt).toContain("sphere/disc/blob/gradient primitives");
    expect(prompt).toContain("at least three are object-led");
    expect(prompt).toContain("side-by-side contact-sheet audit");
    expect(prompt).toContain("Pre-build self-scores");
    expect(prompt).toContain("non-vision-audited visual evidence");
    expect(prompt).toContain("read-only research sources");
    expect(prompt).toContain("must never appear in scopeIntent");
    expect(prompt).toContain("rendered side-by-side contact-sheet audit");
    expect(prompt).toContain("fixed header over dead space");
    expect(prompt).toContain("preserve their real exit codes");
    expect(prompt).toContain("never inferred success");
  });
});

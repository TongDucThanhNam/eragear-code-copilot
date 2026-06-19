import { describe, expect, test } from "bun:test";
import {
  ApproveHookRunRequestSchema,
  ExportHookRunsRequestSchema,
  ReviewHookRunRequestSchema,
  RunHookBatchRequestSchema,
  RunHookRequestSchema,
  ToggleHookRequestSchema,
  TrustHookRequestSchema,
  UpdateAutomationSchedulingPolicyRequestSchema,
  UpdateHookLifecyclePolicyRequestSchema,
  UpsertHookRequestSchema,
} from "./settings-local-ade-automation-router-data";

describe("settings Local ADE automation request schemas", () => {
  test("accepts canonical project-local hook upserts", () => {
    expect(
      UpsertHookRequestSchema.parse({
        projectId: "project-1",
        id: "hook-1",
        name: " lint hook ",
        event: " pre-message ",
        enabled: true,
        policyPreset: "restricted",
        envKeys: [" PATH "],
        command: " bun ",
        args: ["run", "lint"],
        timeoutMs: 5000,
        workingDirectory: "packages/runtime",
      })
    ).toEqual({
      projectId: "project-1",
      id: "hook-1",
      name: "lint hook",
      event: "pre-message",
      enabled: true,
      policyPreset: "restricted",
      envKeys: ["PATH"],
      command: "bun",
      args: ["run", "lint"],
      timeoutMs: 5000,
      workingDirectory: "packages/runtime",
    });
  });

  test("keeps hook descriptor requests strict and narrow", () => {
    expect(
      UpsertHookRequestSchema.safeParse({
        name: "lint hook",
        command: "bun",
        trustedFingerprint: "sha256:abc",
      }).success
    ).toBe(false);

    expect(
      ToggleHookRequestSchema.safeParse({
        id: "hook-1",
        enabled: true,
        command: "bun",
      }).success
    ).toBe(false);
  });

  test("keeps lifecycle and scheduling controls bounded at the tRPC request seam", () => {
    expect(
      UpdateHookLifecyclePolicyRequestSchema.parse({
        projectId: "project-1",
        enabled: true,
        disabledEvents: [" pre-message "],
        failureMode: "stop-on-failure",
      })
    ).toEqual({
      projectId: "project-1",
      enabled: true,
      disabledEvents: ["pre-message"],
      failureMode: "stop-on-failure",
    });

    expect(
      UpdateAutomationSchedulingPolicyRequestSchema.safeParse({
        maxConcurrentRuns: 5,
      }).success
    ).toBe(false);

    expect(
      UpdateAutomationSchedulingPolicyRequestSchema.safeParse({
        cooldownMs: 600_001,
      }).success
    ).toBe(false);
  });

  test("requires fingerprint-shaped trust and approval requests", () => {
    expect(
      TrustHookRequestSchema.parse({
        hookId: " hook-1 ",
        fingerprint: " sha256:abc ",
      })
    ).toEqual({
      hookId: "hook-1",
      fingerprint: "sha256:abc",
    });

    expect(
      ApproveHookRunRequestSchema.safeParse({
        hookId: "hook-1",
        operationFingerprint: "abc",
      }).success
    ).toBe(false);
  });

  test("keeps hook run requests strict and confirmation-backed", () => {
    expect(
      RunHookRequestSchema.parse({
        projectId: "project-1",
        hookId: " hook-1 ",
        confirmation: " run-hook ",
        operationApprovalId: " approval-1 ",
      })
    ).toEqual({
      projectId: "project-1",
      hookId: "hook-1",
      confirmation: "run-hook",
      operationApprovalId: "approval-1",
    });

    expect(
      RunHookRequestSchema.safeParse({
        hookId: "hook-1",
        confirmation: " ",
        operationApprovalId: "approval-1",
      }).success
    ).toBe(false);
  });

  test("bounds batch hooks and fingerprint maps", () => {
    expect(
      RunHookBatchRequestSchema.parse({
        hookIds: [" hook-1 "],
        operationFingerprints: {
          " hook-1 ": " sha256:abc ",
        },
        confirmation: " run-hooks ",
        failureMode: "continue",
      })
    ).toEqual({
      hookIds: ["hook-1"],
      operationFingerprints: {
        "hook-1": "sha256:abc",
      },
      confirmation: "run-hooks",
      failureMode: "continue",
    });

    expect(
      RunHookBatchRequestSchema.safeParse({
        hookIds: Array.from({ length: 9 }, (_, index) => `hook-${index}`),
        operationFingerprints: {},
        confirmation: "run-hooks",
      }).success
    ).toBe(false);
  });

  test("keeps hook audit review and export requests narrow", () => {
    expect(
      ReviewHookRunRequestSchema.parse({
        runId: " run-1 ",
        reviewed: true,
      })
    ).toEqual({
      runId: "run-1",
      reviewed: true,
    });

    expect(ExportHookRunsRequestSchema.parse(undefined)).toBeUndefined();

    expect(
      ExportHookRunsRequestSchema.safeParse({
        reviewState: "open",
        status: "failed",
        limit: 201,
      }).success
    ).toBe(false);
  });
});

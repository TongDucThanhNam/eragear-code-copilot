import { describe, expect, test } from "bun:test";
import {
  ClearProviderModelRequestSchema,
  SelectProviderModelRequestSchema,
  TestProviderRequestSchema,
  UpdateCapabilityStateRequestSchema,
} from "./settings-provider-router-data";

describe("settings provider request schemas", () => {
  test("keeps capability state updates strict and trimmed", () => {
    expect(
      UpdateCapabilityStateRequestSchema.parse({
        projectId: "project-1",
        capabilityId: " mcp ",
        enabled: true,
      })
    ).toEqual({
      projectId: "project-1",
      capabilityId: "mcp",
      enabled: true,
    });

    expect(
      UpdateCapabilityStateRequestSchema.safeParse({
        capabilityId: "mcp",
        enabled: true,
        source: "snapshot",
      }).success
    ).toBe(false);
  });

  test("keeps provider probe requests narrow", () => {
    expect(
      TestProviderRequestSchema.parse({
        providerId: " codex ",
      })
    ).toEqual({
      providerId: "codex",
    });

    expect(
      TestProviderRequestSchema.safeParse({
        providerId: " ",
      }).success
    ).toBe(false);
  });

  test("keeps selected provider model explicit", () => {
    expect(
      SelectProviderModelRequestSchema.parse({
        projectId: "project-1",
        providerId: " codex ",
        modelId: " gpt-5 ",
      })
    ).toEqual({
      projectId: "project-1",
      providerId: "codex",
      modelId: "gpt-5",
    });

    expect(
      SelectProviderModelRequestSchema.safeParse({
        providerId: "codex",
        modelId: "gpt-5",
        providerName: "Codex",
      }).success
    ).toBe(false);
  });

  test("accepts omitted clear-provider input and rejects stored fields", () => {
    expect(ClearProviderModelRequestSchema.parse(undefined)).toBeUndefined();

    expect(
      ClearProviderModelRequestSchema.parse({
        projectId: "project-1",
      })
    ).toEqual({
      projectId: "project-1",
    });

    expect(
      ClearProviderModelRequestSchema.safeParse({
        projectId: "project-1",
        providerId: "codex",
      }).success
    ).toBe(false);
  });
});

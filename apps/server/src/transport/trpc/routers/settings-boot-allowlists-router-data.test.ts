import { describe, expect, test } from "bun:test";
import { UpdateBootAllowlistsRequestSchema } from "./settings-boot-allowlists-router-data";

describe("UpdateBootAllowlistsRequestSchema", () => {
  test("accepts canonical typed boot allowlist updates", () => {
    const request = {
      allowedAgentCommandPolicies: [
        {
          command: " bun ",
          allowAnyArgs: false,
          allowedArgs: ["run", "dev"],
          allowedArgPatterns: ["^--filter=.*"],
        },
      ],
      allowedTerminalCommandPolicies: [
        {
          command: "git",
          allowAnyArgs: true,
        },
      ],
      allowedEnvKeys: ["PATH", "HOME"],
      commonSettings: {
        wsAuthTimeoutMs: 1500,
        logFileEnabled: true,
        acpEnableTerminal: false,
      },
    };

    expect(UpdateBootAllowlistsRequestSchema.parse(request)).toEqual({
      ...request,
      allowedAgentCommandPolicies: [
        {
          ...request.allowedAgentCommandPolicies[0],
          command: "bun",
        },
      ],
    });
  });

  test("keeps the top-level request object strict", () => {
    expect(
      UpdateBootAllowlistsRequestSchema.safeParse({
        allowedEnvKeys: ["PATH"],
        sourcePath: "settings.json",
      }).success
    ).toBe(false);
  });

  test("keeps nested common settings strict", () => {
    expect(
      UpdateBootAllowlistsRequestSchema.safeParse({
        commonSettings: {
          logFileEnabled: true,
          restartRequired: true,
        },
      }).success
    ).toBe(false);
  });

  test("keeps nested command policies strict", () => {
    expect(
      UpdateBootAllowlistsRequestSchema.safeParse({
        allowedAgentCommandPolicies: [
          {
            command: "bun",
            allowAnyArgs: true,
            cwd: "apps/server",
          },
        ],
      }).success
    ).toBe(false);
  });

  test("rejects empty command and env keys before application policy runs", () => {
    expect(
      UpdateBootAllowlistsRequestSchema.safeParse({
        allowedAgentCommandPolicies: [{ command: " " }],
      }).success
    ).toBe(false);

    expect(
      UpdateBootAllowlistsRequestSchema.safeParse({
        allowedEnvKeys: [" "],
      }).success
    ).toBe(false);
  });

  test("does not accept raw boot config string values through tRPC", () => {
    expect(
      UpdateBootAllowlistsRequestSchema.safeParse({
        commonSettings: {
          wsAuthTimeoutMs: "1500",
          logFileEnabled: "true",
        },
      }).success
    ).toBe(false);
  });
});

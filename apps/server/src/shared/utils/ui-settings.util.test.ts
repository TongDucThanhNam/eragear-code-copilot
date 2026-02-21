import { describe, expect, test } from "bun:test";
import type { Settings } from "@/shared/types/settings.types";
import { parseUiSettingsForm } from "./ui-settings.util";

const VALIDATION_ERROR_REGEX = /maxTokens|too_small|greater than/i;

function createSettingsFixture(): Settings {
  return {
    ui: {
      theme: "system",
      accentColor: "#2563eb",
      density: "comfortable",
      fontScale: 1,
    },
    projectRoots: ["/workspace/project"],
    mcpServers: [],
    app: {
      sessionIdleTimeoutMs: 600_000,
      sessionListPageMaxLimit: 500,
      sessionMessagesPageMaxLimit: 200,
      logLevel: "info",
      maxTokens: 8192,
      defaultModel: "gpt-4.1",
      acpPromptMetaPolicy: "allowlist",
      acpPromptMetaAllowlist: ["/usr/local/bin/codex"],
    },
  };
}

describe("parseUiSettingsForm", () => {
  test("parses app runtime fields from form data", () => {
    const current = createSettingsFixture();
    const parsed = parseUiSettingsForm(
      {
        "app.sessionIdleTimeoutMs": "30000",
        "app.sessionListPageMaxLimit": "77",
        "app.sessionMessagesPageMaxLimit": "55",
        "app.logLevel": "warn",
        "app.maxTokens": "4096",
        "app.defaultModel": "  claude-4  ",
        "app.acpPromptMetaPolicy": "always",
        "app.acpPromptMetaAllowlist":
          "/usr/local/bin/codex\n/usr/local/bin/claude-code",
      },
      current
    );

    expect(parsed.app).toEqual({
      sessionIdleTimeoutMs: 30_000,
      sessionListPageMaxLimit: 77,
      sessionMessagesPageMaxLimit: 55,
      logLevel: "warn",
      maxTokens: 4096,
      defaultModel: "claude-4",
      acpPromptMetaPolicy: "always",
      acpPromptMetaAllowlist: [
        "/usr/local/bin/codex",
        "/usr/local/bin/claude-code",
      ],
    });
  });

  test("preserves defaultModel when field is missing", () => {
    const current = createSettingsFixture();
    const parsed = parseUiSettingsForm(
      {
        "app.maxTokens": "2048",
      },
      current
    );

    expect(parsed.app.defaultModel).toBe(current.app.defaultModel);
    expect(parsed.app.acpPromptMetaPolicy).toBe(
      current.app.acpPromptMetaPolicy
    );
    expect(parsed.app.acpPromptMetaAllowlist).toEqual(
      current.app.acpPromptMetaAllowlist
    );
  });

  test("clears defaultModel when explicit blank value is submitted", () => {
    const current = createSettingsFixture();
    const parsed = parseUiSettingsForm(
      {
        "app.defaultModel": "   ",
      },
      current
    );

    expect(parsed.app.defaultModel).toBe("");
  });

  test("fails fast when app payload violates shared schema", () => {
    const current = createSettingsFixture();
    expect(() =>
      parseUiSettingsForm(
        {
          "app.maxTokens": "0",
        },
        current
      )
    ).toThrow(VALIDATION_ERROR_REGEX);
  });
});

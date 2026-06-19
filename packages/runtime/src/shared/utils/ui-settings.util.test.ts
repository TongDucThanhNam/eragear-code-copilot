import { describe, expect, test } from "bun:test";
import type { Settings } from "#runtime/shared/types/settings.types";
import { parseUiSettingsForm } from "./ui-settings.util";

const VALIDATION_ERROR_REGEX = /maxTokens|too_small|greater than/i;

function createSettingsFixture(): Settings {
  return {
    ui: {
      theme: "system",
      accentColor: "#2563eb",
      density: "comfortable",
      fontScale: 1,
      showReasoning: true,
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
      supervisorEnabled: false,
      supervisorModel: "",
      supervisorDeepSeekApiKey: "",
      supervisorDecisionTimeoutMs: 30_000,
      supervisorDecisionMaxAttempts: 2,
      supervisorMaxRuntimeMs: 1_800_000,
      supervisorMaxRepeatedPrompts: 20,
      supervisorWebSearchProvider: "none",
      supervisorWebSearchApiKey: "",
      supervisorMemoryProvider: "none",
      supervisorObsidianCommand: "obsidian",
      supervisorObsidianVault: "",
      supervisorObsidianBlueprintPath: "",
      supervisorObsidianLogPath: "",
      supervisorObsidianSearchPath: "Project",
      supervisorObsidianSearchLimit: 3,
      supervisorObsidianTimeoutMs: 5000,
      projectIndexEmbeddingEndpoint: "",
      projectIndexEmbeddingModel: "text-embedding-3-small",
      projectIndexEmbeddingApiKey: "",
      projectIndexEmbeddingTimeoutMs: 10_000,
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
        "app.supervisorEnabled": "true",
        "app.supervisorModel": "  deepseek/deepseek-chat  ",
        "app.supervisorDeepSeekApiKey": "  sk-test-supervisor  ",
        "app.supervisorDecisionTimeoutMs": "45000",
        "app.supervisorDecisionMaxAttempts": "3",
        "app.supervisorMaxRuntimeMs": "900000",
        "app.supervisorMaxRepeatedPrompts": "12",
        "app.supervisorWebSearchProvider": "exa",
        "app.supervisorWebSearchApiKey": "  exa-test-key  ",
        "app.supervisorMemoryProvider": "obsidian",
        "app.supervisorObsidianCommand": "  obsidian-cli  ",
        "app.supervisorObsidianVault": "  Work  ",
        "app.supervisorObsidianBlueprintPath": "  Project/Blueprint.md  ",
        "app.supervisorObsidianLogPath": "  Project/Supervisor.md  ",
        "app.supervisorObsidianSearchPath": "  Project  ",
        "app.supervisorObsidianSearchLimit": "5",
        "app.supervisorObsidianTimeoutMs": "7000",
        "app.projectIndexEmbeddingEndpoint":
          "  http://127.0.0.1:11434/v1/embeddings  ",
        "app.projectIndexEmbeddingModel": "  nomic-embed-text  ",
        "app.projectIndexEmbeddingApiKey": "  local-embedding-secret  ",
        "app.projectIndexEmbeddingTimeoutMs": "12000",
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
      supervisorEnabled: true,
      supervisorModel: "deepseek/deepseek-chat",
      supervisorDeepSeekApiKey: "sk-test-supervisor",
      supervisorDecisionTimeoutMs: 45_000,
      supervisorDecisionMaxAttempts: 3,
      supervisorMaxRuntimeMs: 900_000,
      supervisorMaxRepeatedPrompts: 12,
      supervisorWebSearchProvider: "exa",
      supervisorWebSearchApiKey: "exa-test-key",
      supervisorMemoryProvider: "obsidian",
      supervisorObsidianCommand: "obsidian-cli",
      supervisorObsidianVault: "Work",
      supervisorObsidianBlueprintPath: "Project/Blueprint.md",
      supervisorObsidianLogPath: "Project/Supervisor.md",
      supervisorObsidianSearchPath: "Project",
      supervisorObsidianSearchLimit: 5,
      supervisorObsidianTimeoutMs: 7000,
      projectIndexEmbeddingEndpoint: "http://127.0.0.1:11434/v1/embeddings",
      projectIndexEmbeddingModel: "nomic-embed-text",
      projectIndexEmbeddingApiKey: "local-embedding-secret",
      projectIndexEmbeddingTimeoutMs: 12_000,
      acpPromptMetaPolicy: "always",
      acpPromptMetaAllowlist: [
        "/usr/local/bin/codex",
        "/usr/local/bin/claude-code",
      ],
    });
    expect(parsed.ui.showReasoning).toBe(true);
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

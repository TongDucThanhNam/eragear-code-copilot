import { describe, expect, test } from "bun:test";
import type { SettingsPatch } from "@/modules/settings";
import type { Settings } from "@/shared/types/settings.types";
import {
  parseFormUiSettingsRouteInput,
  parseJsonUiSettingsRouteInput,
  readUiSettingsRouteInput,
} from "./settings-route-input";

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

describe("settings-route-input", () => {
  test("accepts JSON object patches without owning settings validation", () => {
    const payload = {
      app: {
        maxTokens: 4096,
      },
    };

    expect(parseJsonUiSettingsRouteInput(payload)).toEqual({
      ok: true,
      input: payload,
    });
  });

  test("rejects non-object JSON patches before settings use cases run", () => {
    expect(parseJsonUiSettingsRouteInput(null)).toEqual({
      ok: false,
      error: "settings patch must be an object",
    });
    expect(parseJsonUiSettingsRouteInput([])).toEqual({
      ok: false,
      error: "settings patch must be an object",
    });
  });

  test("normalizes form payloads into a settings patch", () => {
    const parsed = parseFormUiSettingsRouteInput(
      {
        "ui.theme": "dark",
        "ui.accentColor": "#16a34a",
        "ui.density": "compact",
        "ui.fontScale": "1.1",
        "projectRoots[0]": "/workspace/project",
        newRoot: "/workspace/second",
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
      createSettingsFixture()
    );

    expect(parsed).toEqual({
      ui: {
        theme: "dark",
        accentColor: "#16a34a",
        density: "compact",
        fontScale: 1.1,
      },
      projectRoots: ["/workspace/project", "/workspace/second"],
      app: {
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
      },
    });
  });

  test("selects JSON reader for application/json content types", async () => {
    const payload: SettingsPatch = { ui: { theme: "dark" } };
    let formRead = false;
    let settingsRead = false;

    const result = await readUiSettingsRouteInput({
      contentType: "application/json; charset=utf-8",
      readJson: async () => payload,
      readForm: () => {
        formRead = true;
        return Promise.resolve({});
      },
      getCurrentSettings: () => {
        settingsRead = true;
        return Promise.resolve(createSettingsFixture());
      },
    });

    expect(result).toEqual({ ok: true, input: payload });
    expect(formRead).toBe(false);
    expect(settingsRead).toBe(false);
  });

  test("selects form reader for non-JSON content types", async () => {
    let jsonRead = false;

    const result = await readUiSettingsRouteInput({
      contentType: "application/x-www-form-urlencoded",
      readJson: () => {
        jsonRead = true;
        return Promise.resolve({});
      },
      readForm: async () => ({
        "ui.theme": "light",
      }),
      getCurrentSettings: async () => createSettingsFixture(),
    });

    expect(jsonRead).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.ok && result.input.ui?.theme).toBe("light");
  });
});

import { describe, expect, test } from "bun:test";
import type { SettingsRepositoryPort } from "@/modules/settings";
import type { Settings } from "@/shared/types/settings.types";
import {
  AppConfigService,
  createDefaultAppConfigFromEnv,
} from "./app-config.service";

function createSettingsRepoStub(settings: Settings): SettingsRepositoryPort {
  return {
    get: async () => settings,
    update: async () => settings,
  };
}

function createSettingsWithAppOverride(override: Settings["app"]): Settings {
  return {
    ui: {
      theme: "system",
      accentColor: "#2563eb",
      density: "comfortable",
      fontScale: 1,
    },
    projectRoots: [process.cwd()],
    mcpServers: [],
    app: override,
  };
}

describe("AppConfigService", () => {
  test("loads app config overrides from settings repository", async () => {
    const defaults = createDefaultAppConfigFromEnv();
    const service = await AppConfigService.create(
      createSettingsRepoStub(
        createSettingsWithAppOverride({
          ...defaults,
          sessionListPageMaxLimit: 77,
        })
      )
    );

    expect(service.getConfig().sessionListPageMaxLimit).toBe(77);
  });

  test("falls back to env defaults when settings load fails", async () => {
    const service = await AppConfigService.create({
      get: () => Promise.reject(new Error("storage unavailable")),
      update: (_patch) => Promise.reject(new Error("not implemented")),
    });

    expect(service.getConfig()).toEqual(createDefaultAppConfigFromEnv());
  });

  test("validatePatch fails on invalid values", () => {
    const defaults = createDefaultAppConfigFromEnv();
    const service = new AppConfigService(defaults, defaults);

    expect(() =>
      service.validatePatch({ sessionMessagesPageMaxLimit: 0 })
    ).toThrow();
  });

  test("reloadFromSettings emits change notifications", () => {
    const defaults = createDefaultAppConfigFromEnv();
    const service = new AppConfigService(defaults, defaults);
    const emitted: number[] = [];

    service.subscribe((next) => {
      emitted.push(next.sessionIdleTimeoutMs);
    });

    service.reloadFromSettings(
      createSettingsWithAppOverride({
        ...defaults,
        sessionIdleTimeoutMs: defaults.sessionIdleTimeoutMs + 1000,
      })
    );

    expect(emitted).toEqual([defaults.sessionIdleTimeoutMs + 1000]);
  });
});

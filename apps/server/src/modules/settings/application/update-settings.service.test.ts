import { describe, expect, test } from "bun:test";
import path from "node:path";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { DomainEvent } from "@/shared/types/domain-events.types";
import type { Settings } from "@/shared/types/settings.types";
import {
  AppConfigService,
  createDefaultAppConfigFromEnv,
} from "../app-config.service";
import type { SettingsRepositoryPort } from "./ports/settings-repository.port";
import { UpdateSettingsService } from "./update-settings.service";

function createBaseSettings(): Settings {
  return {
    ui: {
      theme: "system",
      accentColor: "#008080",
      density: "comfortable",
      fontScale: 1,
    },
    projectRoots: [process.cwd()],
    mcpServers: [],
    app: createDefaultAppConfigFromEnv(),
  };
}

function createEventBusStub(events: DomainEvent[]): EventBusPort {
  return {
    subscribe: () => () => undefined,
    publish: (event) => {
      events.push(event);
      return Promise.resolve();
    },
  };
}

describe("UpdateSettingsService", () => {
  test("updates settings through aggregate and emits settings events", async () => {
    let stored = createBaseSettings();
    const events: DomainEvent[] = [];
    const repo: SettingsRepositoryPort = {
      get: () => Promise.resolve(stored),
      update: (patch) => {
        stored = {
          ...stored,
          ...patch,
        };
        return Promise.resolve(stored);
      },
    };
    const appConfigService = new AppConfigService(stored.app, stored.app);
    const service = new UpdateSettingsService(
      repo,
      createEventBusStub(events),
      appConfigService
    );

    const result = await service.execute({
      ui: {
        theme: "dark",
        accentColor: stored.ui.accentColor,
        density: stored.ui.density,
        fontScale: stored.ui.fontScale,
      },
      projectRoots: [path.join(process.cwd(), "src")],
    });

    expect(result.changedKeys).toContain("ui");
    expect(result.changedKeys).toContain("projectRoots");
    expect(result.requiresRestart).toContain("projectRoots");
    expect(stored.ui.theme).toBe("dark");
    expect(stored.projectRoots).toEqual([path.join(process.cwd(), "src")]);
    expect(events.map((event) => event.type)).toEqual([
      "settings_updated",
      "dashboard_refresh",
    ]);
  });

  test("rejects invalid project roots before persistence", async () => {
    const stored = createBaseSettings();
    const repo: SettingsRepositoryPort = {
      get: () => Promise.resolve(stored),
      update: () => Promise.reject(new Error("should not be called")),
    };
    const appConfigService = new AppConfigService(stored.app, stored.app);
    const service = new UpdateSettingsService(
      repo,
      createEventBusStub([]),
      appConfigService
    );

    await expect(
      service.execute({
        projectRoots: ["/"],
      })
    ).rejects.toMatchObject({
      name: "ValidationError",
      code: "VALIDATION_ERROR",
    });
  });
});

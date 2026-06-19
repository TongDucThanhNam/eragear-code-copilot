import { describe, expect, test } from "bun:test";
import type { OutputStyleSettings } from "./contracts/output-style.contract";
import { OutputStyleService } from "./output-style.service";
import type {
  MutableOutputStyleStoreSnapshot,
  OutputStyleRepositoryPort,
  OutputStyleStoreSnapshot,
} from "./ports/output-style-repository.port";

class OutputStyleRepositoryStub implements OutputStyleRepositoryPort {
  snapshot: MutableOutputStyleStoreSnapshot = {
    settingsByUserId: {},
  };

  read<T>(
    reader: (snapshot: OutputStyleStoreSnapshot) => T | Promise<T>
  ): Promise<T> {
    return Promise.resolve(reader(cloneSnapshot(this.snapshot)));
  }

  mutate<T>(
    mutator: (snapshot: MutableOutputStyleStoreSnapshot) => T | Promise<T>
  ): Promise<T> {
    return Promise.resolve(mutator(this.snapshot));
  }
}

describe("OutputStyleService", () => {
  test("returns default settings through the service interface", async () => {
    const service = new OutputStyleService(new OutputStyleRepositoryStub(), {
      now: () => 1000,
    });

    const result = await service.getSettings("user-1");

    expect(result.settings).toEqual({
      enabled: false,
      activePresetId: "default",
      updatedAt: 1000,
    });
    expect(result.presets.map((preset) => preset.id)).toContain("concise");
  });

  test("updates settings with service-owned timestamp policy", async () => {
    const repository = new OutputStyleRepositoryStub();
    const service = new OutputStyleService(repository, { now: () => 2000 });

    const result = await service.updateSettings("user-1", {
      enabled: true,
      activePresetId: "review",
    });

    expect(result.settings).toEqual({
      enabled: true,
      activePresetId: "review",
      updatedAt: 2000,
    });
    expect(repository.snapshot.settingsByUserId["user-1"]).toEqual(
      result.settings
    );
  });

  test("returns no prompt prefix when style is disabled", async () => {
    const service = new OutputStyleService(new OutputStyleRepositoryStub(), {
      now: () => 1000,
    });

    const prefix = await service.resolvePromptPrefix("user-1");

    expect(prefix.applied).toBe(false);
  });

  test("builds prompt prefix for enabled presets", async () => {
    const repository = new OutputStyleRepositoryStub();
    const service = new OutputStyleService(repository, { now: () => 2000 });
    await service.updateSettings("user-1", {
      enabled: true,
      activePresetId: "concise",
    });

    const prefix = await service.resolvePromptPrefix("user-1");

    expect(prefix.applied).toBe(true);
    expect(prefix.text).toContain("Response style: Concise");
  });
});

function cloneSnapshot(
  snapshot: MutableOutputStyleStoreSnapshot
): OutputStyleStoreSnapshot {
  return {
    settingsByUserId: Object.fromEntries(
      Object.entries(snapshot.settingsByUserId).map(([userId, settings]) => [
        userId,
        cloneSettings(settings),
      ])
    ),
  };
}

function cloneSettings(settings: OutputStyleSettings): OutputStyleSettings {
  return { ...settings };
}

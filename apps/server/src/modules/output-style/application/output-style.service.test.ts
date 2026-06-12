import { describe, expect, test } from "bun:test";
import type {
  OutputStyleSettings,
  UpdateOutputStyleSettingsInput,
} from "./contracts/output-style.contract";
import { OutputStyleService } from "./output-style.service";
import type { OutputStyleRepositoryPort } from "./ports/output-style-repository.port";

class OutputStyleRepositoryStub implements OutputStyleRepositoryPort {
  settings: OutputStyleSettings = {
    enabled: false,
    activePresetId: "default",
    updatedAt: 1,
  };

  getSettings(_userId: string): Promise<OutputStyleSettings> {
    return Promise.resolve(this.settings);
  }

  updateSettings(
    _userId: string,
    input: UpdateOutputStyleSettingsInput
  ): Promise<OutputStyleSettings> {
    this.settings = { ...this.settings, ...input, updatedAt: 2 };
    return Promise.resolve(this.settings);
  }
}

describe("OutputStyleService", () => {
  test("returns no prompt prefix when style is disabled", async () => {
    const service = new OutputStyleService(new OutputStyleRepositoryStub());

    const prefix = await service.resolvePromptPrefix("user-1");

    expect(prefix.applied).toBe(false);
  });

  test("builds prompt prefix for enabled presets", async () => {
    const repository = new OutputStyleRepositoryStub();
    const service = new OutputStyleService(repository);
    await service.updateSettings("user-1", {
      enabled: true,
      activePresetId: "concise",
    });

    const prefix = await service.resolvePromptPrefix("user-1");

    expect(prefix.applied).toBe(true);
    expect(prefix.text).toContain("Response style: Concise");
  });
});

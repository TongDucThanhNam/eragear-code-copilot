import { describe, expect, test } from "bun:test";
import type {
  PromptEnhancementSettings,
  UpdatePromptEnhancementSettingsInput,
} from "./contracts/prompt-enhancement.contract";
import type { PromptEnhancementRepositoryPort } from "./ports/prompt-enhancement-repository.port";
import {
  DEFAULT_PROMPT_ENHANCEMENT_SETTINGS,
  PromptEnhancementService,
} from "./prompt-enhancement.service";

class PromptEnhancementRepositoryStub
  implements PromptEnhancementRepositoryPort
{
  settings: PromptEnhancementSettings = {
    ...DEFAULT_PROMPT_ENHANCEMENT_SETTINGS,
  };
  lastUpdate: UpdatePromptEnhancementSettingsInput | null = null;

  getSettings(_userId: string): Promise<PromptEnhancementSettings> {
    return Promise.resolve(this.settings);
  }

  updateSettings(
    _userId: string,
    input: UpdatePromptEnhancementSettingsInput
  ): Promise<PromptEnhancementSettings> {
    this.lastUpdate = input;
    this.settings = { ...this.settings, ...input };
    return Promise.resolve(this.settings);
  }
}

describe("PromptEnhancementService", () => {
  test("does not alter prompts when disabled", async () => {
    const repository = new PromptEnhancementRepositoryStub();
    const service = new PromptEnhancementService(repository);

    const result = await service.enhance({
      userId: "user-1",
      chatId: "chat-1",
      text: "Implement queue triggers",
      projectRoot: "/repo",
    });

    expect(result.applied).toBe(false);
    expect(result.text).toBe("Implement queue triggers");
  });

  test("injects project context, date, preset instructions, and custom instruction", async () => {
    const repository = new PromptEnhancementRepositoryStub();
    repository.settings = {
      enabled: true,
      includeProjectContext: true,
      includeDate: true,
      instructionMode: "execution",
      customInstruction: "Track quota refresh as a queue trigger.",
    };
    const service = new PromptEnhancementService(repository, {
      nowMs: () => Date.UTC(2026, 5, 12),
    });

    const result = await service.enhance({
      userId: "user-1",
      chatId: "chat-1",
      text: "Build prompt enhancement",
      projectRoot: "/repo",
      projectId: "project-1",
    });

    expect(result.applied).toBe(true);
    expect(result.text).toContain("[Eragear Prompt Enhancement]");
    expect(result.text).toContain("- Date: 2026-06-12");
    expect(result.text).toContain("- Project root: /repo");
    expect(result.text).toContain("Preserve the user's intent");
    expect(result.text).toContain("Track quota refresh as a queue trigger.");
    expect(result.text).toContain(
      "Original user request:\nBuild prompt enhancement"
    );
  });

  test("trims custom instruction on settings update", async () => {
    const repository = new PromptEnhancementRepositoryStub();
    const service = new PromptEnhancementService(repository);

    await service.updateSettings("user-1", {
      enabled: true,
      customInstruction: "  Keep changes focused.  ",
    });

    expect(repository.lastUpdate).toEqual({
      enabled: true,
      customInstruction: "Keep changes focused.",
    });
  });
});

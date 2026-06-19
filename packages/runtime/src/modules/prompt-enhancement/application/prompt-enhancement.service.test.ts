import { describe, expect, test } from "bun:test";
import type { PromptEnhancementSettings } from "./contracts/prompt-enhancement.contract";
import type {
  MutablePromptEnhancementStoreSnapshot,
  PromptEnhancementRepositoryPort,
  PromptEnhancementStoreSnapshot,
} from "./ports/prompt-enhancement-repository.port";
import {
  DEFAULT_PROMPT_ENHANCEMENT_SETTINGS,
  PromptEnhancementService,
} from "./prompt-enhancement.service";

class PromptEnhancementRepositoryStub
  implements PromptEnhancementRepositoryPort
{
  snapshot: MutablePromptEnhancementStoreSnapshot = {
    settingsByUserId: {},
  };

  read<T>(
    reader: (snapshot: PromptEnhancementStoreSnapshot) => T | Promise<T>
  ): Promise<T> {
    return Promise.resolve(reader(cloneSnapshot(this.snapshot)));
  }

  mutate<T>(
    mutator: (snapshot: MutablePromptEnhancementStoreSnapshot) => T | Promise<T>
  ): Promise<T> {
    return Promise.resolve(mutator(this.snapshot));
  }
}

describe("PromptEnhancementService", () => {
  test("returns default settings through the service interface", async () => {
    const service = new PromptEnhancementService(
      new PromptEnhancementRepositoryStub()
    );

    const result = await service.getSettings("user-1");

    expect(result.settings).toEqual(DEFAULT_PROMPT_ENHANCEMENT_SETTINGS);
  });

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
    repository.snapshot.settingsByUserId["user-1"] = {
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

  test("normalizes and persists settings updates through the service", async () => {
    const repository = new PromptEnhancementRepositoryStub();
    const service = new PromptEnhancementService(repository);

    const result = await service.updateSettings("user-1", {
      enabled: true,
      includeDate: false,
      instructionMode: "concise",
      customInstruction: "  Keep changes focused.  ",
    });

    expect(result.settings).toEqual({
      ...DEFAULT_PROMPT_ENHANCEMENT_SETTINGS,
      enabled: true,
      includeDate: false,
      instructionMode: "concise",
      customInstruction: "Keep changes focused.",
    });
    expect(repository.snapshot.settingsByUserId["user-1"]).toEqual(
      result.settings
    );
  });
});

function cloneSnapshot(
  snapshot: MutablePromptEnhancementStoreSnapshot
): PromptEnhancementStoreSnapshot {
  return {
    settingsByUserId: Object.fromEntries(
      Object.entries(snapshot.settingsByUserId).map(([userId, settings]) => [
        userId,
        cloneSettings(settings),
      ])
    ),
  };
}

function cloneSettings(
  settings: PromptEnhancementSettings
): PromptEnhancementSettings {
  return { ...settings };
}

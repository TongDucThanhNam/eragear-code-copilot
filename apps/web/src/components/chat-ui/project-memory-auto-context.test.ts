import { describe, expect, test } from "bun:test";
import {
  composeProjectContextPrompt,
  shouldAutoAttachProjectMemoryContext,
  shouldUseProjectMemoryContextResult,
} from "./project-memory-auto-context";

describe("shouldAutoAttachProjectMemoryContext", () => {
  test("enables automatic memory context for normal prompts with enabled sources", () => {
    expect(
      shouldAutoAttachProjectMemoryContext({
        text: "Refactor checkpoint restore flow",
        hasFiles: false,
        mentionCount: 0,
        enabledMemorySources: 2,
        commandResolved: false,
      })
    ).toBe(true);
  });

  test("does not interfere with explicit slash or skill commands", () => {
    expect(
      shouldAutoAttachProjectMemoryContext({
        text: "/agent-code-reviewer inspect this",
        hasFiles: false,
        mentionCount: 0,
        enabledMemorySources: 2,
        commandResolved: false,
      })
    ).toBe(false);
    expect(
      shouldAutoAttachProjectMemoryContext({
        text: "@desktop-smoke inspect this",
        hasFiles: false,
        mentionCount: 0,
        enabledMemorySources: 2,
        commandResolved: false,
      })
    ).toBe(false);
  });

  test("does not attach when context is explicit or unavailable", () => {
    expect(
      shouldAutoAttachProjectMemoryContext({
        text: "Explain this referenced file",
        hasFiles: true,
        mentionCount: 0,
        enabledMemorySources: 2,
        commandResolved: false,
      })
    ).toBe(false);
    expect(
      shouldAutoAttachProjectMemoryContext({
        text: "Explain this referenced file",
        hasFiles: false,
        mentionCount: 1,
        enabledMemorySources: 2,
        commandResolved: false,
      })
    ).toBe(false);
    expect(
      shouldAutoAttachProjectMemoryContext({
        text: "Explain current ADE state",
        hasFiles: false,
        mentionCount: 0,
        enabledMemorySources: 0,
        commandResolved: false,
      })
    ).toBe(false);
  });
});

describe("project memory context composition", () => {
  test("uses only ready memory context results", () => {
    expect(
      shouldUseProjectMemoryContextResult({
        status: "ready",
        sourceCount: 1,
      })
    ).toBe(true);
    expect(
      shouldUseProjectMemoryContextResult({
        status: "ready",
        sourceCount: 0,
      })
    ).toBe(false);
    expect(
      shouldUseProjectMemoryContextResult({
        status: "no-enabled-sources",
        sourceCount: 0,
      })
    ).toBe(false);
  });

  test("combines memory and index context for a normal prompt", () => {
    const prompt = composeProjectContextPrompt({
      userRequest: "Improve Local ADE UX",
      memoryPrompt: "Memory: use checkpoints",
      indexPrompt: "Index: LocalAdeControlCenter",
    });

    expect(prompt).toContain("Project Memory Context:");
    expect(prompt).toContain("Memory: use checkpoints");
    expect(prompt).toContain("Project Index Context:");
    expect(prompt).toContain("Index: LocalAdeControlCenter");
    expect(prompt).toContain("Final user request:\nImprove Local ADE UX");
  });
});


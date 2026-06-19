import { describe, expect, test } from "bun:test";
import {
  shouldAutoAttachProjectIndexContext,
  shouldUseAutoProjectIndexSearchResult,
} from "./project-index-auto-context";

describe("shouldAutoAttachProjectIndexContext", () => {
  test("enables automatic index context for normal indexed prompts", () => {
    expect(
      shouldAutoAttachProjectIndexContext({
        text: "Refactor the provider readiness table",
        hasFiles: false,
        mentionCount: 0,
        projectIndexReady: true,
        commandResolved: false,
      })
    ).toBe(true);
  });

  test("does not interfere with explicit slash or skill commands", () => {
    expect(
      shouldAutoAttachProjectIndexContext({
        text: "/agent-code-reviewer inspect this",
        hasFiles: false,
        mentionCount: 0,
        projectIndexReady: true,
        commandResolved: false,
      })
    ).toBe(false);
    expect(
      shouldAutoAttachProjectIndexContext({
        text: "@desktop-smoke inspect this",
        hasFiles: false,
        mentionCount: 0,
        projectIndexReady: true,
        commandResolved: false,
      })
    ).toBe(false);
  });

  test("does not attach when user already provided explicit context", () => {
    expect(
      shouldAutoAttachProjectIndexContext({
        text: "Explain this referenced file",
        hasFiles: true,
        mentionCount: 0,
        projectIndexReady: true,
        commandResolved: false,
      })
    ).toBe(false);
    expect(
      shouldAutoAttachProjectIndexContext({
        text: "Explain this referenced file",
        hasFiles: false,
        mentionCount: 1,
        projectIndexReady: true,
        commandResolved: false,
      })
    ).toBe(false);
  });

  test("requires a ready project index and no resolved command path", () => {
    expect(
      shouldAutoAttachProjectIndexContext({
        text: "Update checkpoint restore UX",
        hasFiles: false,
        mentionCount: 0,
        projectIndexReady: false,
        commandResolved: false,
      })
    ).toBe(false);
    expect(
      shouldAutoAttachProjectIndexContext({
        text: "Update checkpoint restore UX",
        hasFiles: false,
        mentionCount: 0,
        projectIndexReady: true,
        commandResolved: true,
      })
    ).toBe(false);
  });
});

describe("shouldUseAutoProjectIndexSearchResult", () => {
  test("uses only ready search results with matches", () => {
    expect(
      shouldUseAutoProjectIndexSearchResult({
        status: "ready",
        resultCount: 3,
      })
    ).toBe(true);
    expect(
      shouldUseAutoProjectIndexSearchResult({
        status: "ready",
        resultCount: 0,
      })
    ).toBe(false);
    expect(
      shouldUseAutoProjectIndexSearchResult({
        status: "no-results",
        resultCount: 0,
      })
    ).toBe(false);
  });
});

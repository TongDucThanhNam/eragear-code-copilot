import { describe, expect, test } from "bun:test";
import {
  AGENT_SESSION_ID_PLACEHOLDER,
  getDefaultAgentResumeCommandTemplate,
  normalizeAgentResumeCommandTemplate,
} from "./agent-resume-command.util";

describe("agent resume command template helpers", () => {
  test("returns defaults for known agent types", () => {
    expect(getDefaultAgentResumeCommandTemplate("codex")).toBe(
      `codex resume ${AGENT_SESSION_ID_PLACEHOLDER}`
    );
    expect(getDefaultAgentResumeCommandTemplate("claude")).toBe(
      `claude -r ${AGENT_SESSION_ID_PLACEHOLDER}`
    );
    expect(getDefaultAgentResumeCommandTemplate("opencode")).toBe(
      `opencode -s ${AGENT_SESSION_ID_PLACEHOLDER}`
    );
    expect(getDefaultAgentResumeCommandTemplate("gemini")).toBe(
      `gemini --resume ${AGENT_SESSION_ID_PLACEHOLDER}`
    );
    expect(getDefaultAgentResumeCommandTemplate("other")).toBeUndefined();
  });

  test("auto-appends placeholder when template omits it", () => {
    expect(
      normalizeAgentResumeCommandTemplate({
        type: "codex",
        resumeCommandTemplate: "codex resume",
      })
    ).toBe(`codex resume ${AGENT_SESSION_ID_PLACEHOLDER}`);
  });

  test("uses default mapping when input is empty and fallback is enabled", () => {
    expect(
      normalizeAgentResumeCommandTemplate({
        type: "gemini",
        resumeCommandTemplate: "   ",
      })
    ).toBe(`gemini --resume ${AGENT_SESSION_ID_PLACEHOLDER}`);
  });

  test("returns undefined when input is empty and fallback is disabled", () => {
    expect(
      normalizeAgentResumeCommandTemplate({
        type: "gemini",
        resumeCommandTemplate: "",
        fallbackToDefault: false,
      })
    ).toBeUndefined();
  });
});

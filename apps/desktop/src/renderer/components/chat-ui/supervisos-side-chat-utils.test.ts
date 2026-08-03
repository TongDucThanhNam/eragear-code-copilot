import { describe, expect, test } from "bun:test";
import {
  buildQueuedSupervisosMainPrompt,
  formatSupervisosHandoffStatus,
  isPromptBusyError,
  parseLegacyDelegatedHandoff,
} from "./supervisos-side-chat-utils";

describe("parseLegacyDelegatedHandoff", () => {
  test("detects and extracts the old raw delegated prompt response", () => {
    const parsed =
      parseLegacyDelegatedHandoff(`Enhanced prompt sent to the main coding agent.

- Turn: turn-aca7d830-20b7-4905-b882-5b1135d1827f
- Status: submitted
- Supervisor mode: off

The task was submitted to the main coding agent. Auto-continue is currently off for this session, so Supervisos will not continue additional turns until Autopilot is enabled.

Prompt sent:
\`\`\`text
Supervisos delegated enhanced task.
Original user request:
Tạo cho tôi một trang web AWWWARDS cho cửa hàng bán Hamburger.
Project context:
- Project root: C:\\Users\\terasumi\\Documents\\source_code\\htmls
\`\`\``);

    expect(parsed).toEqual({
      status: "submitted",
      turnId: "turn-aca7d830-20b7-4905-b882-5b1135d1827f",
    });
  });

  test("does not treat normal side-chat answers as handoffs", () => {
    expect(parseLegacyDelegatedHandoff("Autopilot is enabled.")).toBeNull();
  });
});

describe("formatSupervisosHandoffStatus", () => {
  test("hides raw prompt/debug content and reports active supervision", () => {
    const content = formatSupervisosHandoffStatus({
      activation: "enabled",
      status: "submitted",
      turnId: "turn-1",
    });

    expect(content).toContain("Task handed to the main coding agent.");
    expect(content).toContain("- Supervisos: active");
    expect(content).toContain("- Autopilot: enabled for this session");
    expect(content).not.toContain("Prompt sent:");
    expect(content).not.toContain("Original user request:");
    expect(content).not.toContain("Supervisor mode: off");
  });
});

describe("isPromptBusyError", () => {
  test("detects runtime prompt busy failures", () => {
    expect(
      isPromptBusyError(
        new Error("A prompt is already in progress for this session")
      )
    ).toBe(true);
    expect(isPromptBusyError({ code: "PROMPT_BUSY" })).toBe(true);
  });

  test("does not treat unrelated failures as busy", () => {
    expect(isPromptBusyError(new Error("Supervisor is disabled"))).toBe(false);
  });
});

describe("buildQueuedSupervisosMainPrompt", () => {
  test("wraps a busy fallback task as an enhanced main-agent prompt", () => {
    const prompt = buildQueuedSupervisosMainPrompt(
      "Tạo cho tôi một trang web AWWWARDS cho cửa hàng bán Hamburger."
    );

    expect(prompt).toContain("Supervisos queued delegated task.");
    expect(prompt).toContain("Original user request:");
    expect(prompt).toContain(
      "Tạo cho tôi một trang web AWWWARDS cho cửa hàng bán Hamburger."
    );
    expect(prompt).toContain("Implementation instructions:");
    expect(prompt).toContain("Completion response expected:");
    expect(prompt).not.toContain("Prompt sent:");
  });
});

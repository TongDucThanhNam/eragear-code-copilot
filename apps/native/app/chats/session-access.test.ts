import { describe, expect, test } from "bun:test";
import {
  buildChatRoute,
  canResumeInactiveSession,
  resolveChatReadOnly,
} from "./session-access";

describe("session-access", () => {
  test("builds live route for active sessions", () => {
    expect(buildChatRoute("chat-active", true)).toBe("/chats/chat-active");
  });

  test("builds readonly route for inactive or unknown sessions", () => {
    expect(buildChatRoute("chat-inactive", false)).toBe(
      "/chats/chat-inactive?readonly=true"
    );
    expect(buildChatRoute("chat-unknown")).toBe(
      "/chats/chat-unknown?readonly=true"
    );
  });

  test("prefers live session metadata over readonly param", () => {
    expect(
      resolveChatReadOnly({
        forceActive: false,
        isReadOnlyParam: true,
        sessionIsActive: true,
      })
    ).toBe(false);
  });

  test("keeps inactive session readonly unless forceActive is set", () => {
    expect(
      resolveChatReadOnly({
        forceActive: false,
        isReadOnlyParam: false,
        sessionIsActive: false,
      })
    ).toBe(true);
    expect(
      resolveChatReadOnly({
        forceActive: true,
        isReadOnlyParam: true,
        sessionIsActive: false,
      })
    ).toBe(false);
  });

  test("only offers resume for inactive sessions that support it", () => {
    expect(
      canResumeInactiveSession({
        sessionIsActive: false,
        loadSessionSupported: true,
      })
    ).toBe(true);
    expect(
      canResumeInactiveSession({
        sessionIsActive: true,
        loadSessionSupported: true,
      })
    ).toBe(false);
    expect(
      canResumeInactiveSession({
        sessionIsActive: false,
        loadSessionSupported: false,
      })
    ).toBe(false);
  });
});

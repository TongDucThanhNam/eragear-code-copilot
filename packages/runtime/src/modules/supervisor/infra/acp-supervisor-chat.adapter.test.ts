import { describe, expect, test } from "bun:test";
import type { SupervisorChatSnapshot } from "../application/ports/supervisor-chat.port";
import { AcpSupervisorChatAdapter } from "./acp-supervisor-chat.adapter";

describe("AcpSupervisorChatAdapter", () => {
  test("uses a bounded ACP advisory session and always stops it", async () => {
    const sent: unknown[] = [];
    const stopped: string[] = [];
    const adapter = new AcpSupervisorChatAdapter({
      agents: {
        list: async () => [{ agentId: "codex", displayName: "Codex" }],
      },
      createSession: {
        execute: async (input) => ({
          id: input.chatId ?? "missing",
          sessionId: "acp-session-1",
        }),
      },
      sendMessage: {
        execute: (input) => {
          sent.push(input);
          return Promise.resolve({ turnId: "turn-1" });
        },
      },
      results: {
        latestAssistantText: async () => "Bounded ACP answer",
      },
      stopSession: {
        execute: (_userId, chatId) => {
          stopped.push(chatId);
          return Promise.resolve();
        },
      },
      createId: () => "supervisor-advisory-1",
    });

    const result = await adapter.respond(snapshot());

    expect(result).toEqual({
      content: "Bounded ACP answer",
      model: "ACP · Codex",
      provider: "acp",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      userId: "user-1",
      chatId: "supervisor-advisory-1",
      source: "orchestrator",
    });
    expect(JSON.stringify(sent[0])).not.toContain("raw transcript");
    expect(stopped).toEqual(["supervisor-advisory-1"]);
  });
});

function snapshot(): SupervisorChatSnapshot {
  return {
    userId: "user-1",
    chatId: "chat-1",
    projectId: "project-1",
    projectRoot: "/repo",
    userMessage: "Why is this run waiting?",
    sideChatHistory: [],
    goalModeAudit: [],
    projectContext: {
      topLevelEntries: ["src"],
      files: [],
      diagnostics: [],
    },
    projectIntelligence: {
      status: "ready",
      symbolExtractionMode: "ast",
      graphNodes: [],
      symbolMatches: [],
      routeMap: [],
      diagnostics: [],
    },
    supervisor: {
      mode: "off",
      status: "idle",
    },
  };
}

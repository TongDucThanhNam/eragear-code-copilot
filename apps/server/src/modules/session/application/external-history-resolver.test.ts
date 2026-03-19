import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isExternalHistoryImportSupportedAgentCommand,
  mergeCodexEntries,
  resolveExternalHistoryImportMessages,
} from "./external-history-resolver";

describe("external-history-resolver", () => {
  test("merges user history and assistant transcript entries in timestamp order", () => {
    const sessionId = "019ca302-4b2b-7521-858a-930c225564b4";
    const historyText = [
      JSON.stringify({
        session_id: sessionId,
        ts: 1_772_286_691,
        text: "first user",
      }),
      JSON.stringify({
        session_id: "other",
        ts: 1_772_286_692,
        text: "ignored user",
      }),
      JSON.stringify({
        session_id: sessionId,
        ts: 1_772_286_693,
        text: "second user",
      }),
    ].join("\n");
    const transcriptText = [
      JSON.stringify({
        timestamp: "2026-02-28T13:51:32.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "assistant one" }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-02-28T13:51:35.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "assistant two" }],
        },
      }),
    ].join("\n");

    const merged = mergeCodexEntries({
      historyText,
      transcriptText,
      sessionId,
    });

    expect(merged.map((entry) => `${entry.role}:${entry.text}`)).toEqual([
      "user:first user",
      "assistant:assistant one",
      "user:second user",
      "assistant:assistant two",
    ]);
  });

  test("resolves codex transcript from local ~/.codex fallback", async () => {
    const sessionId = "019ca302-4b2b-7521-858a-930c225564b4";
    const homeDir = await mkdtemp(path.join(tmpdir(), "codex-import-test-"));
    const codexRoot = path.join(homeDir, ".codex");
    const sessionsDir = path.join(codexRoot, "sessions", "2026", "02", "28");
    await mkdir(sessionsDir, { recursive: true });

    await writeFile(
      path.join(codexRoot, "history.jsonl"),
      [
        JSON.stringify({
          session_id: sessionId,
          ts: 1_772_286_691,
          text: "user from history",
        }),
      ].join("\n"),
      "utf8"
    );

    const transcriptPath = path.join(
      sessionsDir,
      `rollout-2026-02-28T13-49-22-${sessionId}.jsonl`
    );
    await writeFile(
      transcriptPath,
      [
        JSON.stringify({
          timestamp: "2026-02-28T13:51:32.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [
              { type: "output_text", text: "assistant from transcript" },
            ],
          },
        }),
      ].join("\n"),
      "utf8"
    );

    const messages = await resolveExternalHistoryImportMessages({
      sessionIdToLoad: sessionId,
      agentCommand: "codex",
      agentEnv: { HOME: homeDir },
    });

    expect(Array.isArray(messages)).toBe(true);
    expect(messages?.length).toBe(2);
    expect(messages?.[0]?.role).toBe("user");
    expect(messages?.[1]?.role).toBe("assistant");
    expect(messages?.[1]?.parts[0]).toMatchObject({
      type: "text",
      text: "assistant from transcript",
    });
  });

  test("treats codex as the only external import fallback family", () => {
    expect(isExternalHistoryImportSupportedAgentCommand("codex")).toBe(true);
    expect(
      isExternalHistoryImportSupportedAgentCommand("/home/user/bin/codex-acp")
    ).toBe(true);
    expect(isExternalHistoryImportSupportedAgentCommand("opencode")).toBe(
      false
    );
    expect(
      isExternalHistoryImportSupportedAgentCommand("claude-agent-acp")
    ).toBe(false);
  });

  test("returns null for non-codex commands", async () => {
    const messages = await resolveExternalHistoryImportMessages({
      sessionIdToLoad: "session-any",
      agentCommand: "opencode",
      agentEnv: { HOME: "/tmp/does-not-matter" },
    });

    expect(messages).toBeNull();
  });
});

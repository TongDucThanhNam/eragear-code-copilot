import { describe, expect, test } from "bun:test";
import { isAcpLogMessage } from "./acp-log.util";

describe("isAcpLogMessage", () => {
  test("matches explicit ACP keyword logs", () => {
    expect(isAcpLogMessage("ACP process stderr summary")).toBe(true);
  });

  test("matches ACP JSON-RPC error handling logs without ACP keyword", () => {
    const message =
      "Error handling request { jsonrpc: '2.0', method: 'fs/read_text_file', params: { sessionId: 'chat-1' } } { code: -32602 }";
    expect(isAcpLogMessage(message)).toBe(true);
  });

  test("matches JSON-formatted ACP payloads", () => {
    const message =
      '{"jsonrpc":"2.0","method":"fs/read_text_file","params":{"sessionId":"chat-1"}}';
    expect(isAcpLogMessage(message)).toBe(true);
  });

  test("does not match unrelated logs", () => {
    expect(isAcpLogMessage("Database queue saturated")).toBe(false);
  });
});

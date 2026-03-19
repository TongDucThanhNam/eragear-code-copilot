import { describe, expect, test } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk";
import { buildToolApprovalResponsePart, buildToolPartForUpdate } from "./tool";

describe("tool ui message sanitization", () => {
  test("escapes HTML in tool error output text", () => {
    const part = buildToolPartForUpdate({
      toolCallId: "tool-1",
      toolName: "bash",
      status: "failed",
      rawOutput: "<script>alert(1)</script>",
    });

    expect(part.state).toBe("output-error");
    expect(part.errorText).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  test("escapes HTML in tool content output text", () => {
    const part = buildToolPartForUpdate({
      toolCallId: "tool-2",
      toolName: "bash",
      status: "completed",
      content: [
        {
          type: "content",
          content: {
            type: "text",
            text: "<img src=x onerror=alert(1)>",
          },
        } as acp.ToolCallContent,
      ],
    });

    expect(part.state).toBe("output-available");
    const output = Array.isArray(part.output) ? part.output : [];
    const first = output[0] as {
      type?: string;
      content?: { type?: string; text?: string };
    };
    expect(first.type).toBe("content");
    expect(first.content?.text).toBe("&lt;img src=x onerror=alert(1)&gt;");
  });

  test("formats JSON-RPC error objects for failed tools", () => {
    const part = buildToolPartForUpdate({
      toolCallId: "tool-3",
      toolName: "fs/read_text_file",
      status: "failed",
      rawOutput: {
        code: -32_602,
        message: "Invalid params: File not found",
        data: {
          path: "/home/terasumi/Documents/source_code/Web/htmls/art-gallery-awwwards.html",
        },
      },
    });

    expect(part.state).toBe("output-error");
    expect(part.errorText).toContain(
      '"message": "Invalid params: File not found"'
    );
    expect(part.errorText).toContain('"code": -32602');
    expect(part.errorText).toContain(
      '"path": "/home/terasumi/Documents/source_code/Web/htmls/art-gallery-awwwards.html"'
    );
  });

  test("formats nested ACP error envelope with request context", () => {
    const part = buildToolPartForUpdate({
      toolCallId: "tool-4",
      toolName: "other",
      status: "failed",
      rawOutput: {
        method: "fs/read_text_file",
        params: {
          path: "/tmp/missing.html",
        },
        error: {
          code: -32_602,
          message: "Invalid params: File not found",
        },
      },
    });

    expect(part.state).toBe("output-error");
    expect(part.errorText).toContain("Error handling request {");
    expect(part.errorText).toContain('"method": "fs/read_text_file"');
    expect(part.errorText).toContain('"path": "/tmp/missing.html"');
    expect(part.errorText).toContain(
      '"message": "Invalid params: File not found"'
    );
    expect(part.errorText).toContain('"code": -32602');
  });

  test("builds output-cancelled tool part for cancelled permission requests", () => {
    const part = buildToolApprovalResponsePart({
      toolCallId: "tool-5",
      toolName: "bash",
      approvalId: "req-5",
      approved: false,
      cancelled: true,
      reason: "cancelled",
      input: { cmd: "sleep 10" },
    });

    expect(part).toEqual({
      type: "tool-bash",
      toolCallId: "tool-5",
      title: "bash",
      state: "output-cancelled",
      input: { cmd: "sleep 10" },
      approval: {
        id: "req-5",
        approved: false,
        reason: "cancelled",
      },
    });
  });
});

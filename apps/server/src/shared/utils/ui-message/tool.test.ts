import { describe, expect, test } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk";
import { buildToolPartForUpdate } from "./tool";

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
});

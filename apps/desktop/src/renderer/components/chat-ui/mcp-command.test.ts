// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
import { expect, test } from "bun:test";
import {
  buildMcpToolResultPrompt,
  parseMcpCommand,
  resolveMcpCommandServer,
} from "./mcp-command";

const trustedServer = {
  id: "desktop-smoke-mcp",
  name: "Desktop Smoke MCP",
  enabled: true,
  trustStatus: "trusted" as const,
  protocol: { status: "initialized" as const },
  tools: [{ name: "desktop_smoke_tool", description: "Smoke test tool" }],
};

test("parses a simple /mcp tool command with JSON arguments", () => {
  expect(
    parseMcpCommand('/mcp desktop_smoke_tool {"path":"README.md"}')
  ).toEqual({
    command: "mcp",
    toolName: "desktop_smoke_tool",
    arguments: { path: "README.md" },
    request: "",
  });
});

test("parses server-qualified MCP tool commands and request text", () => {
  expect(
    parseMcpCommand(
      '/mcp desktop-smoke-mcp/desktop_smoke_tool {"path":"README.md"} -- summarize the file'
    )
  ).toEqual({
    command: "mcp",
    serverRef: "desktop-smoke-mcp",
    toolName: "desktop_smoke_tool",
    arguments: { path: "README.md" },
    request: "summarize the file",
  });

  expect(
    parseMcpCommand(
      '/mcp --server "Desktop Smoke MCP" desktop_smoke_tool {"path":"README.md"}'
    )?.serverRef
  ).toBe("Desktop Smoke MCP");
});

test("rejects non-object or invalid MCP JSON arguments", () => {
  expect(() => parseMcpCommand('/mcp desktop_smoke_tool {"path"')).toThrow(
    "MCP command arguments must be a valid JSON object."
  );
  expect(() => parseMcpCommand("/mcp desktop_smoke_tool []")).toThrow(
    'MCP command arguments must be a JSON object. Put follow-up text after " -- ".'
  );
  expect(parseMcpCommand("/index desktop_smoke_tool")).toBeNull();
});

test("resolves only trusted initialized servers with discovered tools", () => {
  const resolved = resolveMcpCommandServer({
    command: parseMcpCommand("/mcp desktop_smoke_tool")!,
    servers: [trustedServer],
  });

  expect(resolved.status).toBe("ready");
  if (resolved.status === "ready") {
    expect(resolved.server.id).toBe("desktop-smoke-mcp");
    expect(resolved.toolName).toBe("desktop_smoke_tool");
  }

  expect(
    resolveMcpCommandServer({
      command: parseMcpCommand("/mcp desktop_smoke_tool")!,
      servers: [{ ...trustedServer, trustStatus: "untrusted" as const }],
    }).status
  ).toBe("untrusted");

  expect(
    resolveMcpCommandServer({
      command: parseMcpCommand("/mcp desktop_smoke_tool")!,
      servers: [
        trustedServer,
        { ...trustedServer, id: "second", name: "Second MCP" },
      ],
    }).status
  ).toBe("ambiguous");
});

test("builds a real agent prompt from an MCP invocation result", () => {
  const prompt = buildMcpToolResultPrompt({
    command: parseMcpCommand(
      '/mcp desktop-smoke-mcp/desktop_smoke_tool {"path":"README.md"} -- explain it'
    )!,
    result: {
      serverId: "desktop-smoke-mcp",
      serverName: "Desktop Smoke MCP",
      method: "tools/call",
      target: "desktop_smoke_tool",
      status: "success",
      durationMs: 42,
      isError: false,
      resultText: "README contents",
      resultJson: "",
      truncated: false,
      diagnostics: ["redacted output"],
    },
  });

  expect(prompt).toContain(
    'A trusted MCP tool was invoked from the "/mcp" chat command.'
  );
  expect(prompt).toContain("Tool arguments:");
  expect(prompt).toContain('"path": "README.md"');
  expect(prompt).toContain("README contents");
  expect(prompt).toContain("explain it");
});

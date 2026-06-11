const { writeFileSync } = require("node:fs");

const capturePath = process.argv[2];
let buffer = "";

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function capture(payload) {
  if (!capturePath) {
    return;
  }
  writeFileSync(capturePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    const message = JSON.parse(line);
    if (message.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: false,
            mcpCapabilities: { http: true, sse: true },
            promptCapabilities: {},
            sessionCapabilities: {},
          },
          agentInfo: {
            name: "Desktop MCP Capture Agent",
            version: "1.0.0",
          },
        },
      });
      continue;
    }
    if (message.method === "session/new") {
      capture({
        method: "session/new",
        cwd: message.params?.cwd,
        mcpServers: message.params?.mcpServers ?? [],
      });
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          sessionId: "desktop-mcp-capture-session",
          configOptions: [],
        },
      });
      continue;
    }
    if (message.method === "session/prompt") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          stopReason: "end_turn",
        },
      });
    }
  }
});

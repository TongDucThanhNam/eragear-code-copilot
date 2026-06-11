process.stdin.setEncoding("utf8");

let buffer = "";

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

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
          protocolVersion: "2024-11-05",
          serverInfo: { name: "eragear-desktop-smoke", version: "1.0.0" },
          capabilities: { tools: {}, resources: {} },
        },
      });
      continue;
    }
    if (message.method === "tools/list") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          tools: [
            {
              name: "desktop_smoke_tool",
              description: "Tool discovered by desktop smoke MCP fixture.",
            },
          ],
        },
      });
      continue;
    }
    if (message.method === "resources/list") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          resources: [
            {
              uri: "file:///desktop-smoke",
              name: "desktop-smoke-resource",
            },
          ],
        },
      });
    }
  }
});

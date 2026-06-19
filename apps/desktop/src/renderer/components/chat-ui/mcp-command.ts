// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
export const MCP_COMMAND_NAME = "mcp";

export interface McpCommandToolDescriptor {
  name: string;
  description?: string;
}

export interface McpCommandServerDescriptor {
  id: string;
  name: string;
  enabled: boolean;
  trustStatus: "trusted" | "untrusted" | "changed";
  protocol: {
    status: "not-run" | "initialized" | "failed" | "unsupported";
    error?: string;
  };
  tools: McpCommandToolDescriptor[];
}

export interface ParsedMcpCommand {
  command: typeof MCP_COMMAND_NAME;
  serverRef?: string;
  toolName: string;
  arguments: Record<string, unknown>;
  request: string;
}

export interface McpCommandInvocationResult {
  serverId: string;
  serverName: string;
  method: "tools/call" | "resources/read";
  target: string;
  status: "success" | "failed";
  durationMs: number;
  isError: boolean;
  resultText: string;
  resultJson: string;
  truncated: boolean;
  diagnostics: string[];
}

export type McpCommandServerResolution =
  | {
      status: "ready";
      server: McpCommandServerDescriptor;
      toolName: string;
    }
  | {
      status:
        | "ambiguous"
        | "disabled"
        | "missing-target"
        | "missing-tool"
        | "not-configured"
        | "not-initialized"
        | "untrusted";
      message: string;
    };

function tokenizeCommandPrefix(value: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return tokens;
}

function splitRequest(value: string): { invocation: string; request: string } {
  const delimiter = value.match(/\s--\s+([\s\S]*)$/);
  if (!delimiter || delimiter.index === undefined) {
    return { invocation: value.trim(), request: "" };
  }
  return {
    invocation: value.slice(0, delimiter.index).trim(),
    request: delimiter[1].trim(),
  };
}

function splitJsonArguments(value: string): {
  prefix: string;
  argumentsText: string;
} {
  const jsonStart = value.indexOf("{");
  if (jsonStart < 0) {
    return { prefix: value.trim(), argumentsText: "" };
  }
  return {
    prefix: value.slice(0, jsonStart).trim(),
    argumentsText: value.slice(jsonStart).trim(),
  };
}

function parseJsonArguments(value: string): Record<string, unknown> {
  if (!value) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("MCP command arguments must be a valid JSON object.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("MCP command arguments must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

export function parseMcpCommand(text: string): ParsedMcpCommand | null {
  const match = text.match(/^\/mcp(?:\s+([\s\S]*))?$/i);
  if (!match) {
    return null;
  }

  const { invocation, request } = splitRequest(match[1] ?? "");
  const { prefix, argumentsText } = splitJsonArguments(invocation);
  const tokens = tokenizeCommandPrefix(prefix);
  let serverRef: string | undefined;
  let target = "";
  let consumedPrefixTokens = 0;

  if (tokens[0] === "--server" || tokens[0] === "-s") {
    serverRef = tokens[1]?.trim() || undefined;
    target = tokens[2]?.trim() ?? "";
    consumedPrefixTokens = 3;
  } else if (tokens[0]?.startsWith("--server=")) {
    serverRef = tokens[0].slice("--server=".length).trim() || undefined;
    target = tokens[1]?.trim() ?? "";
    consumedPrefixTokens = 2;
  } else {
    target = tokens[0]?.trim() ?? "";
    consumedPrefixTokens = target ? 1 : 0;
  }

  if (tokens.slice(consumedPrefixTokens).length > 0) {
    throw new Error(
      'MCP command arguments must be a JSON object. Put follow-up text after " -- ".'
    );
  }

  let toolName = target;
  if (!serverRef && target.includes("/")) {
    const separator = target.lastIndexOf("/");
    serverRef = target.slice(0, separator).trim() || undefined;
    toolName = target.slice(separator + 1).trim();
  }

  return {
    command: MCP_COMMAND_NAME,
    ...(serverRef ? { serverRef } : {}),
    toolName,
    arguments: parseJsonArguments(argumentsText),
    request,
  };
}

function normalizeMatch(value: string): string {
  return value.trim().toLowerCase();
}

function findTool(
  server: McpCommandServerDescriptor,
  toolName: string
): McpCommandToolDescriptor | undefined {
  return (
    server.tools.find((tool) => tool.name === toolName) ??
    server.tools.find(
      (tool) => normalizeMatch(tool.name) === normalizeMatch(toolName)
    )
  );
}

export function resolveMcpCommandServer(params: {
  command: ParsedMcpCommand;
  servers: McpCommandServerDescriptor[];
}): McpCommandServerResolution {
  const toolName = params.command.toolName.trim();
  if (!toolName) {
    return {
      status: "missing-target",
      message: "Add an MCP tool name after /mcp.",
    };
  }
  if (params.servers.length === 0) {
    return {
      status: "not-configured",
      message: "No MCP servers are configured in Local ADE.",
    };
  }

  const serverRef = params.command.serverRef?.trim();
  const candidates = serverRef
    ? params.servers.filter((server) => {
        const normalized = normalizeMatch(serverRef);
        return (
          normalizeMatch(server.id) === normalized ||
          normalizeMatch(server.name) === normalized
        );
      })
    : params.servers.filter((server) => findTool(server, toolName));

  if (candidates.length === 0) {
    return {
      status: "missing-tool",
      message: serverRef
        ? `MCP server "${serverRef}" or tool "${toolName}" was not found.`
        : `MCP tool "${toolName}" was not found in discovered tools.`,
    };
  }
  if (!serverRef && candidates.length > 1) {
    return {
      status: "ambiguous",
      message: `MCP tool "${toolName}" exists on multiple servers. Use /mcp <server>/<tool> or /mcp --server <server> <tool>.`,
    };
  }

  const server = candidates[0];
  if (!server.enabled) {
    return {
      status: "disabled",
      message: `MCP server "${server.name}" is disabled.`,
    };
  }
  if (server.trustStatus !== "trusted") {
    return {
      status: "untrusted",
      message: `Trust MCP server "${server.name}" in Local ADE before invoking tools from chat.`,
    };
  }
  if (server.protocol.status !== "initialized") {
    return {
      status: "not-initialized",
      message:
        server.protocol.error ??
        `Probe MCP server "${server.name}" successfully before invoking tools from chat.`,
    };
  }

  const tool = findTool(server, toolName);
  if (!tool) {
    return {
      status: "missing-tool",
      message: `MCP tool "${toolName}" was not discovered on server "${server.name}".`,
    };
  }

  return { status: "ready", server, toolName: tool.name };
}

function clampForPrompt(value: string, maxLength = 12_000): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}\n[truncated for chat prompt]`;
}

export function buildMcpToolResultPrompt(params: {
  command: ParsedMcpCommand;
  result: McpCommandInvocationResult;
}): string {
  const resultBody =
    params.result.resultText.trim() ||
    params.result.resultJson.trim() ||
    "(MCP tool returned an empty result.)";
  const diagnostics = params.result.diagnostics
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return [
    'A trusted MCP tool was invoked from the "/mcp" chat command.',
    `Server: ${params.result.serverName} (${params.result.serverId})`,
    `Tool: ${params.result.target}`,
    `Status: ${params.result.status}${params.result.isError ? " (tool reported an error)" : ""}`,
    `Duration: ${params.result.durationMs}ms`,
    params.result.truncated
      ? "Result was truncated by the MCP invocation layer."
      : "",
    "",
    "Tool arguments:",
    JSON.stringify(params.command.arguments, null, 2),
    "",
    "MCP result:",
    clampForPrompt(resultBody),
    diagnostics.length > 0 ? "" : "",
    diagnostics.length > 0 ? "Diagnostics:" : "",
    ...diagnostics.map((item) => `- ${item}`),
    "",
    "User request:",
    params.command.request ||
      "Summarize the MCP result and identify the next concrete action.",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

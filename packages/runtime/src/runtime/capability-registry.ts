import {
  type AgentCliAvailability,
  type CapabilityDescriptor,
  createCapabilityRegistrySnapshot,
} from "@eragear-code-copilot/shared";

const FOUNDATION_CAPABILITIES: CapabilityDescriptor[] = [
  {
    id: "skills.local",
    kind: "skill",
    name: "Project Skills",
    description: "Typed slot for skills explicitly installed in the project.",
    scope: "local",
    enabled: false,
    storage: "sqlite",
    tags: ["foundation", "zcode-inspired"],
    diagnostics: ["Registry contract exists; discovery and UI are not built."],
  },
  {
    id: "commands.local",
    kind: "command",
    name: "Local Commands",
    description: "Typed slot for reusable local commands.",
    scope: "local",
    enabled: false,
    storage: "sqlite",
    tags: ["foundation", "zcode-inspired"],
    diagnostics: ["Registry contract exists; command execution is not built."],
  },
  {
    id: "subagents.local",
    kind: "subagent",
    name: "Local Subagents",
    description: "Typed slot for future subagent definitions.",
    scope: "local",
    enabled: false,
    storage: "sqlite",
    tags: ["foundation", "zcode-inspired"],
    diagnostics: ["Registry contract exists; subagent runtime is not built."],
  },
  {
    id: "mcp.local",
    kind: "mcp-server",
    name: "Local MCP Servers",
    description: "Typed slot for future MCP server registration.",
    scope: "local",
    enabled: false,
    storage: "sqlite",
    tags: ["foundation", "zcode-inspired"],
    diagnostics: ["Registry contract exists; MCP lifecycle is not built."],
  },
  {
    id: "plugins.local",
    kind: "plugin",
    name: "Local Plugins",
    description: "Typed slot for future local plugin registration.",
    scope: "plugin",
    enabled: false,
    storage: "sqlite",
    tags: ["foundation", "zcode-inspired"],
    diagnostics: ["Registry contract exists; plugin loading is not built."],
  },
];

function agentCliCapability(item: AgentCliAvailability): CapabilityDescriptor {
  return {
    id: `agent-cli.${item.id}`,
    kind: "command",
    name: `${item.displayName} CLI`,
    description: `Local command capability for ${item.displayName}.`,
    scope: "local",
    enabled: item.available,
    sourcePath: item.executablePath,
    storage: "runtime-diagnostic",
    tags: ["agent-cli", item.id],
    diagnostics: [item.message, ...(item.available ? [] : [item.installHint])],
  };
}

export function createRuntimeCapabilityRegistrySnapshot(
  cliAvailability: AgentCliAvailability[]
) {
  return createCapabilityRegistrySnapshot(
    [...cliAvailability.map(agentCliCapability), ...FOUNDATION_CAPABILITIES],
    [
      "Capability registry foundation is active in diagnostics.",
      "Durable capability records should be backed by SQLite migrations before UI management is added.",
    ]
  );
}

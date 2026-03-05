import { IconFileAi } from "@tabler/icons-react";
import { Github, Sparkles } from "lucide-react";
import type { ElementType } from "react";
import { ClaudeAI, OpenAI, OpenCode } from "@/components/ui/icons";

interface AgentIdentity {
  agentId?: string | null;
  agentName?: string | null;
  agentTitle?: string | null;
  agentType?: string | null;
}

const normalize = (value?: string | null) => value?.trim().toLowerCase() ?? "";

const includesAny = (source: string, patterns: readonly string[]) =>
  patterns.some((pattern) => source.includes(pattern));

const getAgentFamily = (identity: AgentIdentity) => {
  const joined = [
    normalize(identity.agentId),
    normalize(identity.agentName),
    normalize(identity.agentTitle),
    normalize(identity.agentType),
  ]
    .filter(Boolean)
    .join(" ");

  if (
    includesAny(joined, [
      "claude-agent-acp",
      "claudeagent",
      "claude code",
      "claude agent",
      "claude",
    ])
  ) {
    return "claude";
  }
  if (includesAny(joined, ["opencode", "open-code"])) {
    return "opencode";
  }
  if (includesAny(joined, ["codex", "openai"])) {
    return "codex";
  }
  if (includesAny(joined, ["gemini"])) {
    return "gemini";
  }
  if (
    includesAny(joined, [
      "copilot",
      "copilot-cli",
      "github-copilot",
      "github copilot",
    ])
  ) {
    return "copilot";
  }
  return "unknown";
};

export const getAgentIconComponent = (identity: AgentIdentity): ElementType => {
  switch (getAgentFamily(identity)) {
    case "claude":
      return ClaudeAI;
    case "opencode":
      return OpenCode;
    case "codex":
      return OpenAI;
    case "gemini":
      return Sparkles;
    case "copilot":
      return Github;
    default:
      return IconFileAi;
  }
};

export const renderAgentIcon = (
  identity: AgentIdentity,
  className = "h-4 w-4"
) => {
  const Icon = getAgentIconComponent(identity);
  return <Icon className={className} />;
};

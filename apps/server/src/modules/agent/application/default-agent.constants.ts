import type { AgentInput } from "@/shared/types/agent.types";

export const DEFAULT_AGENT_ID_PREFIX = "default-opencode";

export function buildDefaultAgentId(userId: string): string {
  return `${DEFAULT_AGENT_ID_PREFIX}-${userId}`;
}

export function buildDefaultAgentInput(userId: string): AgentInput {
  return {
    userId,
    name: "Default (Opencode)",
    type: "opencode",
    command: "opencode",
    args: ["acp"],
    env: {},
    projectId: null,
  };
}

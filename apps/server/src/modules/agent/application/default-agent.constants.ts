import type { AgentInput } from "@/shared/types/agent.types";
import { getDefaultAgentResumeCommandTemplate } from "@/shared/utils/agent-resume-command.util";

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
    resumeCommandTemplate: getDefaultAgentResumeCommandTemplate("opencode"),
    env: {},
    projectId: null,
  };
}

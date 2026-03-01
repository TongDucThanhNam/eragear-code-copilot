import type { AgentConfig } from "@/shared/types/agent.types";

export const AGENT_SESSION_ID_PLACEHOLDER = "<sessionId>";

const DEFAULT_AGENT_RESUME_TEMPLATES: Partial<
  Record<AgentConfig["type"], string>
> = {
  claude: `claude -r ${AGENT_SESSION_ID_PLACEHOLDER}`,
  codex: `codex resume ${AGENT_SESSION_ID_PLACEHOLDER}`,
  opencode: `opencode -s ${AGENT_SESSION_ID_PLACEHOLDER}`,
  gemini: `gemini --resume ${AGENT_SESSION_ID_PLACEHOLDER}`,
};

export function getDefaultAgentResumeCommandTemplate(
  type: AgentConfig["type"]
): string | undefined {
  return DEFAULT_AGENT_RESUME_TEMPLATES[type];
}

export function normalizeAgentResumeCommandTemplate(params: {
  type: AgentConfig["type"];
  resumeCommandTemplate?: string | null;
  fallbackToDefault?: boolean;
}): string | undefined {
  const fallbackToDefault = params.fallbackToDefault ?? true;
  const rawTemplate = params.resumeCommandTemplate?.trim();

  if (!rawTemplate) {
    return fallbackToDefault
      ? getDefaultAgentResumeCommandTemplate(params.type)
      : undefined;
  }

  if (rawTemplate.includes(AGENT_SESSION_ID_PLACEHOLDER)) {
    return rawTemplate;
  }

  return `${rawTemplate} ${AGENT_SESSION_ID_PLACEHOLDER}`;
}

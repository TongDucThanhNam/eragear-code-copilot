const LAST_DRAFT_AGENT_STORAGE_KEY = "eragear:last-new-chat-agent";

export function resolveDraftAgentId(input: {
  agentIds: string[];
  activeAgentId?: string | null;
  cachedAgentId?: string | null;
}): string | null {
  const availableAgentIds = new Set(input.agentIds);
  if (input.cachedAgentId && availableAgentIds.has(input.cachedAgentId)) {
    return input.cachedAgentId;
  }
  if (input.activeAgentId && availableAgentIds.has(input.activeAgentId)) {
    return input.activeAgentId;
  }
  return input.agentIds[0] ?? null;
}

export function readLastDraftAgentId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(LAST_DRAFT_AGENT_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function rememberLastDraftAgentId(agentId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(LAST_DRAFT_AGENT_STORAGE_KEY, agentId);
  } catch {
    // A blocked localStorage must not prevent starting a chat.
  }
}

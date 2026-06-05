import type { ListedSession } from "./types";

export function truncateSessionId(id: string | undefined): string {
  if (!id) {
    return "Unknown";
  }
  if (id.length <= 12) {
    return id;
  }
  return `${id.slice(0, 6)}...${id.slice(-6)}`;
}

export function getSessionTitle(
  name: string | null | undefined,
  sessionId: string | undefined
): string {
  const trimmedName = name?.trim();
  if (trimmedName) {
    return trimmedName;
  }
  return truncateSessionId(sessionId);
}

export function formatTimestamp(dateValue: string | number): string {
  const date = new Date(dateValue);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) {
    return "Just now";
  }
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }
  return date.toLocaleDateString();
}

export function formatTaskTimestamp(
  dateValue: string | number | null | undefined
) {
  if (!dateValue) {
    return "";
  }

  return new Date(dateValue).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getSessionAgentType(session: ListedSession): string | null {
  return (
    session.agentInfo?.title ||
    session.agentInfo?.name ||
    session.agentName ||
    null
  );
}

export function parseProjectTags(tags: string): string[] {
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

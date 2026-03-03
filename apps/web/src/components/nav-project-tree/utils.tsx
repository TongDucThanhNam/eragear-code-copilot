import { Pin } from "lucide-react";
import { ClaudeAI, OpenAI, OpenCode } from "@/components/ui/icons";
import type { SessionItem } from "./types";

export const UNKNOWN_PROJECT_ID = "unknown";
export const SESSION_ID_PLACEHOLDER = "<sessionId>";
export const AGENT_RESUME_TEMPLATE_BY_TYPE: Record<string, string> = {
  codex: `codex resume ${SESSION_ID_PLACEHOLDER}`,
  claude: `claude -r ${SESSION_ID_PLACEHOLDER}`,
  opencode: `opencode -s ${SESSION_ID_PLACEHOLDER}`,
  gemini: `gemini --resume ${SESSION_ID_PLACEHOLDER}`,
};

export const getAgentIcon = (agentName: string | undefined) => {
  switch (agentName) {
    case "Claude Code":
      return <ClaudeAI className="h-4 w-4" />;
    case "OpenCode":
      return <OpenCode className="h-4 w-4" />;
    case "Codex":
      return <OpenAI className="h-4 w-4" />;
    default:
      return null;
  }
};

export const renderPinnedIcon = (isPinned: boolean) =>
  isPinned ? <Pin className="mr-1.5 h-3 w-3 text-muted-foreground" /> : null;

export const getSessionDisplayId = (session: SessionItem) => {
  const rawId = session.sessionId || session.id;
  if (rawId.length <= 12) {
    return rawId;
  }
  const head = rawId.slice(0, 7);
  const tail = rawId.slice(-4);
  return `${head}...${tail}`;
};

export const getSessionStatusLabel = (status: SessionItem["status"]) => {
  if (status === "streaming") {
    return "running";
  }
  return status;
};

export const getDiscoveredSessionLabel = (session: {
  sessionId: string;
  title?: string | null;
}) => {
  const trimmedTitle = session.title?.trim();
  if (trimmedTitle) {
    return trimmedTitle;
  }
  return session.sessionId;
};

export const formatDiscoveredUpdatedAt = (value?: string | null) => {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }
  return new Date(parsed).toLocaleString();
};

export const getStatusBadgeClassName = (status: SessionItem["status"]) => {
  switch (status) {
    case "active":
      return "border-none bg-green-600/10 text-green-600 focus-visible:ring-green-600/20 focus-visible:outline-none dark:bg-green-400/10 dark:text-green-400 dark:focus-visible:ring-green-400/40 [a&]:hover:bg-green-600/5 dark:[a&]:hover:bg-green-400/5";
    case "streaming":
      return "border-none bg-amber-600/10 text-amber-600 focus-visible:ring-amber-600/20 focus-visible:outline-none dark:bg-amber-400/10 dark:text-amber-400 dark:focus-visible:ring-amber-400/40 [a&]:hover:bg-amber-600/5 dark:[a&]:hover:bg-amber-400/5";
    case "inactive":
    default:
      return "bg-destructive/10 [a&]:hover:bg-destructive/5 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 text-destructive border-none focus-visible:outline-none";
  }
};

export const getStatusDotClassName = (status: SessionItem["status"]) => {
  switch (status) {
    case "active":
      return "bg-green-600 dark:bg-green-400";
    case "streaming":
      return "bg-amber-600 dark:bg-amber-400";
    case "inactive":
    default:
      return "bg-destructive";
  }
};

export const quoteForShell = (value: string) =>
  `'${value.replaceAll("'", "'\\''")}'`;

export const renderResumeCommand = (template: string, sessionId: string) => {
  const quotedSessionId = quoteForShell(sessionId);
  if (template.includes(SESSION_ID_PLACEHOLDER)) {
    return template.replaceAll(SESSION_ID_PLACEHOLDER, quotedSessionId);
  }
  return `${template} ${quotedSessionId}`.trim();
};

export const inferAgentTypeFromSession = (session: SessionItem) => {
  const source =
    session.agentName ??
    session.agentInfo?.name ??
    session.agentInfo?.title ??
    "";
  const normalized = source.toLowerCase();
  if (normalized.includes("codex")) {
    return "codex";
  }
  if (normalized.includes("claude")) {
    return "claude";
  }
  if (normalized.includes("opencode")) {
    return "opencode";
  }
  if (normalized.includes("gemini")) {
    return "gemini";
  }
  return null;
};

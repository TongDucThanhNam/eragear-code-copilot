// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
import { useProjectStore } from "@/store/project-store";
import { useWorkspaceSessionStore } from "@/store/workspace-session-store";

export const ERAGEAR_DEEP_LINK_SCHEME = "eragear";

export type EragearDeepLinkAction =
  | {
      kind: "chat";
      chatId: string;
      projectId?: string;
    }
  | {
      kind: "project";
      projectId: string;
    }
  | {
      kind: "settings";
      section?: string;
    }
  | {
      kind: "home";
      projectId?: string;
      agentId?: string;
    };

export interface DeepLinkRouter {
  navigate: (options: {
    to: string;
    search?: Record<string, string>;
    replace?: boolean;
  }) => Promise<unknown> | unknown;
}

export function parseEragearDeepLink(
  rawUrl: string
): EragearDeepLinkAction | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${ERAGEAR_DEEP_LINK_SCHEME}:`) {
    return null;
  }

  const host = decodeURIComponent(url.hostname).toLowerCase();
  const segments = url.pathname
    .split("/")
    .map((segment) => decodeURIComponent(segment.trim()))
    .filter(Boolean);
  const chatId =
    queryValue(url, "chatId") ??
    queryValue(url, "sessionId") ??
    (host === "chat" || host === "session" ? segments[0] : null);
  const projectId =
    queryValue(url, "projectId") ?? (host === "project" ? segments[0] : null);
  const agentId = queryValue(url, "agentId");

  if (chatId) {
    return {
      kind: "chat",
      chatId,
      ...(projectId ? { projectId } : {}),
    };
  }
  if (projectId) {
    return {
      kind: "project",
      projectId,
    };
  }
  if (host === "settings") {
    const section = queryValue(url, "section") ?? segments[0] ?? undefined;
    return {
      kind: "settings",
      ...(section ? { section } : {}),
    };
  }
  return {
    kind: "home",
    ...(agentId ? { agentId } : {}),
  };
}

export function applyEragearDeepLink(
  action: EragearDeepLinkAction,
  router: DeepLinkRouter
): void {
  if ("projectId" in action && action.projectId) {
    useProjectStore.getState().setActiveProjectId(action.projectId);
  }

  switch (action.kind) {
    case "chat":
      void router.navigate({
        to: "/",
        search: { chatId: action.chatId },
      });
      return;
    case "project": {
      const lastChatId =
        useWorkspaceSessionStore.getState().lastActiveByProjectId[
          action.projectId
        ];
      void router.navigate({
        to: "/",
        ...(lastChatId ? { search: { chatId: lastChatId } } : {}),
      });
      return;
    }
    case "settings":
      void router.navigate({
        to: settingsPath(action.section),
      });
      return;
    case "home":
      void router.navigate({ to: "/" });
      return;
  }
}

export async function installEragearDeepLinkHandlers(
  router: DeepLinkRouter
): Promise<() => void> {
  void router;
  return () => undefined;
}

function queryValue(url: URL, key: string): string | null {
  const value = url.searchParams.get(key)?.trim();
  return value ? value : null;
}

function settingsPath(section?: string): string {
  const normalized = section?.trim().toLowerCase();
  if (!normalized) {
    return "/settings";
  }
  const allowed = new Set([
    "activity",
    "agents",
    "archive",
    "bots",
    "automation",
    "commands",
    "connection",
    "credentials",
    "crash-reporting",
    "hooks",
    "mcp",
    "memory",
    "plugins",
    "prompt-enhancement",
    "repo-snapshots",
    "remote-control",
    "runtime",
    "skills",
    "sync",
    "terminal",
    "traffic-proxy",
    "usage",
  ]);
  return allowed.has(normalized) ? `/settings/${normalized}` : "/settings";
}

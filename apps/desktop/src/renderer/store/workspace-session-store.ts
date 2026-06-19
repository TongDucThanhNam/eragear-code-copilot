import { create } from "zustand";
import { persist } from "zustand/middleware";

const MAX_WORKSPACE_TABS = 8;

export interface WorkspaceSessionTab {
  chatId: string;
  projectId: string | null;
  title: string;
  projectName: string | null;
  updatedAt: number;
}

export interface WorkspaceRestoreSession {
  id: string;
  projectId?: string | null;
  archived?: boolean | null;
  lastActiveAt?: number | null;
}

interface WorkspaceSessionState {
  lastActiveChatId: string | null;
  lastActiveByProjectId: Record<string, string>;
  tabs: WorkspaceSessionTab[];
  rememberSession: (tab: Omit<WorkspaceSessionTab, "updatedAt">) => void;
  forgetSession: (chatId: string) => void;
  clear: () => void;
}

export const useWorkspaceSessionStore = create<WorkspaceSessionState>()(
  persist(
    (set) => ({
      lastActiveChatId: null,
      lastActiveByProjectId: {},
      tabs: [],

      rememberSession: (tab) =>
        set((state) => {
          const updatedAt = Date.now();
          const normalized: WorkspaceSessionTab = {
            chatId: tab.chatId,
            projectId: tab.projectId,
            title: tab.title.trim() || `Session ${tab.chatId.slice(0, 8)}`,
            projectName: tab.projectName?.trim() || null,
            updatedAt,
          };
          const lastActiveByProjectId = { ...state.lastActiveByProjectId };
          if (normalized.projectId) {
            lastActiveByProjectId[normalized.projectId] = normalized.chatId;
          }
          return {
            lastActiveChatId: normalized.chatId,
            lastActiveByProjectId,
            tabs: trimWorkspaceTabs([
              normalized,
              ...state.tabs.filter((item) => item.chatId !== normalized.chatId),
            ]),
          };
        }),

      forgetSession: (chatId) =>
        set((state) => {
          const lastActiveByProjectId = Object.fromEntries(
            Object.entries(state.lastActiveByProjectId).filter(
              ([, value]) => value !== chatId
            )
          );
          const tabs = state.tabs.filter((item) => item.chatId !== chatId);
          return {
            tabs,
            lastActiveByProjectId,
            lastActiveChatId:
              state.lastActiveChatId === chatId
                ? (tabs[0]?.chatId ?? null)
                : state.lastActiveChatId,
          };
        }),

      clear: () =>
        set({
          lastActiveChatId: null,
          lastActiveByProjectId: {},
          tabs: [],
        }),
    }),
    {
      name: "eragear-workspace-sessions",
      partialize: (state) => ({
        lastActiveChatId: state.lastActiveChatId,
        lastActiveByProjectId: state.lastActiveByProjectId,
        tabs: state.tabs,
      }),
    }
  )
);

export function resolveRestoredWorkspaceChatId(params: {
  sessions: WorkspaceRestoreSession[];
  lastActiveChatId: string | null;
  lastActiveByProjectId: Record<string, string>;
  activeProjectId: string | null;
}): string | null {
  const available = params.sessions.filter((session) => !session.archived);
  if (available.length === 0) {
    return null;
  }
  const byId = new Map(available.map((session) => [session.id, session]));
  if (params.lastActiveChatId && byId.has(params.lastActiveChatId)) {
    return params.lastActiveChatId;
  }
  if (params.activeProjectId) {
    const projectLast = params.lastActiveByProjectId[params.activeProjectId];
    if (projectLast && byId.has(projectLast)) {
      return projectLast;
    }
    const latestForProject = newestSession(
      available.filter(
        (session) => session.projectId === params.activeProjectId
      )
    );
    if (latestForProject) {
      return latestForProject.id;
    }
  }
  return newestSession(available)?.id ?? null;
}

export function trimWorkspaceTabs(
  tabs: WorkspaceSessionTab[]
): WorkspaceSessionTab[] {
  return tabs
    .filter((tab) => tab.chatId.trim().length > 0)
    .slice(0, MAX_WORKSPACE_TABS);
}

function newestSession(
  sessions: WorkspaceRestoreSession[]
): WorkspaceRestoreSession | null {
  return (
    [...sessions].sort(
      (left, right) => (right.lastActiveAt ?? 0) - (left.lastActiveAt ?? 0)
    )[0] ?? null
  );
}

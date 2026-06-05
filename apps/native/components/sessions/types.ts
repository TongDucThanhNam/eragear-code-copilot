import type { StoredSessionInfo } from "@/store/chat-store";

export type FilterTab = "all" | "active" | "inactive";

export interface DiscoveredSessionItem {
  sessionId: string;
  cwd: string;
  title?: string | null;
  updatedAt?: string | null;
}

export type ListedSession = StoredSessionInfo & {
  name?: string | null;
  pinned?: boolean;
  archived?: boolean;
};

export interface ProjectFormState {
  name: string;
  path: string;
  description: string;
  tags: string;
}

export interface SessionActionTarget {
  id: string;
  name?: string | null;
  pinned?: boolean;
  archived?: boolean;
}

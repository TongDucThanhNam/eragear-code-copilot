export interface TaskAutoArchiveSession {
  id: string;
  userId: string;
  status: "running" | "stopped";
  pinned?: boolean;
  archived?: boolean;
  lastActiveAt: number;
}

export interface TaskAutoArchiveSessionPage {
  sessions: TaskAutoArchiveSession[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface TaskAutoArchiveSessionPort {
  listPage(input?: {
    cursor?: string;
    limit?: number;
  }): Promise<TaskAutoArchiveSessionPage>;
  archiveSession(id: string, userId: string): Promise<void>;
  isActiveSession(id: string): boolean;
}

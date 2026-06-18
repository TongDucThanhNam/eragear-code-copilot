import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import {
  TaskAutoArchiveFileRepository,
  TaskAutoArchiveService,
  type TaskAutoArchiveSession,
  type TaskAutoArchiveSessionPage,
  type TaskAutoArchiveSessionPort,
} from "@/modules/task-auto-archive";
import type { TaskAutoArchiveUseCases } from "@/modules/use-cases";
import { getStorageFileSync } from "@/platform/storage/storage-path";
import type { ServiceRegistrySlice } from "./dependencies";

type TaskAutoArchiveServiceDependencies = ServiceRegistrySlice<
  "sessionRepo" | "sessionRuntime" | "clock"
>;

class SessionTaskAutoArchiveAdapter implements TaskAutoArchiveSessionPort {
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly sessionRuntime: SessionRuntimePort;

  constructor(deps: {
    sessionRepo: SessionRepositoryPort;
    sessionRuntime: SessionRuntimePort;
  }) {
    this.sessionRepo = deps.sessionRepo;
    this.sessionRuntime = deps.sessionRuntime;
  }

  async listPage(input?: {
    cursor?: string;
    limit?: number;
  }): Promise<TaskAutoArchiveSessionPage> {
    const page = await this.sessionRepo.findPageForMaintenance(input);
    return {
      sessions: page.sessions.map(toTaskSession),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }

  async archiveSession(id: string, userId: string): Promise<void> {
    await this.sessionRepo.updateMetadata(id, userId, {
      archived: true,
    });
  }

  isActiveSession(id: string): boolean {
    return this.sessionRuntime.has(id);
  }
}

function toTaskSession(session: {
  id: string;
  userId: string;
  status: "running" | "stopped";
  pinned?: boolean;
  archived?: boolean;
  lastActiveAt: number;
}): TaskAutoArchiveSession {
  return {
    id: session.id,
    userId: session.userId,
    status: session.status,
    pinned: session.pinned,
    archived: session.archived,
    lastActiveAt: session.lastActiveAt,
  };
}

export function createTaskAutoArchiveUseCases(
  deps: TaskAutoArchiveServiceDependencies
): TaskAutoArchiveUseCases {
  return {
    taskAutoArchive: new TaskAutoArchiveService({
      repository: new TaskAutoArchiveFileRepository({
        filePath: () => getStorageFileSync("task-auto-archive.json"),
      }),
      sessions: new SessionTaskAutoArchiveAdapter({
        sessionRepo: deps.sessionRepo,
        sessionRuntime: deps.sessionRuntime,
      }),
      nowMs: deps.clock.nowMs,
    }),
  };
}

import type { ProjectRepositoryPort } from "@/modules/project";
import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import type { StoredSession } from "@/shared/types/session.types";

export class ListDashboardSessionsService {
  private readonly projectRepo: ProjectRepositoryPort;
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly sessionRuntime: SessionRuntimePort;

  constructor(
    projectRepo: ProjectRepositoryPort,
    sessionRepo: SessionRepositoryPort,
    sessionRuntime: SessionRuntimePort
  ) {
    this.projectRepo = projectRepo;
    this.sessionRepo = sessionRepo;
    this.sessionRuntime = sessionRuntime;
  }

  async execute(input: { userId: string; limit: number; offset: number }) {
    const projects = await this.projectRepo.findAll(input.userId);
    const [storedSessions, totalSessions] = await Promise.all([
      this.sessionRepo.findAll(input.userId, {
        limit: input.limit,
        offset: input.offset,
      }),
      this.sessionRepo.countAll(input.userId),
    ]);

    const sessions = storedSessions.map((session: StoredSession) => {
      const activeSession = this.sessionRuntime.get(session.id);
      const isActive = Boolean(activeSession);
      const agentInfo = activeSession?.agentInfo ?? session.agentInfo;
      const agentName = agentInfo?.title ?? agentInfo?.name ?? "Unknown Agent";

      return {
        id: session.id,
        sessionId: session.sessionId,
        projectId: session.projectId ?? null,
        projectRoot: session.projectRoot,
        projectName: session.projectId
          ? projects.find((p) => p.id === session.projectId)?.name
          : session.projectRoot.split("/").pop(),
        modeId: session.modeId,
        status: session.status,
        isActive,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
        agentInfo,
        agentName,
        messageCount: session.messageCount ?? session.messages.length,
      };
    });

    sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt);

    return {
      sessions,
      pagination: {
        limit: input.limit,
        offset: input.offset,
        total: totalSessions,
        hasMore: input.offset + sessions.length < totalSessions,
      },
    };
  }
}

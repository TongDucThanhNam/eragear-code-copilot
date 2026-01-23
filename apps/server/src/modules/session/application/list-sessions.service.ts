import type {
  ProjectRepositoryPort,
  SessionRepositoryPort,
  SessionRuntimePort,
} from "../../../shared/types/ports";

export class ListSessionsService {
  constructor(
    private sessionRepo: SessionRepositoryPort,
    private sessionRuntime: SessionRuntimePort,
    private projectRepo: ProjectRepositoryPort
  ) {}

  execute() {
    const projects = this.projectRepo.findAll();
    const storedSessions = this.sessionRepo.findAll();

    return storedSessions.map((session) => {
      const activeSession = this.sessionRuntime.get(session.id);
      const isActive = Boolean(activeSession);
      const loadSessionSupported =
        activeSession?.loadSessionSupported ?? session.loadSessionSupported;
      const agentInfo = activeSession?.agentInfo ?? session.agentInfo;
      const agentName = agentInfo?.title ?? agentInfo?.name;
      const derivedProjectId =
        session.projectId ??
        projects.find((project) => project.path === session.projectRoot)?.id;

      if (!session.projectId && derivedProjectId) {
        this.sessionRepo.updateMetadata(session.id, {
          projectId: derivedProjectId,
        });
      }

      return {
        id: session.id,
        name: session.name,
        sessionId: activeSession?.sessionId ?? session.sessionId,
        projectId: derivedProjectId ?? session.projectId ?? null,
        projectRoot: session.projectRoot,
        modeId: session.modeId,
        status: session.status,
        isActive,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
        loadSessionSupported,
        agentInfo,
        agentName,
        pinned: session.pinned ?? false,
        archived: session.archived ?? false,
      };
    });
  }
}

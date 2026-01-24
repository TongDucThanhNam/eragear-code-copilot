/**
 * List Sessions Service
 *
 * Retrieves and formats all sessions with derived state from both runtime and storage.
 * Combines active session data with stored session metadata for a complete view.
 *
 * @module modules/session/application/list-sessions.service
 */

import type {
  ProjectRepositoryPort,
  SessionRepositoryPort,
  SessionRuntimePort,
} from "../../../shared/types/ports";

/**
 * ListSessionsService
 *
 * Provides a unified view of all sessions by combining:
 * - Active sessions from the runtime store
 * - Stored sessions from the repository
 * - Project information for context
 *
 * Enriches session data with derived fields like agent name, active status, and plan.
 */
export class ListSessionsService {
  /** Repository for session persistence */
  readonly sessionRepo: SessionRepositoryPort;
  /** Runtime store for active sessions */
  readonly sessionRuntime: SessionRuntimePort;
  /** Repository for project information */
  readonly projectRepo: ProjectRepositoryPort;

  /**
   * Creates a ListSessionsService with required dependencies
   */
  constructor(
    sessionRepo: SessionRepositoryPort,
    sessionRuntime: SessionRuntimePort,
    projectRepo: ProjectRepositoryPort
  ) {
    this.sessionRepo = sessionRepo;
    this.sessionRuntime = sessionRuntime;
    this.projectRepo = projectRepo;
  }

  /**
   * Retrieves and formats all sessions
   *
   * @returns Array of formatted session objects with enriched data
   *
   * Each session includes:
   * - Basic info (id, name, sessionId)
   * - Project context (projectId, projectRoot)
   * - State info (status, isActive, modeId)
   * - Agent metadata (agentInfo, agentName, loadSessionSupported)
   * - Plan information
   * - Timestamps (createdAt, lastActiveAt)
   * - Session flags (pinned, archived)
   */
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
      const plan = activeSession?.plan ?? session.plan ?? null;
      const agentCapabilities = activeSession?.agentCapabilities ?? session.agentCapabilities;
      const authMethods = activeSession?.authMethods ?? session.authMethods;
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
        agentCapabilities,
        authMethods,
        plan,
        pinned: session.pinned ?? false,
        archived: session.archived ?? false,
      };
    });
  }
}

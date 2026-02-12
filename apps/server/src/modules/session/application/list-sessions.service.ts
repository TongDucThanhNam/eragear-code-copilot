/**
 * List Sessions Service
 *
 * Retrieves and formats all sessions with derived state from both runtime and storage.
 * Combines active session data with stored session metadata for a complete view.
 *
 * @module modules/session/application/list-sessions.service
 */

import { DEFAULT_SESSION_LIST_PAGE_LIMIT } from "@/config/constants";
import type { ProjectRepositoryPort } from "@/modules/project";
import { ValidationError } from "@/shared/errors";
import type { StoredSession } from "@/shared/types/session.types";
import type {
  SessionListPageQuery,
  SessionListQuery,
  SessionRepositoryPort,
} from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";

export class ListSessionsService {
  readonly sessionRepo: SessionRepositoryPort;
  readonly sessionRuntime: SessionRuntimePort;
  readonly projectRepo: ProjectRepositoryPort;

  constructor(
    sessionRepo: SessionRepositoryPort,
    sessionRuntime: SessionRuntimePort,
    projectRepo: ProjectRepositoryPort
  ) {
    this.sessionRepo = sessionRepo;
    this.sessionRuntime = sessionRuntime;
    this.projectRepo = projectRepo;
  }

  async execute(
    userId: string,
    query: SessionListQuery | undefined,
    maxLimit: number
  ) {
    const normalizedQuery = this.normalizeOffsetLimit(query, maxLimit);
    const projects = await this.projectRepo.findAll(userId);
    const storedSessions = await this.sessionRepo.findAll(
      userId,
      normalizedQuery
    );
    return await this.hydrateSessions(userId, storedSessions, projects);
  }

  async executePage(
    userId: string,
    query: SessionListPageQuery | undefined,
    maxLimit: number
  ) {
    const normalizedQuery = this.normalizeCursorLimit(query, maxLimit);
    const projects = await this.projectRepo.findAll(userId);
    const page = await this.sessionRepo.findPage(userId, normalizedQuery);
    const items = await this.hydrateSessions(userId, page.sessions, projects);

    return {
      items,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }

  private normalizeOffsetLimit(
    query: SessionListQuery | undefined,
    maxLimit: number
  ): SessionListQuery {
    const normalizedMaxLimit = Math.max(1, Math.trunc(maxLimit));
    if (
      query?.limit !== undefined &&
      Number.isFinite(query.limit) &&
      query.limit > normalizedMaxLimit
    ) {
      throw new ValidationError(`limit must be <= ${normalizedMaxLimit}`, {
        module: "session",
        op: "session.list",
        details: {
          limit: query.limit,
          maxLimit: normalizedMaxLimit,
        },
      });
    }

    return {
      limit:
        query?.limit ??
        Math.min(DEFAULT_SESSION_LIST_PAGE_LIMIT, normalizedMaxLimit),
      offset: query?.offset ?? 0,
    };
  }

  private normalizeCursorLimit(
    query: SessionListPageQuery | undefined,
    maxLimit: number
  ): SessionListPageQuery {
    const normalizedMaxLimit = Math.max(1, Math.trunc(maxLimit));
    if (
      query?.limit !== undefined &&
      Number.isFinite(query.limit) &&
      query.limit > normalizedMaxLimit
    ) {
      throw new ValidationError(`limit must be <= ${normalizedMaxLimit}`, {
        module: "session",
        op: "session.page",
        details: {
          limit: query.limit,
          maxLimit: normalizedMaxLimit,
        },
      });
    }

    return {
      limit:
        query?.limit ??
        Math.min(DEFAULT_SESSION_LIST_PAGE_LIMIT, normalizedMaxLimit),
      cursor: query?.cursor,
    };
  }

  private async hydrateSessions(
    userId: string,
    sessions: StoredSession[],
    projects: Array<{ id: string; path: string }>
  ) {
    return await Promise.all(
      sessions.map(async (session) => {
        const activeSession = this.sessionRuntime.get(session.id);
        const isActive = Boolean(activeSession);
        const loadSessionSupported =
          activeSession?.loadSessionSupported ?? session.loadSessionSupported;
        const agentInfo = activeSession?.agentInfo ?? session.agentInfo;
        const agentName = agentInfo?.title ?? agentInfo?.name;
        const plan = activeSession?.plan ?? session.plan ?? null;
        const agentCapabilities =
          activeSession?.agentCapabilities ?? session.agentCapabilities;
        const authMethods = activeSession?.authMethods ?? session.authMethods;
        const supportsModelSwitching =
          activeSession?.supportsModelSwitching ??
          session.supportsModelSwitching ??
          false;
        const derivedProjectId =
          session.projectId ??
          projects.find((project) => project.path === session.projectRoot)?.id;

        if (!session.projectId && derivedProjectId) {
          await this.sessionRepo.updateMetadata(session.id, userId, {
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
          supportsModelSwitching,
          agentInfo,
          agentName,
          agentCapabilities,
          authMethods,
          plan,
          pinned: session.pinned ?? false,
          archived: session.archived ?? false,
        };
      })
    );
  }
}

import type { ProjectRepositoryPort } from "@/modules/project";
import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import type { StoredSession } from "@/shared/types/session.types";
import {
  DashboardProjectContext,
  type DashboardProjectContextProject,
} from "./dashboard-project-context";

const TRAILING_SLASH_REGEX = /[\\/]+$/;
const PATH_SEGMENT_SEPARATOR_REGEX = /[/\\]+/;

export interface DashboardSessionProjectContext
  extends DashboardProjectContextProject {
  name: string;
}

export interface ListDashboardSessionsInput {
  userId: string;
  limit: number;
  offset: number;
  projects?: DashboardSessionProjectContext[];
}

/**
 * Builds the dashboard session list for one user.
 *
 * Caller contract: persisted sessions are enriched with live runtime state when
 * present; callers that already loaded dashboard project context may pass it to
 * avoid a duplicate project repository read.
 */
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

  async execute(input: ListDashboardSessionsInput) {
    const projects =
      input.projects ?? (await this.projectRepo.findAll(input.userId));
    const projectContext = new DashboardProjectContext(projects);
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
        projectName: getDashboardSessionProjectName(session, projectContext),
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

function getDashboardSessionProjectName(
  session: StoredSession,
  projectContext: DashboardProjectContext
): string | undefined {
  const resolvedProject = projectContext.resolveSessionProject(session);
  if (resolvedProject?.name) {
    return resolvedProject.name;
  }
  if (session.projectId) {
    return undefined;
  }
  return getProjectNameFromRootPath(session.projectRoot);
}

function getProjectNameFromRootPath(projectRoot: string): string {
  const trimmed = projectRoot.trim().replace(TRAILING_SLASH_REGEX, "");
  if (!trimmed) {
    return projectRoot;
  }
  const segments = trimmed.split(PATH_SEGMENT_SEPARATOR_REGEX);
  return segments.at(-1) || projectRoot;
}

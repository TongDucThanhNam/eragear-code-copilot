import { describe, expect, test } from "bun:test";
import type { ProjectRepositoryPort } from "#runtime/modules/project";
import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "#runtime/modules/session";
import type { StoredSession } from "#runtime/shared/types/session.types";
import { ListDashboardSessionsService } from "./list-dashboard-sessions.service";

function createStoredSession(overrides: Partial<StoredSession>): StoredSession {
  return {
    id: "chat-1",
    userId: "user-1",
    projectRoot: "/repo/sample",
    status: "running",
    createdAt: 1,
    lastActiveAt: 1,
    messages: [],
    ...overrides,
  };
}

describe("ListDashboardSessionsService", () => {
  test("uses cross-platform basename fallback for projectRoot when projectId is missing", async () => {
    const session = createStoredSession({
      id: "chat-windows",
      projectRoot: "C:\\Users\\dev\\my-app\\",
    });

    const projectRepo = {
      findAll: async () => [],
    } as unknown as ProjectRepositoryPort;

    const sessionRepo = {
      findAll: async () => [session],
      countAll: async () => 1,
    } as unknown as SessionRepositoryPort;

    const sessionRuntime = {
      get: () => undefined,
    } as unknown as SessionRuntimePort;

    const service = new ListDashboardSessionsService(
      projectRepo,
      sessionRepo,
      sessionRuntime
    );

    const result = await service.execute({
      userId: "user-1",
      limit: 20,
      offset: 0,
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.projectName).toBe("my-app");
  });

  test("uses caller-provided project context without reading project repository", async () => {
    const session = createStoredSession({
      id: "chat-project",
      projectId: "project-1",
      projectRoot: "/repo/project",
    });

    const projectRepo = {
      findAll: () => {
        throw new Error("project repository should not be read");
      },
    } as unknown as ProjectRepositoryPort;

    const sessionRepo = {
      findAll: async () => [session],
      countAll: async () => 1,
    } as unknown as SessionRepositoryPort;

    const sessionRuntime = {
      get: () => undefined,
    } as unknown as SessionRuntimePort;

    const service = new ListDashboardSessionsService(
      projectRepo,
      sessionRepo,
      sessionRuntime
    );

    const result = await service.execute({
      userId: "user-1",
      limit: 20,
      offset: 0,
      projects: [
        {
          id: "project-1",
          name: "Project One",
          path: "/repo/project",
        },
      ],
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.projectName).toBe("Project One");
  });

  test("uses projectRoot fallback from project context when projectId is missing", async () => {
    const session = createStoredSession({
      id: "chat-root-fallback",
      projectRoot: "/repo/project",
    });

    const projectRepo = {
      findAll: async () => [
        {
          id: "project-1",
          name: "Renamed Project",
          path: "/repo/project",
        },
      ],
    } as unknown as ProjectRepositoryPort;

    const sessionRepo = {
      findAll: async () => [session],
      countAll: async () => 1,
    } as unknown as SessionRepositoryPort;

    const sessionRuntime = {
      get: () => undefined,
    } as unknown as SessionRuntimePort;

    const service = new ListDashboardSessionsService(
      projectRepo,
      sessionRepo,
      sessionRuntime
    );

    const result = await service.execute({
      userId: "user-1",
      limit: 20,
      offset: 0,
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.projectName).toBe("Renamed Project");
  });
});

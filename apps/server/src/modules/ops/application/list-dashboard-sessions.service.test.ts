import { describe, expect, test } from "bun:test";
import type { ProjectRepositoryPort } from "@/modules/project";
import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import type { StoredSession } from "@/shared/types/session.types";
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
});

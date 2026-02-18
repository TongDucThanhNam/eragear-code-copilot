import { describe, expect, test } from "bun:test";
import path from "node:path";
import type { ProjectRepositoryPort } from "@/modules/project";
import type { SettingsRepositoryPort } from "@/modules/settings";
import { SessionProjectContextResolverService } from "./session-project-context-resolver.service";

const PROJECT_ROOT_REJECT_RE = /not allowed|configured project roots/i;

describe("SessionProjectContextResolverService", () => {
  test("uses project path from repository when projectId is provided", async () => {
    const service = new SessionProjectContextResolverService(
      {
        findById: async () => ({
          id: "project-1",
          userId: "user-1",
          name: "Project",
          path: "/repo/project-1",
          createdAt: 0,
          updatedAt: 0,
          favorite: false,
          tags: [],
          description: null,
          lastOpenedAt: null,
        }),
      } as unknown as ProjectRepositoryPort,
      {
        get: async () => ({ projectRoots: ["/repo"] }),
      } as unknown as SettingsRepositoryPort
    );

    await expect(
      service.resolve({
        userId: "user-1",
        projectId: "project-1",
        projectRoot: "/malicious/path",
      })
    ).resolves.toEqual({
      projectId: "project-1",
      projectRoot: "/repo/project-1",
    });
  });

  test("validates fallback projectRoot within configured roots", async () => {
    const root = process.cwd();
    const nested = path.join(root, "src");
    const service = new SessionProjectContextResolverService(
      {
        findById: async () => undefined,
      } as unknown as ProjectRepositoryPort,
      {
        get: async () => ({ projectRoots: [root] }),
      } as unknown as SettingsRepositoryPort
    );

    await expect(
      service.resolve({
        userId: "user-1",
        projectRoot: nested,
      })
    ).resolves.toEqual({
      projectRoot: path.resolve(nested),
    });
  });

  test("rejects fallback projectRoot outside configured roots", async () => {
    const root = process.cwd();
    const outside = path.resolve(path.parse(root).root, "outside-root");
    const service = new SessionProjectContextResolverService(
      {
        findById: async () => undefined,
      } as unknown as ProjectRepositoryPort,
      {
        get: async () => ({ projectRoots: [root] }),
      } as unknown as SettingsRepositoryPort
    );

    await expect(
      service.resolve({
        userId: "user-1",
        projectRoot: outside,
      })
    ).rejects.toThrow(PROJECT_ROOT_REJECT_RE);
  });
});

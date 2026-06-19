import { describe, expect, test } from "bun:test";
import { DashboardProjectContext } from "./dashboard-project-context";

describe("DashboardProjectContext", () => {
  test("resolves by stored projectId before projectRoot fallback", () => {
    const context = new DashboardProjectContext([
      { id: "project-a", name: "Project A", path: "/repo/shared" },
      { id: "project-b", name: "Project B", path: "/repo/other" },
    ]);

    expect(
      context.resolveSessionProject({
        projectId: "project-b",
        projectRoot: "/repo/shared",
      })
    ).toMatchObject({ id: "project-b", name: "Project B" });
  });

  test("falls back to projectRoot when stored projectId is missing", () => {
    const context = new DashboardProjectContext([
      { id: "project-a", name: "Renamed Project", path: "/repo/project-a" },
    ]);

    expect(
      context.resolveSessionProject({
        projectRoot: "/repo/project-a",
      })
    ).toMatchObject({ id: "project-a", name: "Renamed Project" });
  });

  test("does not use projectRoot fallback when stored projectId is stale", () => {
    const context = new DashboardProjectContext([
      { id: "project-a", name: "Project A", path: "/repo/project-a" },
    ]);

    expect(
      context.resolveSessionProject({
        projectId: "deleted-project",
        projectRoot: "/repo/project-a",
      })
    ).toBeUndefined();
  });
});

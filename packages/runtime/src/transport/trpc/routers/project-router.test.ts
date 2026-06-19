import { describe, expect, test } from "bun:test";
import { projectRouter } from "./project";

describe("projectRouter", () => {
  test("keeps extracted query procedures on the flat project interface", () => {
    const procedures = projectRouter._def.procedures as Record<string, unknown>;

    expect(procedures.listProjects).toBeDefined();
    expect(procedures.query).toBeUndefined();
    expect(procedures.projectQuery).toBeUndefined();
  });

  test("keeps extracted mutation procedures on the flat project interface", () => {
    const procedures = projectRouter._def.procedures as Record<string, unknown>;

    expect(procedures.createProject).toBeDefined();
    expect(procedures.updateProject).toBeDefined();
    expect(procedures.deleteProject).toBeDefined();
    expect(procedures.mutation).toBeUndefined();
    expect(procedures.projectMutation).toBeUndefined();
  });

  test("keeps extracted active-state procedures on the flat project interface", () => {
    const procedures = projectRouter._def.procedures as Record<string, unknown>;

    expect(procedures.setActiveProject).toBeDefined();
    expect(procedures.active).toBeUndefined();
    expect(procedures.projectActive).toBeUndefined();
  });
});

import { describe, expect, test } from "bun:test";
import {
  parseCreateProjectRouteInput,
  parseDeleteProjectRouteInput,
} from "./project-route-input";

describe("project route input", () => {
  test("parses create payload with HTTP route defaults", () => {
    const result = parseCreateProjectRouteInput({
      name: "Workbench",
      path: "apps/workbench",
      description: "",
      tags: ["dashboard", "internal"],
      obsidianProjectPath: "Project/Workbench",
      techStackTags: ["react", "bun"],
    });

    expect(result).toEqual({
      ok: true,
      input: {
        name: "Workbench",
        path: "apps/workbench",
        description: null,
        tags: ["dashboard", "internal"],
        obsidianProjectPath: "Project/Workbench",
        techStackTags: ["react", "bun"],
        favorite: false,
      },
    });
  });

  test("defaults optional arrays and nullable fields", () => {
    const result = parseCreateProjectRouteInput({
      name: "Workbench",
      path: "apps/workbench",
    });

    expect(result).toEqual({
      ok: true,
      input: {
        name: "Workbench",
        path: "apps/workbench",
        description: null,
        tags: [],
        obsidianProjectPath: null,
        techStackTags: [],
        favorite: false,
      },
    });
  });

  test("returns existing required-field error", () => {
    const result = parseCreateProjectRouteInput({
      name: "Workbench",
    });

    expect(result).toEqual({
      ok: false,
      error: "name and path are required",
    });
  });

  test("drops malformed optional array fields to preserve route defaults", () => {
    const result = parseCreateProjectRouteInput({
      name: "Workbench",
      path: "apps/workbench",
      tags: ["ok", 123],
      techStackTags: "react,bun",
    });

    expect(result).toEqual({
      ok: true,
      input: {
        name: "Workbench",
        path: "apps/workbench",
        description: null,
        tags: [],
        obsidianProjectPath: null,
        techStackTags: [],
        favorite: false,
      },
    });
  });

  test("parses delete form payload", () => {
    const result = parseDeleteProjectRouteInput({ projectId: "project-1" });

    expect(result).toEqual({
      ok: true,
      input: { projectId: "project-1" },
    });
  });

  test("returns existing delete project id error", () => {
    const result = parseDeleteProjectRouteInput({});

    expect(result).toEqual({
      ok: false,
      error: "projectId is required",
    });
  });
});

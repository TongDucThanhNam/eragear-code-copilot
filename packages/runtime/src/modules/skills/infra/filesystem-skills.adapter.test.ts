import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ProjectRepositoryPort } from "#runtime/modules/project";
import { ConflictError, ValidationError } from "#runtime/shared/errors";
import type { Project } from "#runtime/shared/types/project.types";
import { FilesystemSkillsAdapter } from "./filesystem-skills.adapter";

const userId = "skills-user";
let testRoot = "";
let homePath = "";
let projectPath = "";
let project: Project;

beforeEach(async () => {
  testRoot = await mkdtemp(path.join(os.tmpdir(), "eragear-skills-"));
  homePath = path.join(testRoot, "home");
  projectPath = path.join(testRoot, "project");
  await mkdir(homePath, { recursive: true });
  await mkdir(projectPath, { recursive: true });
  project = {
    id: "project-1",
    userId,
    name: "Project",
    path: projectPath,
    description: null,
    tags: [],
    obsidianProjectPath: null,
    techStackTags: [],
    favorite: false,
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: null,
  };
});

afterEach(async () => {
  if (testRoot) {
    await rm(testRoot, { recursive: true, force: true });
  }
});

describe("FilesystemSkillsAdapter", () => {
  test("treats ~/AGENTS/skills as a dormant catalog when no project is selected", async () => {
    const adapter = createAdapter({ activeProjectId: null, projects: [] });

    const snapshot = await adapter.listSkills(userId);

    expect(snapshot.libraryPath).toBe(path.join(homePath, "AGENTS", "skills"));
    expect(snapshot.libraryExists).toBe(false);
    expect(snapshot.projectId).toBeNull();
    expect(snapshot.skills).toEqual([]);
  });

  test("copies a catalog skill into the active project and removes only the managed copy", async () => {
    const source = await writeGlobalSkill("reviewer");
    await mkdir(path.join(source, "references"), { recursive: true });
    await writeFile(
      path.join(source, "references", "rules.md"),
      "Project review rules.\n",
      "utf8"
    );
    const adapter = createAdapter();
    const initial = await adapter.listSkills(userId, {
      projectId: project.id,
    });
    const skill = initial.skills[0];
    expect(skill?.status).toBe("available");
    expect(skill?.name).toBe("Reviewer Skill");

    const installed = await adapter.addSkillToProject(userId, {
      projectId: project.id,
      skillId: skill?.id ?? "",
    });
    const installedSkill = installed.skills[0];
    const target = path.join(projectPath, ".agents", "skills", "reviewer");
    expect(installedSkill?.status).toBe("installed");
    expect(installedSkill?.installedPath).toBe(target);
    expect(existsSync(path.join(target, "SKILL.md"))).toBe(true);
    expect(existsSync(path.join(target, "references", "rules.md"))).toBe(true);
    expect(existsSync(path.join(source, "SKILL.md"))).toBe(true);

    const removed = await adapter.removeSkillFromProject(userId, {
      projectId: project.id,
      skillId: skill?.id ?? "",
    });
    expect(removed.skills[0]?.status).toBe("available");
    expect(existsSync(target)).toBe(false);
    expect(existsSync(path.join(source, "SKILL.md"))).toBe(true);
  });

  test("refuses to overwrite an unmanaged project skill with the same folder name", async () => {
    await writeGlobalSkill("reviewer");
    const target = path.join(projectPath, ".agents", "skills", "reviewer");
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, "LOCAL.md"), "keep me\n", "utf8");
    const adapter = createAdapter();
    const snapshot = await adapter.listSkills(userId, {
      projectId: project.id,
    });
    const skill = snapshot.skills[0];
    expect(skill?.status).toBe("conflict");

    await expect(
      adapter.addSkillToProject(userId, {
        projectId: project.id,
        skillId: skill?.id ?? "",
      })
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await readFile(path.join(target, "LOCAL.md"), "utf8")).toBe(
      "keep me\n"
    );
  });

  test("fails closed when a managed project copy has local edits", async () => {
    await writeGlobalSkill("reviewer");
    const adapter = createAdapter();
    const snapshot = await adapter.listSkills(userId, {
      projectId: project.id,
    });
    const skillId = snapshot.skills[0]?.id ?? "";
    await adapter.addSkillToProject(userId, {
      projectId: project.id,
      skillId,
    });
    const targetSkill = path.join(
      projectPath,
      ".agents",
      "skills",
      "reviewer",
      "SKILL.md"
    );
    await writeFile(targetSkill, "local project edit\n", "utf8");

    await expect(
      adapter.removeSkillFromProject(userId, {
        projectId: project.id,
        skillId,
      })
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await readFile(targetSkill, "utf8")).toBe("local project edit\n");
  });

  test("refuses unsafe project skill path components", async () => {
    await writeGlobalSkill("reviewer");
    await writeFile(path.join(projectPath, ".agents"), "not a directory\n");
    const adapter = createAdapter();
    const snapshot = await adapter.listSkills(userId, {
      projectId: project.id,
    });
    const skillId = snapshot.skills[0]?.id ?? "";
    expect(snapshot.diagnostics.join(" ")).toContain(
      "Unsafe project skills path component"
    );

    await expect(
      adapter.addSkillToProject(userId, {
        projectId: project.id,
        skillId,
      })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await readFile(path.join(projectPath, ".agents"), "utf8")).toBe(
      "not a directory\n"
    );
  });

  test("keeps orphaned managed copies removable after the global source disappears", async () => {
    const source = await writeGlobalSkill("reviewer");
    const adapter = createAdapter();
    const initial = await adapter.listSkills(userId, {
      projectId: project.id,
    });
    const skillId = initial.skills[0]?.id ?? "";
    await adapter.addSkillToProject(userId, {
      projectId: project.id,
      skillId,
    });
    await rm(source, { recursive: true, force: true });

    const orphaned = await adapter.listSkills(userId, {
      projectId: project.id,
    });
    expect(orphaned.skills[0]?.status).toBe("missing-source");

    const removed = await adapter.removeSkillFromProject(userId, {
      projectId: project.id,
      skillId,
    });
    expect(removed.skills).toEqual([]);
  });
});

function createAdapter(
  state: { projects: Project[]; activeProjectId: string | null } = {
    projects: [project],
    activeProjectId: project.id,
  }
) {
  const projectRepo: ProjectRepositoryPort = {
    findById: async (id, owner) =>
      state.projects.find((item) => item.id === id && item.userId === owner),
    findByPath: async (projectRoot) =>
      state.projects.find((item) => item.path === projectRoot),
    findAll: async (owner) =>
      state.projects.filter((item) => item.userId === owner),
    getActiveId: async () => state.activeProjectId,
    listWithActiveState: async () => state,
    create: () => Promise.reject(new Error("not used")),
    update: () => Promise.reject(new Error("not used")),
    delete: () => Promise.resolve(),
    deleteAndClearActive: () => Promise.resolve({ activeProjectId: null }),
    setActive: () => Promise.resolve(),
  };
  return new FilesystemSkillsAdapter({
    projectRepo,
    resolveHomePath: () => homePath,
  });
}

async function writeGlobalSkill(folderName: string): Promise<string> {
  const directory = path.join(homePath, "AGENTS", "skills", folderName);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "SKILL.md"),
    [
      "---",
      "name: Reviewer Skill",
      "description: Review with project standards",
      "tags: [review, quality]",
      "---",
      "# Reviewer Skill",
      "Use the project standards.",
      "",
    ].join("\n"),
    "utf8"
  );
  return directory;
}

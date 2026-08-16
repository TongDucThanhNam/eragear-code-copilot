import { describe, expect, test } from "bun:test";
import type {
  ManageProjectSkillInput,
  SkillDescriptor,
  SkillsCatalogSnapshot,
} from "./contracts/skills.contract";
import type { SkillsPort } from "./ports/skills.port";
import { SkillsService } from "./skills.service";

class SkillsPortStub implements SkillsPort {
  readonly addCalls: ManageProjectSkillInput[] = [];
  readonly removeCalls: ManageProjectSkillInput[] = [];
  private snapshot: SkillsCatalogSnapshot;

  constructor(skills: SkillDescriptor[]) {
    this.snapshot = createSnapshot(skills);
  }

  listSkills(): Promise<SkillsCatalogSnapshot> {
    return Promise.resolve(this.snapshot);
  }

  addSkillToProject(
    _userId: string,
    input: ManageProjectSkillInput
  ): Promise<SkillsCatalogSnapshot> {
    this.addCalls.push(input);
    this.snapshot = {
      ...this.snapshot,
      skills: this.snapshot.skills.map((skill) =>
        skill.id === input.skillId
          ? { ...skill, status: "installed" as const }
          : skill
      ),
    };
    return Promise.resolve(this.snapshot);
  }

  removeSkillFromProject(
    _userId: string,
    input: ManageProjectSkillInput
  ): Promise<SkillsCatalogSnapshot> {
    this.removeCalls.push(input);
    this.snapshot = {
      ...this.snapshot,
      skills: this.snapshot.skills.map((skill) =>
        skill.id === input.skillId
          ? { ...skill, status: "available" as const }
          : skill
      ),
    };
    return Promise.resolve(this.snapshot);
  }
}

function createSkill(
  overrides: Partial<SkillDescriptor> = {}
): SkillDescriptor {
  return {
    id: "global-skill.1",
    folderName: "reviewer",
    name: "Reviewer",
    sourcePath: "/home/user/AGENTS/skills/reviewer/SKILL.md",
    status: "available",
    tags: ["global-library"],
    diagnostics: [],
    ...overrides,
  };
}

function createSnapshot(skills: SkillDescriptor[]): SkillsCatalogSnapshot {
  return {
    libraryPath: "/home/user/AGENTS/skills",
    libraryExists: true,
    projectId: "project-1",
    projectPath: "/repo",
    skills,
    diagnostics: [],
  };
}

describe("SkillsService", () => {
  test("lists catalog skills with project installation counts", async () => {
    const service = new SkillsService(
      new SkillsPortStub([
        createSkill(),
        createSkill({ id: "global-skill.2", status: "installed" }),
        createSkill({ id: "global-skill.3", status: "missing-source" }),
      ])
    );

    const result = await service.list("user-1");

    expect(result.totalCount).toBe(3);
    expect(result.installedCount).toBe(2);
    expect(result.libraryPath).toBe("/home/user/AGENTS/skills");
  });

  test("adds and removes a global skill through the project port", async () => {
    const port = new SkillsPortStub([createSkill()]);
    const service = new SkillsService(port);
    const input = { projectId: "project-1", skillId: "global-skill.1" };

    const installed = await service.addToProject("user-1", input);
    const removed = await service.removeFromProject("user-1", input);

    expect(port.addCalls).toEqual([input]);
    expect(port.removeCalls).toEqual([input]);
    expect(installed.installedCount).toBe(1);
    expect(removed.installedCount).toBe(0);
  });
});

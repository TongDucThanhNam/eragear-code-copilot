import { describe, expect, test } from "bun:test";
import type { SkillDescriptor } from "./contracts/skills.contract";
import type { SkillsPort } from "./ports/skills.port";
import { SkillsService } from "./skills.service";

class SkillsPortStub implements SkillsPort {
  readonly setEnabledCalls: Array<{ skillId: string; enabled: boolean }> = [];
  private skills: SkillDescriptor[];

  constructor(skills: SkillDescriptor[]) {
    this.skills = skills;
  }

  listSkills(): Promise<SkillDescriptor[]> {
    return Promise.resolve(this.skills);
  }

  setSkillEnabled(
    _userId: string,
    input: { skillId: string; enabled: boolean }
  ): Promise<SkillDescriptor[]> {
    this.setEnabledCalls.push({
      skillId: input.skillId,
      enabled: input.enabled,
    });
    this.skills = this.skills.map((skill) =>
      skill.id === input.skillId ? { ...skill, enabled: input.enabled } : skill
    );
    return Promise.resolve(this.skills);
  }
}

function createSkill(
  overrides: Partial<SkillDescriptor> = {}
): SkillDescriptor {
  return {
    id: "skill.project.1",
    name: "Reviewer",
    scope: "project",
    enabled: true,
    sourcePath: "/repo/.eragear/skills/reviewer/SKILL.md",
    prompt: "Review with project standards.",
    tags: ["project"],
    diagnostics: [],
    ...overrides,
  };
}

describe("SkillsService", () => {
  test("lists skills with enabled counts", async () => {
    const service = new SkillsService(
      new SkillsPortStub([
        createSkill(),
        createSkill({ id: "skill.project.2", enabled: false }),
      ])
    );

    const result = await service.list("user-1");

    expect(result.totalCount).toBe(2);
    expect(result.enabledCount).toBe(1);
    expect(result.skills.map((skill) => skill.id)).toEqual([
      "skill.project.1",
      "skill.project.2",
    ]);
  });

  test("toggles skill enabled state through the port", async () => {
    const port = new SkillsPortStub([createSkill()]);
    const service = new SkillsService(port);

    const result = await service.setEnabled("user-1", {
      skillId: "skill.project.1",
      enabled: false,
    });

    expect(port.setEnabledCalls).toEqual([
      { skillId: "skill.project.1", enabled: false },
    ]);
    expect(result.skills[0]?.enabled).toBe(false);
    expect(result.enabledCount).toBe(0);
  });
});

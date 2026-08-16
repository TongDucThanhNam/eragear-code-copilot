import type {
  ManageProjectSkillInput,
  SkillsCatalogSnapshot,
  SkillsListResult,
  SkillsProjectInput,
} from "./contracts/skills.contract";
import type { SkillsPort } from "./ports/skills.port";

export class SkillsService {
  private readonly skills: SkillsPort;

  constructor(skills: SkillsPort) {
    this.skills = skills;
  }

  async list(
    userId: string,
    input?: SkillsProjectInput
  ): Promise<SkillsListResult> {
    return toResult(await this.skills.listSkills(userId, input));
  }

  async addToProject(
    userId: string,
    input: ManageProjectSkillInput
  ): Promise<SkillsListResult> {
    return toResult(await this.skills.addSkillToProject(userId, input));
  }

  async removeFromProject(
    userId: string,
    input: ManageProjectSkillInput
  ): Promise<SkillsListResult> {
    return toResult(await this.skills.removeSkillFromProject(userId, input));
  }
}

function toResult(snapshot: SkillsCatalogSnapshot): SkillsListResult {
  return {
    ...snapshot,
    installedCount: snapshot.skills.filter(
      (skill) =>
        skill.status === "installed" || skill.status === "missing-source"
    ).length,
    totalCount: snapshot.skills.length,
  };
}

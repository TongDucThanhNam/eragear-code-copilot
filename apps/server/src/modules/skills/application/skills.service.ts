import type {
  SetSkillEnabledInput,
  SkillDescriptor,
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

  async setEnabled(
    userId: string,
    input: SetSkillEnabledInput
  ): Promise<SkillsListResult> {
    return toResult(await this.skills.setSkillEnabled(userId, input));
  }
}

function toResult(skills: SkillDescriptor[]): SkillsListResult {
  return {
    skills,
    enabledCount: skills.filter((skill) => skill.enabled).length,
    totalCount: skills.length,
  };
}

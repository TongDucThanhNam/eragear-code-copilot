import type {
  SetSkillEnabledInput,
  SkillDescriptor,
  SkillsProjectInput,
} from "../contracts/skills.contract";

export interface SkillsPort {
  listSkills(
    userId: string,
    input?: SkillsProjectInput
  ): Promise<SkillDescriptor[]>;
  setSkillEnabled(
    userId: string,
    input: SetSkillEnabledInput
  ): Promise<SkillDescriptor[]>;
}

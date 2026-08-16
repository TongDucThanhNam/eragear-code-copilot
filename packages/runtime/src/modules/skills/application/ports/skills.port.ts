import type {
  ManageProjectSkillInput,
  SkillsCatalogSnapshot,
  SkillsProjectInput,
} from "../contracts/skills.contract";

export interface SkillsPort {
  listSkills(
    userId: string,
    input?: SkillsProjectInput
  ): Promise<SkillsCatalogSnapshot>;
  addSkillToProject(
    userId: string,
    input: ManageProjectSkillInput
  ): Promise<SkillsCatalogSnapshot>;
  removeSkillFromProject(
    userId: string,
    input: ManageProjectSkillInput
  ): Promise<SkillsCatalogSnapshot>;
}

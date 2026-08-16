import { SkillsService } from "#runtime/modules/skills";
import { FilesystemSkillsAdapter } from "#runtime/modules/skills/di";
import type { SkillsUseCases } from "#runtime/modules/use-cases";
import type { ServiceRegistrySlice } from "./dependencies";

type SkillsServiceDependencies = ServiceRegistrySlice<"projectRepo">;

export function createSkillsUseCases(
  deps: SkillsServiceDependencies
): SkillsUseCases {
  return {
    skills: new SkillsService(
      new FilesystemSkillsAdapter({ projectRepo: deps.projectRepo })
    ),
  };
}

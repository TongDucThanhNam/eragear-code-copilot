import { SkillsService } from "#runtime/modules/skills";
import {
  LocalAdeSkillsAdapter,
  type LocalAdeSkillsSource,
} from "#runtime/modules/skills/di";
import type { SkillsUseCases } from "#runtime/modules/use-cases";

export function createSkillsUseCases(
  localAde: LocalAdeSkillsSource
): SkillsUseCases {
  return {
    skills: new SkillsService(new LocalAdeSkillsAdapter(localAde)),
  };
}

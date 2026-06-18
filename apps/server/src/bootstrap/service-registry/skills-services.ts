import { SkillsService } from "@/modules/skills";
import {
  LocalAdeSkillsAdapter,
  type LocalAdeSkillsSource,
} from "@/modules/skills/di";
import type { SkillsUseCases } from "@/modules/use-cases";

export function createSkillsUseCases(
  localAde: LocalAdeSkillsSource
): SkillsUseCases {
  return {
    skills: new SkillsService(new LocalAdeSkillsAdapter(localAde)),
  };
}

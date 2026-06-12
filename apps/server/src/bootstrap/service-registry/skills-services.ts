import type { LocalAdeService } from "@/modules/settings";
import {
  type SetSkillEnabledInput,
  type SkillDescriptor,
  type SkillsPort,
  type SkillsProjectInput,
  SkillsService,
} from "@/modules/skills";
import type { SkillsUseCases, UseCasePort } from "@/modules/use-cases";

class LocalAdeSkillsAdapter implements SkillsPort {
  private readonly localAde: UseCasePort<LocalAdeService>;

  constructor(localAde: UseCasePort<LocalAdeService>) {
    this.localAde = localAde;
  }

  async listSkills(
    userId: string,
    _input?: SkillsProjectInput
  ): Promise<SkillDescriptor[]> {
    const snapshot = await this.localAde.snapshot(userId);
    return snapshot.skills;
  }

  async setSkillEnabled(
    userId: string,
    input: SetSkillEnabledInput
  ): Promise<SkillDescriptor[]> {
    const snapshot = await this.localAde.updateCapabilityState(userId, {
      ...(input.projectId ? { projectId: input.projectId } : {}),
      capabilityId: input.skillId,
      enabled: input.enabled,
    });
    return snapshot.skills;
  }
}

export function createSkillsUseCases(
  localAde: UseCasePort<LocalAdeService>
): SkillsUseCases {
  return {
    skills: new SkillsService(new LocalAdeSkillsAdapter(localAde)),
  };
}

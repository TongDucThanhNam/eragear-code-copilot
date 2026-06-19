import type {
  SetSkillEnabledInput,
  SkillDescriptor,
  SkillsProjectInput,
} from "../application/contracts/skills.contract";
import type { SkillsPort } from "../application/ports/skills.port";

interface LocalAdeSkillsSnapshot {
  skills: SkillDescriptor[];
}

export interface LocalAdeSkillsSource {
  snapshot(userId: string): Promise<LocalAdeSkillsSnapshot>;
  updateCapabilityState(
    userId: string,
    input: {
      projectId?: string;
      capabilityId: string;
      enabled: boolean;
    }
  ): Promise<LocalAdeSkillsSnapshot>;
}

export class LocalAdeSkillsAdapter implements SkillsPort {
  private readonly localAde: LocalAdeSkillsSource;

  constructor(localAde: LocalAdeSkillsSource) {
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

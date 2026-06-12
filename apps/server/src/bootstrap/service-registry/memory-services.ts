import {
  type BuildMemoryContextInput,
  type DeleteMemoryPresetInput,
  type MemoryContextResult,
  type MemoryData,
  type MemoryPort,
  type MemoryProjectInput,
  MemoryService,
  type SetMemorySourceEnabledInput,
  type UpsertMemoryPresetInput,
} from "@/modules/memory";
import type { LocalAdeService } from "@/modules/settings";
import type { MemoryUseCases, UseCasePort } from "@/modules/use-cases";

type LocalAdeSnapshot = Awaited<ReturnType<LocalAdeService["snapshot"]>>;

class LocalAdeMemoryAdapter implements MemoryPort {
  private readonly localAde: UseCasePort<LocalAdeService>;

  constructor(localAde: UseCasePort<LocalAdeService>) {
    this.localAde = localAde;
  }

  async listMemory(
    userId: string,
    _input?: MemoryProjectInput
  ): Promise<MemoryData> {
    return toMemoryData(await this.localAde.snapshot(userId));
  }

  async setSourceEnabled(
    userId: string,
    input: SetMemorySourceEnabledInput
  ): Promise<MemoryData> {
    const snapshot = await this.localAde.updateCapabilityState(userId, {
      ...(input.projectId ? { projectId: input.projectId } : {}),
      capabilityId: input.sourceId,
      enabled: input.enabled,
    });
    return toMemoryData(snapshot);
  }

  async upsertPreset(
    userId: string,
    input: UpsertMemoryPresetInput
  ): Promise<MemoryData> {
    return toMemoryData(
      await this.localAde.upsertProjectMemoryPreset(userId, input)
    );
  }

  async deletePreset(
    userId: string,
    input: DeleteMemoryPresetInput
  ): Promise<MemoryData> {
    return toMemoryData(
      await this.localAde.deleteProjectMemoryPreset(userId, input)
    );
  }

  async buildContext(
    userId: string,
    input: BuildMemoryContextInput
  ): Promise<MemoryContextResult> {
    return await this.localAde.buildProjectMemoryContext(userId, input);
  }
}

function toMemoryData(snapshot: LocalAdeSnapshot): MemoryData {
  return {
    sources: snapshot.projectMemory.sources,
    presets: snapshot.projectMemory.presets,
    warnings: snapshot.projectMemory.warnings,
  };
}

export function createMemoryUseCases(
  localAde: UseCasePort<LocalAdeService>
): MemoryUseCases {
  return {
    memory: new MemoryService(new LocalAdeMemoryAdapter(localAde)),
  };
}

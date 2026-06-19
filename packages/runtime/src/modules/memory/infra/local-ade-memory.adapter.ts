import type {
  BuildMemoryContextInput,
  DeleteMemoryPresetInput,
  MemoryContextResult,
  MemoryData,
  MemoryProjectInput,
  SetMemorySourceEnabledInput,
  UpsertMemoryPresetInput,
} from "../application/contracts/memory.contract";
import type { MemoryPort } from "../application/ports/memory.port";

interface LocalAdeMemorySnapshot {
  projectMemory: MemoryData;
}

export interface LocalAdeMemorySource {
  snapshot(userId: string): Promise<LocalAdeMemorySnapshot>;
  updateCapabilityState(
    userId: string,
    input: {
      projectId?: string;
      capabilityId: string;
      enabled: boolean;
    }
  ): Promise<LocalAdeMemorySnapshot>;
  upsertProjectMemoryPreset(
    userId: string,
    input: UpsertMemoryPresetInput
  ): Promise<LocalAdeMemorySnapshot>;
  deleteProjectMemoryPreset(
    userId: string,
    input: DeleteMemoryPresetInput
  ): Promise<LocalAdeMemorySnapshot>;
  buildProjectMemoryContext(
    userId: string,
    input: BuildMemoryContextInput
  ): Promise<MemoryContextResult>;
}

export class LocalAdeMemoryAdapter implements MemoryPort {
  private readonly localAde: LocalAdeMemorySource;

  constructor(localAde: LocalAdeMemorySource) {
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

function toMemoryData(snapshot: LocalAdeMemorySnapshot): MemoryData {
  return {
    sources: snapshot.projectMemory.sources,
    presets: snapshot.projectMemory.presets,
    warnings: snapshot.projectMemory.warnings,
  };
}

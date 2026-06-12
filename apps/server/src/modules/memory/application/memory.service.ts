import type {
  BuildMemoryContextInput,
  DeleteMemoryPresetInput,
  MemoryContextResult,
  MemoryData,
  MemoryListResult,
  MemoryProjectInput,
  SetMemorySourceEnabledInput,
  UpsertMemoryPresetInput,
} from "./contracts/memory.contract";
import type { MemoryPort } from "./ports/memory.port";

export class MemoryService {
  private readonly memory: MemoryPort;

  constructor(memory: MemoryPort) {
    this.memory = memory;
  }

  async list(
    userId: string,
    input?: MemoryProjectInput
  ): Promise<MemoryListResult> {
    return toResult(await this.memory.listMemory(userId, input));
  }

  async setSourceEnabled(
    userId: string,
    input: SetMemorySourceEnabledInput
  ): Promise<MemoryListResult> {
    return toResult(await this.memory.setSourceEnabled(userId, input));
  }

  async upsertPreset(
    userId: string,
    input: UpsertMemoryPresetInput
  ): Promise<MemoryListResult> {
    return toResult(await this.memory.upsertPreset(userId, input));
  }

  async deletePreset(
    userId: string,
    input: DeleteMemoryPresetInput
  ): Promise<MemoryListResult> {
    return toResult(await this.memory.deletePreset(userId, input));
  }

  async buildContext(
    userId: string,
    input: BuildMemoryContextInput
  ): Promise<MemoryContextResult> {
    return await this.memory.buildContext(userId, input);
  }
}

function toResult(data: MemoryData): MemoryListResult {
  return {
    ...data,
    enabledCount: data.sources.filter((source) => source.enabled).length,
    totalCount: data.sources.length,
  };
}

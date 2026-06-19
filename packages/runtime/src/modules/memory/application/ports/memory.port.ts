import type {
  BuildMemoryContextInput,
  DeleteMemoryPresetInput,
  MemoryContextResult,
  MemoryData,
  MemoryProjectInput,
  SetMemorySourceEnabledInput,
  UpsertMemoryPresetInput,
} from "../contracts/memory.contract";

export interface MemoryPort {
  listMemory(userId: string, input?: MemoryProjectInput): Promise<MemoryData>;
  setSourceEnabled(
    userId: string,
    input: SetMemorySourceEnabledInput
  ): Promise<MemoryData>;
  upsertPreset(
    userId: string,
    input: UpsertMemoryPresetInput
  ): Promise<MemoryData>;
  deletePreset(
    userId: string,
    input: DeleteMemoryPresetInput
  ): Promise<MemoryData>;
  buildContext(
    userId: string,
    input: BuildMemoryContextInput
  ): Promise<MemoryContextResult>;
}

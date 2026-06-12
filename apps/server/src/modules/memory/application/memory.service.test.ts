import { describe, expect, test } from "bun:test";
import type {
  BuildMemoryContextInput,
  DeleteMemoryPresetInput,
  MemoryContextResult,
  MemoryData,
  MemoryProjectInput,
  MemorySource,
  SetMemorySourceEnabledInput,
  UpsertMemoryPresetInput,
} from "./contracts/memory.contract";
import { MemoryService } from "./memory.service";
import type { MemoryPort } from "./ports/memory.port";

class MemoryPortStub implements MemoryPort {
  readonly setSourceCalls: SetMemorySourceEnabledInput[] = [];
  private data: MemoryData;

  constructor(data: MemoryData) {
    this.data = data;
  }

  listMemory(
    _userId: string,
    _input?: MemoryProjectInput
  ): Promise<MemoryData> {
    return Promise.resolve(this.data);
  }

  setSourceEnabled(
    _userId: string,
    input: SetMemorySourceEnabledInput
  ): Promise<MemoryData> {
    this.setSourceCalls.push(input);
    this.data = {
      ...this.data,
      sources: this.data.sources.map((source) =>
        source.id === input.sourceId
          ? { ...source, enabled: input.enabled }
          : source
      ),
    };
    return Promise.resolve(this.data);
  }

  upsertPreset(
    _userId: string,
    _input: UpsertMemoryPresetInput
  ): Promise<MemoryData> {
    return Promise.resolve(this.data);
  }

  deletePreset(
    _userId: string,
    _input: DeleteMemoryPresetInput
  ): Promise<MemoryData> {
    return Promise.resolve(this.data);
  }

  buildContext(
    _userId: string,
    input: BuildMemoryContextInput
  ): Promise<MemoryContextResult> {
    return Promise.resolve({
      status: "ready",
      query: input.query ?? "",
      retrievalMode: input.retrievalMode ?? "full",
      sources: [],
      chunks: [],
      prompt: "Project memory context",
      diagnostics: [],
    });
  }
}

function createSource(overrides: Partial<MemorySource> = {}): MemorySource {
  return {
    id: "memory.project.1",
    label: "AGENTS.md",
    sourcePath: "/repo/AGENTS.md",
    relativePath: "AGENTS.md",
    exists: true,
    enabled: true,
    byteLength: 120,
    preview: "Architecture notes",
    warnings: [],
    ...overrides,
  };
}

function createData(sources: MemorySource[]): MemoryData {
  return {
    sources,
    presets: [],
    warnings: [],
  };
}

describe("MemoryService", () => {
  test("lists memory sources with enabled counts", async () => {
    const service = new MemoryService(
      new MemoryPortStub(
        createData([
          createSource(),
          createSource({ id: "memory.project.2", enabled: false }),
        ])
      )
    );

    const result = await service.list("user-1");

    expect(result.totalCount).toBe(2);
    expect(result.enabledCount).toBe(1);
  });

  test("toggles memory source state through the port", async () => {
    const port = new MemoryPortStub(createData([createSource()]));
    const service = new MemoryService(port);

    const result = await service.setSourceEnabled("user-1", {
      sourceId: "memory.project.1",
      enabled: false,
    });

    expect(port.setSourceCalls).toEqual([
      { sourceId: "memory.project.1", enabled: false },
    ]);
    expect(result.enabledCount).toBe(0);
    expect(result.sources[0]?.enabled).toBe(false);
  });
});

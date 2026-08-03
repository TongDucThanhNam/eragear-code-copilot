import { describe, expect, test } from "bun:test";
import type {
  RefreshRepoSnapshotIndexInput,
  RepoSnapshotIndexData,
  RepoSnapshotIndexingProjectInput,
  RepoSnapshotIndexSearchResult,
  SearchRepoSnapshotIndexInput,
} from "#runtime/modules/repo-snapshot-indexing";
import type { RepoSnapshotIndexPort } from "#runtime/modules/repo-snapshot-indexing/application/ports/repo-snapshot-index.port";
import { extractRepoIndexSymbolFromLine } from "#runtime/modules/repo-snapshot-indexing/application/repo-index-symbol-extraction";
import { ScopeResolverService } from "./scope-resolver.service";

class RepoSnapshotIndexStub implements RepoSnapshotIndexPort {
  private readonly data: RepoSnapshotIndexData;

  constructor(data: RepoSnapshotIndexData) {
    this.data = data;
  }

  getIndexSnapshot(
    _userId: string,
    _input?: RepoSnapshotIndexingProjectInput
  ): Promise<RepoSnapshotIndexData> {
    return Promise.resolve(this.data);
  }

  refreshIndex(
    _userId: string,
    _input?: RefreshRepoSnapshotIndexInput
  ): Promise<RepoSnapshotIndexData> {
    return Promise.resolve(this.data);
  }

  searchIndex(
    _userId: string,
    input: SearchRepoSnapshotIndexInput
  ): Promise<RepoSnapshotIndexSearchResult> {
    return Promise.resolve({
      status: "ready",
      query: input.query,
      results: [],
      prompt: "",
      diagnostics: [],
    });
  }
}

function createIndexData(): RepoSnapshotIndexData {
  return {
    projectRoot: "/repo",
    index: {
      storagePath: "/repo/.eragear/repo-index.json",
      indexedAt: "2026-06-20T00:00:00.000Z",
      indexedFiles: 4,
      totalBytes: 1024,
      semantic: {
        status: "ready",
        profiledFiles: 4,
        tokenCount: 12,
        source: "local-token-profile",
      },
      extensions: [{ extension: ".tsx", count: 2 }],
      files: [
        {
          path: "apps/desktop/src/routes/home.tsx",
          sizeBytes: 100,
          extension: ".tsx",
          modifiedAt: "2026-06-20T00:00:00.000Z",
          language: "typescript",
          semanticTags: ["desktop", "route", "home", "settings"],
        },
        {
          path: "apps/native/app/home.tsx",
          sizeBytes: 100,
          extension: ".tsx",
          modifiedAt: "2026-06-10T00:00:00.000Z",
          language: "typescript",
          semanticTags: ["native", "route", "home"],
        },
        {
          path: "packages/runtime/src/modules/supervisor/index.ts",
          sizeBytes: 100,
          extension: ".ts",
          modifiedAt: "2026-06-19T00:00:00.000Z",
          language: "typescript",
          semanticTags: ["supervisor", "runtime", "goal"],
        },
        {
          path: "packages/runtime/src/modules/scope-resolution/large.ts",
          sizeBytes: 200_000,
          extension: ".ts",
          modifiedAt: "2026-06-01T00:00:00.000Z",
          language: "typescript",
        },
      ],
      symbols: [
        {
          path: "apps/desktop/src/routes/home.tsx",
          name: "HomePage",
          kind: "component",
          line: 10,
          language: "typescript",
        },
        {
          path: "apps/native/app/home.tsx",
          name: "HomePage",
          kind: "component",
          line: 8,
          language: "typescript",
        },
        {
          path: "packages/runtime/src/modules/supervisor/index.ts",
          name: "SupervisorLoopService",
          kind: "class",
          line: 1,
          language: "typescript",
        },
      ],
      tasks: [
        {
          path: "packages/runtime/src/modules/supervisor/index.ts",
          marker: "TODO",
          line: 12,
          text: "TODO wire guarded goal mode gate",
        },
      ],
      diagnostics: [
        "signalScanSkippedBySize: packages/runtime/src/modules/scope-resolution/large.ts exceeded 128000 bytes.",
      ],
    },
  };
}

describe("ScopeResolverService v0", () => {
  test("resolves deterministic targets from path, symbol, task, semantic, and mtime signals", async () => {
    const service = new ScopeResolverService({
      index: new RepoSnapshotIndexStub(createIndexData()),
    });

    const result = await service.resolve("user-1", {
      intent: "update desktop HomePage route settings",
      activePathHints: ["apps/desktop"],
    });

    expect(result.resolverVersion).toBe("v0-no-graph");
    expect(result.resolvedViaLLM).toBe(false);
    expect(result.primaryTarget.path).toBe("apps/desktop/src/routes/home.tsx");
    expect(result.primaryTarget.reason).toContain("symbol match");
    expect(result.primaryTarget.reason).toContain("active workspace hint");
    expect(result.diagnostics).toMatchObject({
      signalScanSkippedBySize: 1,
      symbolExtractionMode: "regex",
      indexedFiles: 4,
    });
  });

  test("keeps signal scan size skips as diagnostics without hiding indexed files", async () => {
    const service = new ScopeResolverService({
      index: new RepoSnapshotIndexStub(createIndexData()),
    });

    const result = await service.resolve("user-1", {
      intent: "scope resolution large module",
    });

    expect(result.diagnostics.signalScanSkippedBySize).toBe(1);
    expect(result.diagnostics.indexedFiles).toBe(4);
    expect(result.primaryTarget.path).toBe(
      "packages/runtime/src/modules/scope-resolution/large.ts"
    );
  });

  test("covers typed TSX component declarations used by Project Index", () => {
    const symbol = extractRepoIndexSymbolFromLine({
      line: "export const HomePage: FC<Props> = () => null",
      extension: ".tsx",
    });

    expect(symbol).toEqual({ kind: "component", name: "HomePage" });
  });

  test("allows MiniMax disambiguation only among deterministic top-K candidates", async () => {
    const seenCandidates: string[][] = [];
    const service = new ScopeResolverService({
      index: new RepoSnapshotIndexStub(createIndexData()),
      disambiguator: {
        chooseTarget(input) {
          seenCandidates.push(
            input.candidates.map((candidate) => candidate.path)
          );
          return Promise.resolve(
            input.candidates.find((candidate) =>
              candidate.path.startsWith("apps/native/")
            ) ?? null
          );
        },
      },
    });

    const result = await service.resolve("user-1", {
      intent: "HomePage route",
    });

    expect(result.resolvedViaLLM).toBe(true);
    expect(result.primaryTarget.path).toBe("apps/native/app/home.tsx");
    expect(seenCandidates).toHaveLength(1);
    expect(seenCandidates[0]?.length).toBeLessThanOrEqual(5);
    expect(seenCandidates[0]).toContain("apps/desktop/src/routes/home.tsx");
    expect(seenCandidates[0]).toContain("apps/native/app/home.tsx");
  });
});

import { describe, expect, test } from "bun:test";
import type {
  RefreshRepoSnapshotIndexInput,
  RepoSnapshotIndexData,
  RepoSnapshotIndexingProjectInput,
  RepoSnapshotIndexSearchResult,
  SearchRepoSnapshotIndexInput,
} from "#runtime/modules/repo-snapshot-indexing";
import type { RepoSnapshotIndexPort } from "#runtime/modules/repo-snapshot-indexing/application/ports/repo-snapshot-index.port";
import {
  buildScopeImportGraphIndexFromSources,
  ScopeImportGraphService,
} from "./import-graph.index";
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

const SOURCES: Record<string, string> = {
  "apps/desktop/src/routes/home.tsx": `
    import { HomePage } from "../components/HomePage";
    export function DesktopHomeRoute() {
      return <HomePage />;
    }
  `,
  "apps/desktop/src/components/HomePage.tsx": `
    export const HomePage: React.FC = () => <main>Desktop</main>;
  `,
  "apps/native/app/home.tsx": `
    import { HomePage } from "../components/HomePage";
    export default function NativeHomeRoute() {
      return <HomePage />;
    }
  `,
  "apps/native/components/HomePage.tsx": `
    export const HomePage = () => null;
  `,
};

function createIndexData(): RepoSnapshotIndexData {
  const files = Object.keys(SOURCES).map((filePath) => ({
    path: filePath,
    sizeBytes: SOURCES[filePath]?.length ?? 0,
    extension: ".tsx",
    modifiedAt: "2026-06-20T00:00:00.000Z",
    language: "typescript",
  }));
  return {
    projectRoot: "/repo",
    index: {
      storagePath: "/repo/.eragear/repo-index.json",
      indexedAt: "2026-06-20T00:00:00.000Z",
      indexedFiles: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
      semantic: {
        status: "ready",
        profiledFiles: files.length,
        tokenCount: 0,
        source: "local-token-profile",
      },
      extensions: [{ extension: ".tsx", count: files.length }],
      files,
      symbols: [],
      tasks: [],
      diagnostics: [],
    },
  };
}

function createResolver() {
  const data = createIndexData();
  return new ScopeResolverService({
    index: new RepoSnapshotIndexStub(data),
    importGraph: new ScopeImportGraphService({
      now: () => "2026-06-20T00:00:00.000Z",
      readSource: async ({ file }) => SOURCES[file.path] ?? null,
    }),
  });
}

describe("ScopeResolverService v1 import graph", () => {
  test("builds AST symbols, importGraph edges, reachability, and routeMap entries", async () => {
    const data = createIndexData();
    const graph = await buildScopeImportGraphIndexFromSources({
      projectRoot: data.projectRoot,
      files: data.index.files,
      sources: SOURCES,
      now: () => "2026-06-20T00:00:00.000Z",
    });

    const desktopRoute = graph.nodes.find(
      (node) => node.path === "apps/desktop/src/routes/home.tsx"
    );
    const desktopComponent = graph.nodes.find(
      (node) => node.path === "apps/desktop/src/components/HomePage.tsx"
    );

    expect(graph.importGraph).toBe(true);
    expect(desktopRoute?.imports).toEqual([
      "apps/desktop/src/components/HomePage.tsx",
    ]);
    expect(desktopComponent?.importedBy).toEqual([
      "apps/desktop/src/routes/home.tsx",
    ]);
    expect(desktopComponent?.reachableFromRoots).toBe(true);
    expect(desktopComponent?.symbols).toContainEqual({
      name: "HomePage",
      kind: "component",
      line: 2,
    });
    expect(graph.routeMap).toContainEqual({
      path: "apps/desktop/src/routes/home.tsx",
      routeKey: "home",
      workspace: "apps/desktop",
      exportedSymbols: ["DesktopHomeRoute"],
    });
  });

  test("emits v1-import-graph and distinguishes same-name desktop route from native route", async () => {
    const resolver = createResolver();

    const result = await resolver.resolve("user-1", {
      intent: "edit desktop home route file",
      activePathHints: ["apps/desktop/src/routes"],
    });

    expect(result.resolverVersion).toBe("v1-import-graph");
    expect(result.diagnostics.symbolExtractionMode).toBe("ast");
    expect(result.diagnostics.graphConfidence).toBeGreaterThan(0);
    expect(result.primaryTarget.path).toBe("apps/desktop/src/routes/home.tsx");
    expect(result.primaryTarget.reason).toContain("routeMap match");
  });

  test("distinguishes same-name native component from desktop component", async () => {
    const resolver = createResolver();

    const result = await resolver.resolve("user-1", {
      intent: "update native HomePage component",
      activePathHints: ["apps/native/components"],
    });

    expect(result.resolverVersion).toBe("v1-import-graph");
    expect(result.primaryTarget.path).toBe(
      "apps/native/components/HomePage.tsx"
    );
    expect(result.primaryTarget.reason).toContain(
      "importGraph AST symbol match"
    );
  });
});

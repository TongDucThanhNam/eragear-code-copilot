import { describe, expect, test } from "bun:test";
import path from "node:path";
import type { RepoSnapshotIndexData } from "#runtime/modules/repo-snapshot-indexing";
import type { RepoSnapshotIndexPort } from "#runtime/modules/repo-snapshot-indexing/application/ports/repo-snapshot-index.port";
import {
  ScopeImportGraphService,
  ScopeResolverService,
} from "#runtime/modules/scope-resolution";
import { ScopeSupervisorProjectIntelligenceAdapter } from "./scope-supervisor-project-intelligence.adapter";

describe("ScopeSupervisorProjectIntelligenceAdapter", () => {
  test("exposes scoped TypeScript AST import graph context to Supervisos", async () => {
    const projectRoot = path.resolve("supervisor-project-intelligence");
    const sources: Record<string, string> = {
      "src/main.tsx": "import { App } from './App';\nApp();\n",
      "src/App.tsx":
        "import { Header } from './components/Header';\nexport function App() { return <Header />; }\n",
      "src/components/Header.tsx":
        "export function Header() { return <h1>Hello</h1>; }\n",
    };
    const data = createIndexData(projectRoot, sources);
    const index = createIndex(data);
    const importGraph = new ScopeImportGraphService({
      now: () => "2026-06-20T00:00:00.000Z",
      readSource: async ({ file }) => sources[file.path] ?? null,
    });
    const scopeResolver = new ScopeResolverService({
      index,
      importGraph,
    });
    const adapter = new ScopeSupervisorProjectIntelligenceAdapter({
      index,
      scopeResolver,
      importGraph,
    });

    const snapshot = await adapter.analyze({
      userId: "user-1",
      projectId: "project-1",
      projectRoot,
      intent: "Where is the Header component wired?",
    });

    expect(snapshot.status).toBe("ready");
    expect(snapshot.symbolExtractionMode).toBe("ast");
    expect(snapshot.scope?.resolverVersion).toBe("v1-import-graph");
    expect(snapshot.scope?.primaryTarget.path).toBe(
      "src/components/Header.tsx"
    );
    expect(snapshot.symbolMatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Header",
          path: "src/components/Header.tsx",
          source: "ast-import-graph",
        }),
      ])
    );
    expect(snapshot.graphNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "src/components/Header.tsx",
          importedBy: ["src/App.tsx"],
          symbols: expect.arrayContaining([
            expect.objectContaining({ name: "Header", kind: "component" }),
          ]),
        }),
      ])
    );
  });

  test("fails closed when the index belongs to another project root", async () => {
    const indexRoot = path.resolve("supervisor-project-intelligence-index");
    const sessionRoot = path.resolve("supervisor-project-intelligence-session");
    const data = createIndexData(indexRoot, {
      "src/App.tsx": "export function App() { return null; }\n",
    });
    const index = createIndex(data);
    const importGraph = new ScopeImportGraphService({
      readSource: async () => "",
    });
    const scopeResolver = new ScopeResolverService({ index, importGraph });
    const adapter = new ScopeSupervisorProjectIntelligenceAdapter({
      index,
      scopeResolver,
      importGraph,
    });

    const snapshot = await adapter.analyze({
      userId: "user-1",
      projectRoot: sessionRoot,
      intent: "App",
    });

    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.symbolExtractionMode).toBe("none");
    expect(snapshot.diagnostics[0]).toContain("project root mismatch");
  });
});

function createIndexData(
  projectRoot: string,
  sources: Record<string, string>
): RepoSnapshotIndexData {
  const files = Object.entries(sources).map(([filePath, source]) => ({
    path: filePath,
    extension: path.extname(filePath),
    sizeBytes: Buffer.byteLength(source, "utf8"),
    modifiedAt: "2026-06-20T00:00:00.000Z",
    language: "typescript",
  }));
  return {
    projectRoot,
    index: {
      storagePath: path.join(projectRoot, ".eragear", "repo-index.json"),
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

function createIndex(data: RepoSnapshotIndexData): RepoSnapshotIndexPort {
  return {
    getIndexSnapshot: async () => data,
    refreshIndex: async () => data,
    searchIndex: async () => ({
      status: "ready",
      query: "",
      indexedAt: data.index.indexedAt,
      results: [],
      prompt: "",
      diagnostics: [],
    }),
  };
}

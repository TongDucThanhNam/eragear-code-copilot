import { describe, expect, test } from "bun:test";
import type {
  SupervisorProjectIntelligencePort,
  SupervisorProjectIntelligenceSnapshot,
} from "#runtime/modules/supervisor";
import { SupervisorGoalConsultationProjectSummaryAdapter } from "./supervisor-goal-consultation-project-summary.adapter";

describe("SupervisorGoalConsultationProjectSummaryAdapter", () => {
  test("keeps only bounded relative structural metadata", async () => {
    const input = createIntelligence();
    const adapter = new SupervisorGoalConsultationProjectSummaryAdapter({
      analyze: () => Promise.resolve(input),
    });

    const summary = await adapter.build({
      userId: "secret-user",
      projectId: "project-1",
      projectRoot: "C:\\secret\\owned-repo",
      intent: "Inspect the workflow boundary",
    });

    expect(summary).toMatchObject({
      status: "ready",
      symbolExtractionMode: "ast",
      scope: {
        secondaryPaths: ["packages/runtime/src/workflow.ts"],
      },
    });
    expect(summary.graphNodes).toHaveLength(1);
    expect(summary.graphNodes[0]?.path).toBe(
      "packages/runtime/src/workflow.ts"
    );
    expect(summary.graphNodes[0]?.imports).toEqual([
      "packages/runtime/src/reducer.ts",
    ]);
    expect(summary.symbolMatches).toEqual([
      {
        path: "packages/runtime/src/workflow.ts",
        name: "RunReconciler",
        kind: "class",
        line: 42,
        source: "ast-import-graph",
      },
    ]);
    expect(summary.routeMap).toHaveLength(1);

    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("secret-user");
    expect(serialized).not.toContain("C:\\secret");
    expect(serialized).not.toContain(".eragear");
    expect(serialized).not.toContain("vault-note");
    expect(serialized).not.toContain("SUPER_SECRET_TOKEN");
    expect(serialized).not.toContain("diagnostic leaked a credential");
  });

  test("fails closed without propagating adapter diagnostics", async () => {
    const projectIntelligence: SupervisorProjectIntelligencePort = {
      analyze: () => Promise.reject(new Error("token=SUPER_SECRET_TOKEN_123")),
    };
    const adapter = new SupervisorGoalConsultationProjectSummaryAdapter(
      projectIntelligence
    );

    await expect(
      adapter.build({
        userId: "user-1",
        projectId: "project-1",
        projectRoot: "C:\\repo",
        intent: "Goal",
      })
    ).resolves.toEqual({
      status: "unavailable",
      symbolExtractionMode: "none",
      graphNodes: [],
      symbolMatches: [],
      routeMap: [],
    });
  });
});

function createIntelligence(): SupervisorProjectIntelligenceSnapshot {
  return {
    status: "ready",
    symbolExtractionMode: "ast",
    scope: {
      resolverVersion: "v1-import-graph",
      primaryTarget: {
        path: "C:\\secret\\outside.ts",
        score: 1,
        reason: "absolute path must be removed",
      },
      secondaryTargets: [
        {
          path: "packages/runtime/src/workflow.ts",
          score: 0.9,
          reason: "safe structural match",
        },
        {
          path: ".eragear/vault-note.ts",
          score: 0.8,
          reason: "vault metadata must be removed",
        },
      ],
      resolvedViaLLM: false,
    },
    graphNodes: [
      {
        path: "packages/runtime/src/workflow.ts",
        workspace: "runtime",
        imports: [
          "packages/runtime/src/reducer.ts",
          "../outside.ts",
          "C:\\secret\\dependency.ts",
          "C:relative-secret.ts",
        ],
        importedBy: ["apps/desktop/src/bootstrap.ts"],
        exports: ["RunReconciler", "SUPER_SECRET_TOKEN_123456789"],
        symbols: [{ name: "RunReconciler", kind: "class", line: 42 }],
        reachableFromRoots: true,
      },
      {
        path: ".eragear/vault-note.ts",
        workspace: "vault",
        imports: [],
        importedBy: [],
        exports: [],
        symbols: [],
        reachableFromRoots: false,
      },
    ],
    symbolMatches: [
      {
        path: "packages/runtime/src/workflow.ts",
        name: "RunReconciler",
        kind: "class",
        line: 42,
        source: "ast-import-graph",
      },
      {
        path: "C:\\secret\\outside.ts",
        name: "SecretSymbol",
        kind: "function",
        line: 1,
        source: "repo-index",
      },
    ],
    routeMap: [
      {
        path: "apps/desktop/src/bootstrap.ts",
        routeKey: "desktop-bootstrap",
        workspace: "desktop",
        exportedSymbols: ["bootstrapDesktop"],
      },
      {
        path: "notes/vault-note.md",
        routeKey: "private-note",
        workspace: "notes",
        exportedSymbols: [],
      },
    ],
    diagnostics: [
      "diagnostic leaked a credential: token=SUPER_SECRET_TOKEN_123",
    ],
  };
}

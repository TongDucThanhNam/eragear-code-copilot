import { describe, expect, test } from "bun:test";
import {
  BuildProjectMemoryContextRequestSchema,
  DeleteProjectMemoryPresetRequestSchema,
  RefreshProjectIndexRequestSchema,
  SearchProjectIndexRequestSchema,
  UpsertProjectMemoryPresetRequestSchema,
} from "./settings-project-memory-router-data";

function values(count: number, prefix: string): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
}

describe("settings Project Memory request schemas", () => {
  test("accepts omitted optional project-index refresh input", () => {
    expect(RefreshProjectIndexRequestSchema.parse(undefined)).toBeUndefined();
  });

  test("keeps project-index search input strict and bounded", () => {
    expect(
      SearchProjectIndexRequestSchema.parse({
        projectId: "project-1",
        query: " restore risk ",
        limit: 12,
      })
    ).toEqual({
      projectId: "project-1",
      query: "restore risk",
      limit: 12,
    });

    expect(
      SearchProjectIndexRequestSchema.safeParse({
        query: "restore risk",
        limit: 33,
      }).success
    ).toBe(false);

    expect(
      SearchProjectIndexRequestSchema.safeParse({
        query: "restore risk",
        includeHidden: true,
      }).success
    ).toBe(false);
  });

  test("bounds project-memory context source and semantic controls at the tRPC request seam", () => {
    expect(
      BuildProjectMemoryContextRequestSchema.parse({
        projectId: "project-1",
        query: " summarize ",
        retrievalMode: "semantic",
        sourceIds: [" source-1 "],
        sourcePaths: [" docs/context.md "],
        maxBytes: 24_000,
        maxChunks: 8,
      })
    ).toEqual({
      projectId: "project-1",
      query: "summarize",
      retrievalMode: "semantic",
      sourceIds: ["source-1"],
      sourcePaths: ["docs/context.md"],
      maxBytes: 24_000,
      maxChunks: 8,
    });

    expect(
      BuildProjectMemoryContextRequestSchema.safeParse({
        retrievalMode: "hybrid",
      }).success
    ).toBe(false);

    expect(
      BuildProjectMemoryContextRequestSchema.safeParse({
        sourcePaths: values(9, "docs/file"),
      }).success
    ).toBe(false);

    expect(
      BuildProjectMemoryContextRequestSchema.safeParse({
        maxBytes: 24_001,
      }).success
    ).toBe(false);
  });

  test("keeps project-memory preset upserts strict and bounded", () => {
    expect(
      UpsertProjectMemoryPresetRequestSchema.parse({
        projectId: "project-1",
        id: " preset-1 ",
        name: " restore review ",
        sourcePaths: [" docs/context.md "],
        defaultQuery: " summarize restore risk ",
        retrievalMode: "full",
        maxBytes: 12_000,
        maxChunks: 4,
      })
    ).toEqual({
      projectId: "project-1",
      id: "preset-1",
      name: "restore review",
      sourcePaths: ["docs/context.md"],
      defaultQuery: "summarize restore risk",
      retrievalMode: "full",
      maxBytes: 12_000,
      maxChunks: 4,
    });

    expect(
      UpsertProjectMemoryPresetRequestSchema.safeParse({
        name: "",
        sourcePaths: ["docs/context.md"],
      }).success
    ).toBe(false);

    expect(
      UpsertProjectMemoryPresetRequestSchema.safeParse({
        name: "restore review",
        sourcePaths: [],
      }).success
    ).toBe(false);

    expect(
      UpsertProjectMemoryPresetRequestSchema.safeParse({
        name: "restore review",
        sourcePaths: ["docs/context.md"],
        diagnostics: [],
      }).success
    ).toBe(false);
  });

  test("rejects oversized preset defaults and source lists", () => {
    expect(
      UpsertProjectMemoryPresetRequestSchema.safeParse({
        name: "restore review",
        sourcePaths: values(9, "docs/file"),
      }).success
    ).toBe(false);

    expect(
      UpsertProjectMemoryPresetRequestSchema.safeParse({
        name: "restore review",
        sourcePaths: ["docs/context.md"],
        defaultQuery: "x".repeat(501),
      }).success
    ).toBe(false);
  });

  test("keeps project-memory preset delete requests narrow", () => {
    expect(
      DeleteProjectMemoryPresetRequestSchema.parse({
        projectId: "project-1",
        id: " preset-1 ",
      })
    ).toEqual({
      projectId: "project-1",
      id: "preset-1",
    });

    expect(
      DeleteProjectMemoryPresetRequestSchema.safeParse({
        id: "preset-1",
        name: "restore review",
      }).success
    ).toBe(false);
  });
});

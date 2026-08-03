import { z } from "zod";

export const RepoSnapshotIndexingProjectInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
  })
  .strict()
  .optional();

export const UpdateRepoSnapshotIndexingSettingsInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    enabled: z.boolean(),
    refreshNow: z.boolean().optional(),
  })
  .strict();

export const RefreshRepoSnapshotIndexInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    reason: z.string().trim().min(1).max(80).optional(),
  })
  .strict()
  .optional();

export const SearchRepoSnapshotIndexInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    query: z.string().trim().min(1),
    limit: z.number().int().positive().max(32).optional(),
  })
  .strict();

export const RepoSnapshotIndexingSettingsSchema = z
  .object({
    enabled: z.boolean(),
    userConfigured: z.boolean(),
    updatedAt: z.string().min(1),
    lastRefreshAt: z.string().min(1).optional(),
  })
  .strict();

const RepoIndexSemanticSchema = z
  .object({
    status: z.enum(["ready", "empty"]),
    profiledFiles: z.number().int().nonnegative(),
    tokenCount: z.number().int().nonnegative(),
    source: z.enum(["local-token-profile", "model-embedding"]),
    embeddedFiles: z.number().int().nonnegative().optional(),
    model: z.string().optional(),
    dimensions: z.number().int().nonnegative().optional(),
    provider: z.literal("openai-compatible").optional(),
  })
  .strict();

export const RepoSnapshotIndexFileSchema = z
  .object({
    path: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    extension: z.string(),
    modifiedAt: z.string().optional(),
    language: z.string().optional(),
    semanticTags: z.array(z.string()).optional(),
    semanticHash: z.string().optional(),
    embeddingModel: z.string().optional(),
    embeddingDimensions: z.number().int().nonnegative().optional(),
    embeddingHash: z.string().optional(),
  })
  .strict();

export const RepoSnapshotIndexSymbolSchema = z
  .object({
    path: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum([
      "class",
      "function",
      "interface",
      "type",
      "component",
      "export",
    ]),
    line: z.number().int().positive(),
    language: z.string().optional(),
  })
  .strict();

export const RepoSnapshotIndexTaskSchema = z
  .object({
    path: z.string().min(1),
    marker: z.enum(["TODO", "FIXME", "HACK", "BUG", "XXX"]),
    line: z.number().int().positive(),
    text: z.string(),
  })
  .strict();

export const RepoSnapshotIndexSnapshotSchema = z
  .object({
    storagePath: z.string().min(1),
    indexedAt: z.string().optional(),
    indexedFiles: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    semantic: RepoIndexSemanticSchema,
    extensions: z.array(
      z
        .object({
          extension: z.string(),
          count: z.number().int().nonnegative(),
        })
        .strict()
    ),
    files: z.array(RepoSnapshotIndexFileSchema),
    symbols: z.array(RepoSnapshotIndexSymbolSchema),
    tasks: z.array(RepoSnapshotIndexTaskSchema),
    diagnostics: z.array(z.string()),
  })
  .strict();

export const RepoSnapshotIndexDataSchema = z
  .object({
    projectRoot: z.string().min(1),
    index: RepoSnapshotIndexSnapshotSchema,
  })
  .strict();

export const RepoSnapshotManifestSummarySchema = z
  .object({
    id: z.string().min(1),
    manifestPath: z.string().min(1),
    createdAt: z.string().min(1),
    reason: z.string().min(1),
    indexedAt: z.string().optional(),
    indexedFiles: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    symbolCount: z.number().int().nonnegative(),
    taskCount: z.number().int().nonnegative(),
    semanticStatus: z.enum(["ready", "empty"]),
    hash: z.string().min(1),
  })
  .strict();

export const RepoSnapshotManifestSchema =
  RepoSnapshotManifestSummarySchema.extend({
    schemaVersion: z.literal(1),
    projectRoot: z.string().min(1),
    storagePath: z.string().min(1),
    extensions: RepoSnapshotIndexSnapshotSchema.shape.extensions,
    fileSample: z.array(RepoSnapshotIndexFileSchema),
    symbolSample: z.array(RepoSnapshotIndexSymbolSchema),
    taskSample: z.array(RepoSnapshotIndexTaskSchema),
    diagnostics: z.array(z.string()),
  }).strict();

export const RepoSnapshotStorageStateSchema = z
  .object({
    projectRoot: z.string().min(1),
    statePath: z.string().min(1),
    manifestDir: z.string().min(1),
    lastAcceptedManifestPath: z.string().optional(),
    manifests: z.array(RepoSnapshotManifestSummarySchema),
    diagnostics: z.array(z.string()),
  })
  .strict();

export const RepoSnapshotIndexOverviewSchema = z
  .object({
    projectRoot: z.string().min(1),
    settings: RepoSnapshotIndexingSettingsSchema,
    index: RepoSnapshotIndexSnapshotSchema,
    storage: RepoSnapshotStorageStateSchema,
    status: z.enum(["enabled", "disabled", "not-indexed"]),
    diagnostics: z.array(z.string()),
  })
  .strict();

export const RepoSnapshotIndexSearchItemSchema = z
  .object({
    type: z.enum(["file", "symbol", "task"]),
    path: z.string().min(1),
    title: z.string().min(1),
    detail: z.string(),
    score: z.number(),
    matchKind: z.enum(["direct", "semantic", "embedding"]).optional(),
    line: z.number().int().positive().optional(),
    language: z.string().optional(),
    marker: RepoSnapshotIndexTaskSchema.shape.marker.optional(),
  })
  .strict();

export const RepoSnapshotIndexSearchResultSchema = z
  .object({
    status: z.enum(["ready", "not-indexed", "no-results", "disabled"]),
    query: z.string(),
    indexedAt: z.string().optional(),
    results: z.array(RepoSnapshotIndexSearchItemSchema),
    prompt: z.string(),
    diagnostics: z.array(z.string()),
  })
  .strict();

export type RepoSnapshotIndexingProjectInput = z.infer<
  typeof RepoSnapshotIndexingProjectInputSchema
>;
export type UpdateRepoSnapshotIndexingSettingsInput = z.infer<
  typeof UpdateRepoSnapshotIndexingSettingsInputSchema
>;
export type RefreshRepoSnapshotIndexInput = z.infer<
  typeof RefreshRepoSnapshotIndexInputSchema
>;
export type SearchRepoSnapshotIndexInput = z.infer<
  typeof SearchRepoSnapshotIndexInputSchema
>;
export type RepoSnapshotIndexingSettings = z.infer<
  typeof RepoSnapshotIndexingSettingsSchema
>;
export type RepoSnapshotIndexSnapshot = z.infer<
  typeof RepoSnapshotIndexSnapshotSchema
>;
export type RepoSnapshotIndexFile = z.infer<typeof RepoSnapshotIndexFileSchema>;
export type RepoSnapshotIndexSymbol = z.infer<
  typeof RepoSnapshotIndexSymbolSchema
>;
export type RepoSnapshotIndexTask = z.infer<typeof RepoSnapshotIndexTaskSchema>;
export type RepoSnapshotIndexData = z.infer<typeof RepoSnapshotIndexDataSchema>;
export type RepoSnapshotManifest = z.infer<typeof RepoSnapshotManifestSchema>;
export type RepoSnapshotManifestSummary = z.infer<
  typeof RepoSnapshotManifestSummarySchema
>;
export type RepoSnapshotStorageState = z.infer<
  typeof RepoSnapshotStorageStateSchema
>;
export type RepoSnapshotIndexOverview = z.infer<
  typeof RepoSnapshotIndexOverviewSchema
>;
export type RepoSnapshotIndexSearchResult = z.infer<
  typeof RepoSnapshotIndexSearchResultSchema
>;

import { z } from "zod";

export const MemoryRetrievalModeSchema = z.enum(["full", "semantic"]);

export const MemoryProjectInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
  })
  .strict()
  .optional();

export const SetMemorySourceEnabledInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    sourceId: z.string().trim().min(1),
    enabled: z.boolean(),
  })
  .strict();

export const BuildMemoryContextInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    query: z.string().trim().optional(),
    presetId: z.string().trim().min(1).optional(),
    retrievalMode: MemoryRetrievalModeSchema.optional(),
    sourceIds: z.array(z.string().trim().min(1)).max(8).optional(),
    sourcePaths: z.array(z.string().trim().min(1)).max(8).optional(),
    maxBytes: z.number().int().positive().max(24_000).optional(),
    maxChunks: z.number().int().positive().max(8).optional(),
  })
  .strict();

export const UpsertMemoryPresetInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    id: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).max(80),
    sourcePaths: z.array(z.string().trim().min(1)).min(1).max(8),
    defaultQuery: z.string().trim().max(240).optional(),
    retrievalMode: MemoryRetrievalModeSchema.optional(),
    maxBytes: z.number().int().positive().max(24_000).optional(),
    maxChunks: z.number().int().positive().max(8).optional(),
  })
  .strict();

export const DeleteMemoryPresetInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    id: z.string().trim().min(1),
  })
  .strict();

export const MemorySourceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  sourcePath: z.string().min(1),
  relativePath: z.string().min(1),
  exists: z.boolean(),
  enabled: z.boolean(),
  byteLength: z.number().int().nonnegative(),
  preview: z.string(),
  warnings: z.array(z.string()),
});

export const MemoryPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  sourcePaths: z.array(z.string()),
  defaultQuery: z.string().optional(),
  retrievalMode: MemoryRetrievalModeSchema,
  maxBytes: z.number().int().positive(),
  maxChunks: z.number().int().positive(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  lastUsedAt: z.string().optional(),
  diagnostics: z.array(z.string()),
});

export const MemoryDataSchema = z
  .object({
    sources: z.array(MemorySourceSchema),
    presets: z.array(MemoryPresetSchema),
    warnings: z.array(z.string()),
  })
  .strict();

export const MemoryListResultSchema = MemoryDataSchema.extend({
  enabledCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
}).strict();

export const MemoryContextSourceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  relativePath: z.string().min(1),
  byteLength: z.number().int().nonnegative(),
  includedBytes: z.number().int().nonnegative(),
  truncated: z.boolean(),
  warnings: z.array(z.string()),
});

export const MemoryContextChunkSchema = z.object({
  sourceId: z.string().min(1),
  label: z.string().min(1),
  relativePath: z.string().min(1),
  chunkIndex: z.number().int().nonnegative(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  score: z.number(),
  ranker: z.string().optional(),
  embeddingModel: z.string().optional(),
  includedBytes: z.number().int().nonnegative(),
  truncated: z.boolean(),
});

export const MemoryContextResultSchema = z
  .object({
    status: z.enum(["ready", "no-enabled-sources"]),
    query: z.string(),
    retrievalMode: MemoryRetrievalModeSchema,
    presetId: z.string().optional(),
    presetName: z.string().optional(),
    sources: z.array(MemoryContextSourceSchema),
    chunks: z.array(MemoryContextChunkSchema),
    semantic: z
      .object({
        ranker: z.string(),
        model: z.string().optional(),
        dimensions: z.number().int().positive().optional(),
        diagnostics: z.array(z.string()),
      })
      .optional(),
    prompt: z.string(),
    diagnostics: z.array(z.string()),
  })
  .strict();

export type MemoryProjectInput = z.infer<typeof MemoryProjectInputSchema>;
export type SetMemorySourceEnabledInput = z.infer<
  typeof SetMemorySourceEnabledInputSchema
>;
export type BuildMemoryContextInput = z.infer<
  typeof BuildMemoryContextInputSchema
>;
export type UpsertMemoryPresetInput = z.infer<
  typeof UpsertMemoryPresetInputSchema
>;
export type DeleteMemoryPresetInput = z.infer<
  typeof DeleteMemoryPresetInputSchema
>;
export type MemorySource = z.infer<typeof MemorySourceSchema>;
export type MemoryPreset = z.infer<typeof MemoryPresetSchema>;
export type MemoryData = z.infer<typeof MemoryDataSchema>;
export type MemoryListResult = z.infer<typeof MemoryListResultSchema>;
export type MemoryContextResult = z.infer<typeof MemoryContextResultSchema>;

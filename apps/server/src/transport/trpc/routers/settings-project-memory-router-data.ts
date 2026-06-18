import { z } from "zod";

export const ProjectMemoryRetrievalModeRequestSchema = z.enum([
  "full",
  "semantic",
]);

export const RefreshProjectIndexRequestSchema = z
  .object({
    projectId: z.string().optional(),
  })
  .strict()
  .optional();

export const SearchProjectIndexRequestSchema = z
  .object({
    projectId: z.string().optional(),
    query: z.string().trim().min(1),
    limit: z.number().int().positive().max(32).optional(),
  })
  .strict();

export const BuildProjectMemoryContextRequestSchema = z
  .object({
    projectId: z.string().optional(),
    query: z.string().trim().optional(),
    presetId: z.string().trim().min(1).optional(),
    retrievalMode: ProjectMemoryRetrievalModeRequestSchema.optional(),
    sourceIds: z.array(z.string().trim().min(1)).max(8).optional(),
    sourcePaths: z.array(z.string().trim().min(1)).max(8).optional(),
    maxBytes: z.number().int().positive().max(24_000).optional(),
    maxChunks: z.number().int().positive().max(8).optional(),
  })
  .strict();

export const UpsertProjectMemoryPresetRequestSchema = z
  .object({
    projectId: z.string().optional(),
    id: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).max(80),
    sourcePaths: z.array(z.string().trim().min(1)).min(1).max(8),
    defaultQuery: z.string().trim().max(500).optional(),
    retrievalMode: ProjectMemoryRetrievalModeRequestSchema.optional(),
    maxBytes: z.number().int().positive().max(24_000).optional(),
    maxChunks: z.number().int().positive().max(8).optional(),
  })
  .strict();

export const DeleteProjectMemoryPresetRequestSchema = z
  .object({
    projectId: z.string().optional(),
    id: z.string().trim().min(1),
  })
  .strict();

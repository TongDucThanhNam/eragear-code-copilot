import { z } from "zod";

export const ResolverVersionSchema = z.enum(["v0-no-graph", "v1-import-graph"]);

export const ScopeResolverInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    intent: z.string().trim().min(1),
    phaseGoal: z.string().trim().min(1).optional(),
    activePathHints: z.array(z.string().trim().min(1)).max(16).optional(),
    limit: z.number().int().positive().max(20).optional(),
  })
  .strict();

export const ScopeTargetSchema = z
  .object({
    path: z.string(),
    score: z.number(),
    reason: z.string(),
  })
  .strict();

export const ScopeResolutionSchema = z
  .object({
    resolverVersion: ResolverVersionSchema,
    primaryTarget: ScopeTargetSchema,
    secondaryTargets: z.array(ScopeTargetSchema),
    resolvedViaLLM: z.boolean(),
    diagnostics: z
      .object({
        signalScanSkippedBySize: z.number().int().nonnegative(),
        symbolExtractionMode: z.enum(["regex", "ast"]),
        indexedFiles: z.number().int().nonnegative(),
        candidateCount: z.number().int().nonnegative(),
        deterministicGap: z.number().nonnegative().optional(),
        graphConfidence: z.number().min(0).max(1).optional(),
      })
      .strict(),
  })
  .strict();

export type ResolverVersion = z.infer<typeof ResolverVersionSchema>;
export type ScopeResolverInput = z.infer<typeof ScopeResolverInputSchema>;
export type ScopeTarget = z.infer<typeof ScopeTargetSchema>;
export type ScopeResolution = z.infer<typeof ScopeResolutionSchema>;

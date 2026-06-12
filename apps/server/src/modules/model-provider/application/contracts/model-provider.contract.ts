import { z } from "zod";

export const ModelProviderFormatSchema = z.enum([
  "anthropic",
  "openai",
  "gemini",
]);

export const ModelProviderEndpointsSchema = z
  .object({
    anthropic: z.string().optional().default(""),
    openai: z.string().optional().default(""),
    gemini: z.string().optional().default(""),
  })
  .strict();

export const ModelProviderMappingSchema = z
  .object({
    haiku: z.string().optional(),
    sonnet: z.string().optional(),
    opus: z.string().optional(),
    reasoning: z.string().optional(),
  })
  .strict();

export const ModelProviderMappingsSchema = z.record(
  z.string().min(1),
  ModelProviderMappingSchema
);

export const ModelSupportedFormatsSchema = z.record(
  z.string().min(1),
  z.array(ModelProviderFormatSchema)
);

export const ModelProviderSourceSchema = z.enum(["default", "custom"]);

export const ModelProviderRecordSchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().min(1),
    name: z.string().min(1),
    endpoints: ModelProviderEndpointsSchema,
    credentialId: z.string().min(1).optional(),
    apiKeyUrl: z.string().optional(),
    models: z.array(z.string().min(1)),
    modelSupportedFormats: ModelSupportedFormatsSchema.default({}),
    providerMappings: ModelProviderMappingsSchema.default({}),
    source: ModelProviderSourceSchema.default("custom"),
    enabled: z.boolean().default(true),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

export const ListModelProvidersInputSchema = z
  .object({
    includeDisabled: z.boolean().optional(),
  })
  .strict()
  .optional();

export const ModelProviderListResultSchema = z
  .object({
    providers: z.array(ModelProviderRecordSchema),
    totalCount: z.number().int().nonnegative(),
  })
  .strict();

export const GetModelProviderInputSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export const UpsertModelProviderInputSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1),
    endpoints: ModelProviderEndpointsSchema,
    credentialId: z.string().min(1).optional(),
    apiKeyUrl: z.string().optional(),
    models: z.array(z.string().min(1)).default([]),
    modelSupportedFormats: ModelSupportedFormatsSchema.optional(),
    providerMappings: ModelProviderMappingsSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export const DeleteModelProviderInputSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export const DeleteModelProviderResultSchema = z
  .object({
    deleted: z.literal(true),
  })
  .strict();

export type ModelProviderFormat = z.infer<typeof ModelProviderFormatSchema>;
export type ModelProviderEndpoints = z.infer<
  typeof ModelProviderEndpointsSchema
>;
export type ModelProviderMapping = z.infer<typeof ModelProviderMappingSchema>;
export type ModelProviderMappings = z.infer<typeof ModelProviderMappingsSchema>;
export type ModelSupportedFormats = z.infer<typeof ModelSupportedFormatsSchema>;
export type ModelProviderSource = z.infer<typeof ModelProviderSourceSchema>;
export type ModelProviderRecord = z.infer<typeof ModelProviderRecordSchema>;
export type ListModelProvidersInput = z.infer<
  typeof ListModelProvidersInputSchema
>;
export type ModelProviderListResult = z.infer<
  typeof ModelProviderListResultSchema
>;
export type GetModelProviderInput = z.infer<typeof GetModelProviderInputSchema>;
export type UpsertModelProviderInput = z.infer<
  typeof UpsertModelProviderInputSchema
>;
export type DeleteModelProviderInput = z.infer<
  typeof DeleteModelProviderInputSchema
>;
export type DeleteModelProviderResult = z.infer<
  typeof DeleteModelProviderResultSchema
>;

export type ModelProviderSeed = Omit<
  ModelProviderRecord,
  "userId" | "createdAt" | "updatedAt"
>;

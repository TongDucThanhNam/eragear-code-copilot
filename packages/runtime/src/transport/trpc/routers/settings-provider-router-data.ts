import { z } from "zod";

export const UpdateCapabilityStateRequestSchema = z
  .object({
    projectId: z.string().optional(),
    capabilityId: z.string().trim().min(1),
    enabled: z.boolean(),
  })
  .strict();

export const TestProviderRequestSchema = z
  .object({
    projectId: z.string().optional(),
    providerId: z.string().trim().min(1),
  })
  .strict();

export const SelectProviderModelRequestSchema = z
  .object({
    projectId: z.string().optional(),
    providerId: z.string().trim().min(1),
    modelId: z.string().trim().min(1),
  })
  .strict();

export const ClearProviderModelRequestSchema = z
  .object({
    projectId: z.string().optional(),
  })
  .strict()
  .optional();

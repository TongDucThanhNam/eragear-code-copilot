import { z } from "zod";

const AcpActivityLimitRequestSchema = z
  .number()
  .int()
  .positive()
  .max(500)
  .optional();

export const ExportAcpActivityRequestSchema = z
  .object({
    projectId: z.string().optional(),
    chatId: z.string().trim().min(1).optional(),
    limit: AcpActivityLimitRequestSchema,
  })
  .strict()
  .optional();

export const RetryAcpActivityStreamRequestSchema = z
  .object({
    projectId: z.string().optional(),
  })
  .strict()
  .optional();

export const ReplayAcpActivityRequestSchema = z
  .object({
    projectId: z.string().optional(),
    chatId: z.string().trim().min(1).optional(),
    correlationKey: z.string().trim().min(1).optional(),
    kind: z.string().trim().min(1).optional(),
    limit: AcpActivityLimitRequestSchema,
  })
  .strict()
  .optional();

export const SaveAcpReplayPresetRequestSchema = z
  .object({
    projectId: z.string().optional(),
    id: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).max(80),
    chatId: z.string().trim().min(1).optional(),
    correlationKey: z.string().trim().min(1).optional(),
    kind: z.string().trim().min(1).optional(),
    limit: AcpActivityLimitRequestSchema,
  })
  .strict();

export const DeleteAcpReplayPresetRequestSchema = z
  .object({
    projectId: z.string().optional(),
    id: z.string().trim().min(1),
  })
  .strict();

import { z } from "zod";

export const TerminalStatusSchema = z.enum(["running", "exited"]);

export const TerminalDimensionsSchema = z
  .object({
    cols: z.number().int().min(1).max(500),
    rows: z.number().int().min(1).max(200),
  })
  .strict();

export const TerminalSettingsSchema = z
  .object({
    inheritSystemProfile: z.boolean(),
    shellCommand: z.string().default(""),
    shellArgs: z.array(z.string()).default([]),
  })
  .strict();

export const UpdateTerminalSettingsInputSchema =
  TerminalSettingsSchema.partial().strict().optional();

export const TerminalRecordSchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().min(1),
    projectId: z.string().optional(),
    cwd: z.string().min(1),
    command: z.string().min(1),
    args: z.array(z.string()),
    cols: z.number().int().min(1).max(500),
    rows: z.number().int().min(1).max(200),
    status: TerminalStatusSchema,
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    exitCode: z.number().int().nullable().optional(),
    signal: z.string().nullable().optional(),
  })
  .strict();

export const CreateTerminalInputSchema = z
  .object({
    projectId: z.string().min(1).optional(),
    cwd: z.string().optional(),
    cols: z.number().int().min(1).max(500).optional(),
    rows: z.number().int().min(1).max(200).optional(),
  })
  .strict()
  .optional();

export const WriteTerminalInputSchema = z
  .object({
    terminalId: z.string().min(1),
    data: z
      .string()
      .min(1)
      .max(64 * 1024),
  })
  .strict();

export const KillTerminalInputSchema = z
  .object({
    terminalId: z.string().min(1),
  })
  .strict();

export const ResizeTerminalInputSchema = z
  .object({
    terminalId: z.string().min(1),
    cols: z.number().int().min(1).max(500),
    rows: z.number().int().min(1).max(200),
  })
  .strict();

export const TerminalEventsInputSchema = z
  .object({
    terminalId: z.string().min(1),
  })
  .strict();

export const TerminalListResultSchema = z
  .object({
    terminals: z.array(TerminalRecordSchema),
  })
  .strict();

export const TerminalSettingsResultSchema = z
  .object({
    settings: TerminalSettingsSchema,
  })
  .strict();

export type TerminalStatus = z.infer<typeof TerminalStatusSchema>;
export type TerminalDimensions = z.infer<typeof TerminalDimensionsSchema>;
export type TerminalSettings = z.infer<typeof TerminalSettingsSchema>;
export type UpdateTerminalSettingsInput = z.infer<
  typeof UpdateTerminalSettingsInputSchema
>;
export type TerminalRecord = z.infer<typeof TerminalRecordSchema>;
export type CreateTerminalInput = z.infer<typeof CreateTerminalInputSchema>;
export type WriteTerminalInput = z.infer<typeof WriteTerminalInputSchema>;
export type KillTerminalInput = z.infer<typeof KillTerminalInputSchema>;
export type ResizeTerminalInput = z.infer<typeof ResizeTerminalInputSchema>;
export type TerminalEventsInput = z.infer<typeof TerminalEventsInputSchema>;
export type TerminalListResult = z.infer<typeof TerminalListResultSchema>;
export type TerminalSettingsResult = z.infer<
  typeof TerminalSettingsResultSchema
>;

export type TerminalEvent =
  | {
      type: "output";
      terminalId: string;
      data: string;
    }
  | {
      type: "status";
      terminal: TerminalRecord;
    };

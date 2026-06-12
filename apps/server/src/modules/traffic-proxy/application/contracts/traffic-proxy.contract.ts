import { z } from "zod";

export const TrafficProxyConfigSchema = z
  .object({
    enabled: z.boolean(),
    applyToAgents: z.boolean(),
    httpProxy: z.string().default(""),
    httpsProxy: z.string().default(""),
    noProxy: z.string().default(""),
    useSystemCa: z.boolean(),
    caBundlePath: z.string().default(""),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

export const UpdateTrafficProxyConfigInputSchema =
  TrafficProxyConfigSchema.omit({ updatedAt: true }).partial().strict();

export const TrafficProxyStatusSchema = z
  .object({
    config: TrafficProxyConfigSchema,
    agentEnvironmentPreview: z.record(z.string(), z.string()),
  })
  .strict();

export type TrafficProxyConfig = z.infer<typeof TrafficProxyConfigSchema>;
export type UpdateTrafficProxyConfigInput = z.infer<
  typeof UpdateTrafficProxyConfigInputSchema
>;
export type TrafficProxyStatus = z.infer<typeof TrafficProxyStatusSchema>;

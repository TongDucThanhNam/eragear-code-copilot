import { z } from "zod";

export const SupervisorAgentRoleSchema = z.enum([
  "manager",
  "research",
  "implementation",
  "test",
  "review",
  "integration",
]);

export const SupervisorAgentReadinessSchema = z
  .object({
    handshake: z.enum(["untested", "passed", "failed"]),
    exactResume: z.enum(["untested", "passed", "failed"]),
    checkedAt: z.string().datetime().optional(),
    failureReason: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

export const SupervisorAgentProfileSchema = z
  .object({
    agentId: z.string().trim().min(1).max(160),
    enabled: z.boolean(),
    roles: z.array(SupervisorAgentRoleSchema).min(1).max(6),
    maxConcurrentSessions: z.number().int().min(1).max(32).default(1),
    quotaTelemetryProviderId: z.string().trim().min(1).max(160).optional(),
    capacityGroup: z.string().trim().min(1).max(160).optional(),
    readiness: SupervisorAgentReadinessSchema,
    updatedAt: z.string().datetime(),
  })
  .strict();

export const SupervisorAgentProfileUpdateSchema = z
  .object({
    agentId: z.string().trim().min(1).max(160),
    enabled: z.boolean(),
    roles: z.array(SupervisorAgentRoleSchema).min(1).max(6),
    maxConcurrentSessions: z.number().int().min(1).max(32).default(1),
    quotaTelemetryProviderId: z.string().trim().min(1).max(160).optional(),
    capacityGroup: z.string().trim().min(1).max(160).optional(),
  })
  .strict();

export const ListSupervisorAgentProfilesInputSchema = z
  .object({ projectId: z.string().trim().min(1).max(160).optional() })
  .strict();

export const TestSupervisorAgentResumeInputSchema = z
  .object({
    agentId: z.string().trim().min(1).max(160),
    projectId: z.string().trim().min(1).max(160),
  })
  .strict();

export type SupervisorAgentProfile = z.infer<
  typeof SupervisorAgentProfileSchema
>;
export type SupervisorAgentProfileUpdate = z.infer<
  typeof SupervisorAgentProfileUpdateSchema
>;

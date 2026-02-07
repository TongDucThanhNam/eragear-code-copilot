import { z } from "zod";

export const AgentTypeSchema = z.enum([
  "claude",
  "codex",
  "opencode",
  "gemini",
  "other",
]);

export const ListAgentsInputSchema = z
  .object({
    projectId: z.string().nullish(),
  })
  .optional();

export const CreateAgentInputSchema = z.object({
  name: z.string().min(1),
  type: AgentTypeSchema,
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  projectId: z.string().nullable().optional(),
});

export const UpdateAgentInputSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  type: AgentTypeSchema.optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  projectId: z.string().nullable().optional(),
});

export const DeleteAgentInputSchema = z.object({
  id: z.string(),
});

export const SetActiveAgentInputSchema = z.object({
  id: z.string().nullable(),
});

export type ListAgentsInput = z.infer<typeof ListAgentsInputSchema>;
export type CreateAgentInput = z.infer<typeof CreateAgentInputSchema>;
export type UpdateAgentInput = z.infer<typeof UpdateAgentInputSchema>;
export type DeleteAgentInput = z.infer<typeof DeleteAgentInputSchema>;
export type SetActiveAgentInput = z.infer<typeof SetActiveAgentInputSchema>;

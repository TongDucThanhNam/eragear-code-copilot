/**
 * Agents tRPC Router
 *
 * RPC endpoints for agent configuration management: list, create, update, delete,
 * and set active agent. Agents represent AI assistant configurations.
 *
 * @module transport/trpc/routers/agents
 */

import { z } from "zod";
import { AgentService } from "@/modules/agent";
import { protectedProcedure, router } from "../base";

export const agentsRouter = router({
  /** List all agents, optionally filtered by project ID */
  list: protectedProcedure
    .input(z.object({ projectId: z.string().nullish() }).optional())
    .query(async ({ input, ctx }) => {
      const service = new AgentService(ctx.container.getAgents());
      return await service.listAgents(input?.projectId ?? undefined);
    }),

  /** Create a new agent configuration */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        type: z.enum(["claude", "codex", "opencode", "gemini", "other"]),
        command: z.string().min(1),
        args: z.array(z.string()).optional(),
        env: z.record(z.string(), z.string()).optional(),
        projectId: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const service = new AgentService(ctx.container.getAgents());
      return await service.createAgent(input);
    }),

  /** Update an existing agent configuration */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        type: z
          .enum(["claude", "codex", "opencode", "gemini", "other"])
          .optional(),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string(), z.string()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const service = new AgentService(ctx.container.getAgents());
      return await service.updateAgent(input);
    }),

  /** Delete an agent configuration */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const service = new AgentService(ctx.container.getAgents());
      return await service.deleteAgent(input.id);
    }),

  /** Set the active agent (for UI state) */
  setActive: protectedProcedure
    .input(z.object({ id: z.string().nullable() }))
    .mutation(async ({ input, ctx }) => {
      const service = new AgentService(ctx.container.getAgents());
      return await service.setActive(input.id);
    }),
});

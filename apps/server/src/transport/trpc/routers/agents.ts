/**
 * Agents tRPC Router
 *
 * RPC endpoints for agent configuration management: list, create, update, delete,
 * and set active agent. Agents represent AI assistant configurations.
 *
 * @module transport/trpc/routers/agents
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { AgentService } from "@/modules/agent/application/agent.service";
import { ValidationError } from "@/shared/errors";
import { protectedProcedure, router } from "../base";

export const agentsRouter = router({
  /** List all agents, optionally filtered by project ID */
  list: protectedProcedure
    .input(z.object({ projectId: z.string().nullish() }).optional())
    .query(({ input, ctx }) => {
      const service = new AgentService(ctx.container.getAgents());
      return service.listAgents(input?.projectId ?? undefined);
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
    .mutation(({ input, ctx }) => {
      const service = new AgentService(ctx.container.getAgents());
      try {
        return service.createAgent(input);
      } catch (error) {
        if (error instanceof ValidationError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      }
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
    .mutation(({ input, ctx }) => {
      const service = new AgentService(ctx.container.getAgents());
      try {
        return service.updateAgent(input);
      } catch (error) {
        if (error instanceof ValidationError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      }
    }),

  /** Delete an agent configuration */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input, ctx }) => {
      const service = new AgentService(ctx.container.getAgents());
      return service.deleteAgent(input.id);
    }),

  /** Set the active agent (for UI state) */
  setActive: protectedProcedure
    .input(z.object({ id: z.string().nullable() }))
    .mutation(({ input, ctx }) => {
      const service = new AgentService(ctx.container.getAgents());
      return service.setActive(input.id);
    }),
});

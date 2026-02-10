/**
 * Agents tRPC Router
 *
 * RPC endpoints for agent configuration management: list, create, update, delete,
 * and set active agent. Agents represent AI assistant configurations.
 *
 * @module transport/trpc/routers/agents
 */

import {
  CreateAgentInputSchema,
  DeleteAgentInputSchema,
  ListAgentsInputSchema,
  SetActiveAgentInputSchema,
  UpdateAgentInputSchema,
} from "@/modules/agent";
import { protectedProcedure, router } from "../base";

function requireUserId(ctx: { auth?: { userId?: string } | null }): string {
  const userId = ctx.auth?.userId;
  if (!userId) {
    throw new Error("Unauthorized");
  }
  return userId;
}

export const agentsRouter = router({
  /** List all agents, optionally filtered by project ID */
  list: protectedProcedure
    .input(ListAgentsInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.agentServices.listAgents();
      return await service.execute(requireUserId(ctx), input?.projectId);
    }),

  /** Create a new agent configuration */
  create: protectedProcedure
    .input(CreateAgentInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.agentServices.createAgent();
      return await service.execute(requireUserId(ctx), input);
    }),

  /** Update an existing agent configuration */
  update: protectedProcedure
    .input(UpdateAgentInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.agentServices.updateAgent();
      return await service.execute(requireUserId(ctx), input);
    }),

  /** Delete an agent configuration */
  delete: protectedProcedure
    .input(DeleteAgentInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.agentServices.deleteAgent();
      return await service.execute(requireUserId(ctx), input.id);
    }),

  /** Set the active agent (for UI state) */
  setActive: protectedProcedure
    .input(SetActiveAgentInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.agentServices.setActiveAgent();
      return await service.execute(requireUserId(ctx), input.id);
    }),
});

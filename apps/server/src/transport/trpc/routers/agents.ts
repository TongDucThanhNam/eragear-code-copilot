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

export const agentsRouter = router({
  /** List all agents, optionally filtered by project ID */
  list: protectedProcedure
    .input(ListAgentsInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.container.getAgentServices().agent();
      return await service.listAgents(input?.projectId ?? undefined);
    }),

  /** Create a new agent configuration */
  create: protectedProcedure
    .input(CreateAgentInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.container.getAgentServices().agent();
      return await service.createAgent(input);
    }),

  /** Update an existing agent configuration */
  update: protectedProcedure
    .input(UpdateAgentInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.container.getAgentServices().agent();
      return await service.updateAgent(input);
    }),

  /** Delete an agent configuration */
  delete: protectedProcedure
    .input(DeleteAgentInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.container.getAgentServices().agent();
      return await service.deleteAgent(input.id);
    }),

  /** Set the active agent (for UI state) */
  setActive: protectedProcedure
    .input(SetActiveAgentInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.container.getAgentServices().agent();
      return await service.setActive(input.id);
    }),
});

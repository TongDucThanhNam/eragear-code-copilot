import { z } from "zod";
import { AgentService } from "@/modules/agent/application/agent.service";
import { publicProcedure, router } from "../base";

export const agentsRouter = router({
  list: publicProcedure
    .input(z.object({ projectId: z.string().nullish() }).optional())
    .query(({ input, ctx }) => {
      const service = new AgentService(ctx.container.getAgents());
      return service.listAgents(input?.projectId ?? undefined);
    }),

  create: publicProcedure
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
      return service.createAgent(input);
    }),

  update: publicProcedure
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
      return service.updateAgent(input);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input, ctx }) => {
      const service = new AgentService(ctx.container.getAgents());
      return service.deleteAgent(input.id);
    }),

  setActive: publicProcedure
    .input(z.object({ id: z.string().nullable() }))
    .mutation(({ input, ctx }) => {
      const service = new AgentService(ctx.container.getAgents());
      return service.setActive(input.id);
    }),
});

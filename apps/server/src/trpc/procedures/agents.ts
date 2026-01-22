import { z } from "zod";
import {
  createAgent,
  deleteAgent,
  listAgents,
  setActiveAgent,
  updateAgent,
} from "../../agents/storage";
import { publicProcedure, router } from "../base";

export const agentsRouter = router({
  list: publicProcedure
    .input(z.object({ projectId: z.string().nullish() }).optional())
    .query(({ input }) => {
      return listAgents(input?.projectId);
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
    .mutation(({ input }) => {
      return createAgent(input);
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
    .mutation(({ input }) => {
      return updateAgent(input);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      deleteAgent(input.id);
      return { success: true };
    }),

  setActive: publicProcedure
    .input(z.object({ id: z.string().nullable() }))
    .mutation(({ input }) => {
      return setActiveAgent(input.id);
    }),
});

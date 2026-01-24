/**
 * AI tRPC Router
 *
 * RPC endpoints for AI interaction: sending messages, setting model/mode,
 * and canceling prompts. Handles real-time communication with agent processes.
 *
 * @module transport/trpc/routers/ai
 */

import { z } from "zod";
import { CancelPromptService } from "@/modules/ai/application/cancel-prompt.service";
import { SendMessageService } from "@/modules/ai/application/send-message.service";
import { SetModeService } from "@/modules/ai/application/set-mode.service";
import { SetModelService } from "@/modules/ai/application/set-model.service";
import { publicProcedure, router } from "../base";

export const aiRouter = router({
  /** Send a message to an agent session */
  sendMessage: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        text: z.string(),
        textAnnotations: z.record(z.string(), z.unknown()).optional(),
        images: z
          .array(
            z.object({
              base64: z.string(),
              mimeType: z.string(),
              uri: z.string().optional(),
              annotations: z.record(z.string(), z.unknown()).optional(),
            })
          )
          .optional(),
        audio: z
          .array(
            z.object({
              base64: z.string(),
              mimeType: z.string(),
              annotations: z.record(z.string(), z.unknown()).optional(),
            })
          )
          .optional(),
        resources: z
          .array(
            z.object({
              uri: z.string(),
              text: z.string().optional(),
              blob: z.string().optional(),
              mimeType: z.string().optional(),
              annotations: z.record(z.string(), z.unknown()).optional(),
            })
          )
          .optional(),
        resourceLinks: z
          .array(
            z.object({
              uri: z.string(),
              name: z.string(),
              mimeType: z.string().optional(),
              title: z.string().optional(),
              description: z.string().optional(),
              size: z.union([z.number(), z.bigint()]).optional(),
              annotations: z.record(z.string(), z.unknown()).optional(),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const service = new SendMessageService(
        ctx.container.getSessions(),
        ctx.container.getSessionRuntime()
      );
      return await service.execute(input);
    }),

  /** Set the active model for a session */
  setModel: publicProcedure
    .input(z.object({ chatId: z.string(), modelId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const service = new SetModelService(ctx.container.getSessionRuntime());
      return await service.execute(input.chatId, input.modelId);
    }),

  /** Set the active mode for a session */
  setMode: publicProcedure
    .input(z.object({ chatId: z.string(), modeId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const service = new SetModeService(ctx.container.getSessionRuntime());
      return await service.execute(input.chatId, input.modeId);
    }),

  /** Cancel an ongoing prompt in a session */
  cancelPrompt: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const service = new CancelPromptService(
        ctx.container.getSessionRuntime()
      );
      return await service.execute(input.chatId);
    }),
});

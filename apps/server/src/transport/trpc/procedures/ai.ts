import { z } from "zod";
import {
  CancelPromptService,
  SendMessageService,
  SetModelService,
  SetModeService,
} from "../../../modules/ai/application";
import { publicProcedure, router } from "../base";

export const aiRouter = router({
  sendMessage: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        text: z.string(),
        images: z
          .array(
            z.object({
              base64: z.string(),
              mimeType: z.string(),
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

  setModel: publicProcedure
    .input(z.object({ chatId: z.string(), modelId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const service = new SetModelService(ctx.container.getSessionRuntime());
      return await service.execute(input.chatId, input.modelId);
    }),

  setMode: publicProcedure
    .input(z.object({ chatId: z.string(), modeId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const service = new SetModeService(ctx.container.getSessionRuntime());
      return await service.execute(input.chatId, input.modeId);
    }),

  cancelPrompt: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const service = new CancelPromptService(
        ctx.container.getSessionRuntime()
      );
      return await service.execute(input.chatId);
    }),
});

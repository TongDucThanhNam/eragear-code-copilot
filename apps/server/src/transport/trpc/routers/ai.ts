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
import { protectedProcedure, router } from "../base";

const MAX_MESSAGE_TEXT_CHARS = 100_000;
const MAX_INLINE_MEDIA_ITEMS = 8;
const MAX_BASE64_CHARS = 6 * 1024 * 1024;
const MAX_RESOURCE_ITEMS = 16;
const MAX_RESOURCE_TEXT_CHARS = 200_000;
const MAX_RESOURCE_LINK_ITEMS = 32;
const MAX_RESOURCE_LINK_SIZE = Number.MAX_SAFE_INTEGER;

export const aiRouter = router({
  /** Send a message to an agent session */
  sendMessage: protectedProcedure
    .input(
      z.object({
        chatId: z.string(),
        text: z.string().max(MAX_MESSAGE_TEXT_CHARS),
        textAnnotations: z.record(z.string(), z.unknown()).optional(),
        images: z
          .array(
            z.object({
              base64: z.string().min(1).max(MAX_BASE64_CHARS),
              mimeType: z.string().min(1).max(255),
              uri: z.string().max(4096).optional(),
              annotations: z.record(z.string(), z.unknown()).optional(),
            })
          )
          .max(MAX_INLINE_MEDIA_ITEMS)
          .optional(),
        audio: z
          .array(
            z.object({
              base64: z.string().min(1).max(MAX_BASE64_CHARS),
              mimeType: z.string().min(1).max(255),
              annotations: z.record(z.string(), z.unknown()).optional(),
            })
          )
          .max(MAX_INLINE_MEDIA_ITEMS)
          .optional(),
        resources: z
          .array(
            z
              .object({
                uri: z.string().min(1).max(4096),
                text: z.string().max(MAX_RESOURCE_TEXT_CHARS).optional(),
                blob: z.string().max(MAX_BASE64_CHARS).optional(),
                mimeType: z.string().min(1).max(255).optional(),
                annotations: z.record(z.string(), z.unknown()).optional(),
              })
              .superRefine((value, ctx) => {
                const hasText = value.text !== undefined;
                const hasBlob = value.blob !== undefined;
                if (hasText === hasBlob) {
                  ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message:
                      "Resource must include exactly one of text or blob",
                  });
                }
              })
          )
          .max(MAX_RESOURCE_ITEMS)
          .optional(),
        resourceLinks: z
          .array(
            z.object({
              uri: z.string().min(1).max(4096),
              name: z.string().min(1).max(255),
              mimeType: z.string().min(1).max(255).optional(),
              title: z.string().max(255).optional(),
              description: z.string().max(2000).optional(),
              size: z
                .number()
                .int()
                .nonnegative()
                .max(MAX_RESOURCE_LINK_SIZE)
                .optional(),
              annotations: z.record(z.string(), z.unknown()).optional(),
            })
          )
          .max(MAX_RESOURCE_LINK_ITEMS)
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      console.info("[tRPC] User message received", {
        chatId: input.chatId,
        textLength: input.text.length,
        images: input.images?.length ?? 0,
        audio: input.audio?.length ?? 0,
        resources: input.resources?.length ?? 0,
        resourceLinks: input.resourceLinks?.length ?? 0,
      });
      const service = new SendMessageService(
        ctx.container.getSessions(),
        ctx.container.getSessionRuntime()
      );
      return await service.execute(input);
    }),

  /** Set the active model for a session */
  setModel: protectedProcedure
    .input(z.object({ chatId: z.string(), modelId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const service = new SetModelService(
        ctx.container.getSessionRuntime(),
        ctx.container.getSessions()
      );
      return await service.execute(input.chatId, input.modelId);
    }),

  /** Set the active mode for a session */
  setMode: protectedProcedure
    .input(z.object({ chatId: z.string(), modeId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const service = new SetModeService(
        ctx.container.getSessionRuntime(),
        ctx.container.getSessions()
      );
      return await service.execute(input.chatId, input.modeId);
    }),

  /** Cancel an ongoing prompt in a session */
  cancelPrompt: protectedProcedure
    .input(z.object({ chatId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const service = new CancelPromptService(
        ctx.container.getSessionRuntime()
      );
      return await service.execute(input.chatId);
    }),
});

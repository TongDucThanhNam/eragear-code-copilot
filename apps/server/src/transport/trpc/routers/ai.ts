/**
 * AI tRPC Router
 *
 * RPC endpoints for AI interaction: sending messages, setting model/mode,
 * and canceling prompts. Handles real-time communication with agent processes.
 *
 * @module transport/trpc/routers/ai
 */

import { z } from "zod";
import { createLogger } from "@/infra/logging/structured-logger";
import { CancelPromptService } from "@/modules/ai/application/cancel-prompt.service";
import { SendMessageService } from "@/modules/ai/application/send-message.service";
import { SetModeService } from "@/modules/ai/application/set-mode.service";
import { SetModelService } from "@/modules/ai/application/set-model.service";
import { protectedProcedure, router } from "../base";

const logger = createLogger("tRPC");
const MAX_TEXT_PREVIEW_CHARS = 200;

function toTextPreview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_TEXT_PREVIEW_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_TEXT_PREVIEW_CHARS)}...`;
}

export const aiRouter = router({
  /** Send a message to an agent session */
  sendMessage: protectedProcedure
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
            z
              .object({
                uri: z.string(),
                text: z.string().optional(),
                blob: z.string().optional(),
                mimeType: z.string().optional(),
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
      logger.info("User message received", {
        chatId: input.chatId,
        textLength: input.text.length,
        textPreview: toTextPreview(input.text),
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

import { z } from "zod";
import { buildPrompt } from "../../services/ai-bridge";
import { broadcastToSession, chats } from "../../session/events";
import { appendMessage } from "../../session/storage";
import type { ConnWithUnstableModel } from "../../session/types";
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
    .mutation(async ({ input }) => {
      const session = chats.get(input.chatId);
      if (!session?.sessionId) {
        throw new Error("Chat not found");
      }

      const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const msgTimestamp = Date.now();

      appendMessage(input.chatId, {
        id: msgId,
        role: "user",
        content: input.text,
        timestamp: msgTimestamp,
      });

      broadcastToSession(input.chatId, {
        type: "user_message",
        id: msgId,
        text: input.text,
        timestamp: msgTimestamp,
      });

      console.log(`[tRPC] Sending message to ${input.chatId}`);

      const prompt = buildPrompt({
        text: input.text,
        images: input.images,
        resources: input.resources,
      });

      const res = await session.conn.prompt({
        sessionId: session.sessionId,
        prompt,
      });

      return { stopReason: res.stopReason };
    }),

  setModel: publicProcedure
    .input(z.object({ chatId: z.string(), modelId: z.string() }))
    .mutation(async ({ input }) => {
      const session = chats.get(input.chatId);
      if (!session?.sessionId) {
        throw new Error("Chat not found");
      }

      console.log(
        `[tRPC] Setting model to ${input.modelId} for ${input.chatId}`
      );
      await (
        session.conn as unknown as ConnWithUnstableModel
      ).unstable_setSessionModel({
        sessionId: session.sessionId,
        modelId: input.modelId,
      });

      if (session.models) {
        session.models.currentModelId = input.modelId;
      }
      return { ok: true };
    }),

  setMode: publicProcedure
    .input(z.object({ chatId: z.string(), modeId: z.string() }))
    .mutation(async ({ input }) => {
      const session = chats.get(input.chatId);
      if (!session?.sessionId) {
        throw new Error("Chat not found");
      }

      console.log(`[tRPC] Setting mode to ${input.modeId} for ${input.chatId}`);
      await session.conn.setSessionMode({
        sessionId: session.sessionId,
        modeId: input.modeId,
      });

      if (session.modes) {
        session.modes.currentModeId = input.modeId;
      }
      return { ok: true };
    }),

  cancelPrompt: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .mutation(async ({ input }) => {
      const session = chats.get(input.chatId);
      if (!session?.sessionId) {
        throw new Error("Chat not found");
      }

      console.log(`[tRPC] Cancelling prompt for ${input.chatId}`);
      await session.conn.cancel({ sessionId: session.sessionId });

      for (const [, pending] of session.pendingPermissions) {
        pending.resolve({ outcome: { outcome: "cancelled" } });
      }
      session.pendingPermissions.clear();

      return { ok: true };
    }),
});

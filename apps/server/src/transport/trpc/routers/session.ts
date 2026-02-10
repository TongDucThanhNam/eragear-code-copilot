/**
 * Session tRPC Router
 *
 * RPC endpoints for session management: create, stop, resume, delete, get state,
 * list sessions, update metadata, get messages, and subscribe to real-time events.
 * Sessions represent active connections to AI agents.
 *
 * @module transport/trpc/routers/session
 */

import { observable } from "@trpc/server/observable";
import {
  DEFAULT_SESSION_LIST_PAGE_LIMIT,
  DEFAULT_SESSION_MESSAGES_PAGE_LIMIT,
} from "@/config/constants";
import { ENV } from "@/config/environment";
import {
  CreateSessionInputSchema,
  ListSessionsInputSchema,
  SessionChatIdInputSchema,
  SessionListPageInputSchema,
  SessionMessagesPageInputSchema,
  UpdateSessionMetaInputSchema,
} from "@/modules/session";
import type { BroadcastEvent } from "../../../shared/types/session.types";
import { protectedProcedure, router } from "../base";

function requireUserId(ctx: { auth?: { userId?: string } | null }): string {
  const userId = ctx.auth?.userId;
  if (!userId) {
    throw new Error("Unauthorized");
  }
  return userId;
}

export const sessionRouter = router({
  /** Create a new session for a project */
  createSession: protectedProcedure
    .input(CreateSessionInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.sessionServices.createSession();
      const res = await service.execute({
        userId: requireUserId(ctx),
        projectId: input.projectId,
        command: input.command,
        args: input.args,
        env: input.env,
      });
      return {
        chatId: res.id,
        sessionId: res.sessionId,
        chatStatus: res.chatStatus,
        modes: res.modes,
        models: res.models,
        promptCapabilities: res.promptCapabilities,
        loadSessionSupported: res.loadSessionSupported ?? false,
        agentInfo: res.agentInfo ?? null,
      };
    }),

  /** Stop a running session */
  stopSession: protectedProcedure
    .input(SessionChatIdInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.sessionServices.stopSession();
      return await service.execute(requireUserId(ctx), input.chatId);
    }),

  /** Resume a stopped session */
  resumeSession: protectedProcedure
    .input(SessionChatIdInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.sessionServices.resumeSession();
      return await service.execute(requireUserId(ctx), input.chatId);
    }),

  /** Delete a session */
  deleteSession: protectedProcedure
    .input(SessionChatIdInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.sessionServices.deleteSession();
      return await service.execute(requireUserId(ctx), input.chatId);
    }),

  /** Get current session state */
  getSessionState: protectedProcedure
    .input(SessionChatIdInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.sessionServices.getSessionState();
      return await service.execute(requireUserId(ctx), input.chatId);
    }),

  /** List sessions (paginated) */
  getSessions: protectedProcedure
    .input(ListSessionsInputSchema)
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? DEFAULT_SESSION_LIST_PAGE_LIMIT;
      const offset = input?.offset ?? 0;

      const service = ctx.sessionServices.listSessions();
      return await service.execute(requireUserId(ctx), {
        limit: Math.min(limit, ENV.sessionListPageMaxLimit),
        offset,
      });
    }),

  /** List sessions with cursor pagination (preferred for large datasets). */
  getSessionsPage: protectedProcedure
    .input(SessionListPageInputSchema)
    .query(async ({ ctx, input }) => {
      const service = ctx.sessionServices.listSessions();
      return await service.executePage(requireUserId(ctx), {
        limit: Math.min(
          input?.limit ?? DEFAULT_SESSION_LIST_PAGE_LIMIT,
          ENV.sessionListPageMaxLimit
        ),
        cursor: input?.cursor,
      });
    }),

  /** Update session metadata (name, pinned, archived) */
  updateSessionMeta: protectedProcedure
    .input(UpdateSessionMetaInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.sessionServices.updateSessionMeta();
      return await service.execute({ ...input, userId: requireUserId(ctx) });
    }),

  /** @deprecated Use getSessionMessagesPage for paginated history retrieval. */
  getSessionMessages: protectedProcedure
    .input(SessionChatIdInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.sessionServices.getSessionMessages();
      const messages: Awaited<ReturnType<typeof service.execute>>["messages"] =
        [];
      let cursor: number | undefined;

      while (true) {
        const page = await service.execute({
          userId: requireUserId(ctx),
          chatId: input.chatId,
          cursor,
          limit: ENV.sessionMessagesPageMaxLimit,
          includeCompacted: true,
        });
        messages.push(...page.messages);
        if (!page.hasMore || page.nextCursor === undefined) {
          break;
        }
        cursor = page.nextCursor;
      }

      return messages;
    }),

  /** Get paginated session message history */
  getSessionMessagesPage: protectedProcedure
    .input(SessionMessagesPageInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.sessionServices.getSessionMessages();
      return await service.execute({
        userId: requireUserId(ctx),
        chatId: input.chatId,
        cursor: input.cursor,
        limit: Math.min(
          input.limit ?? DEFAULT_SESSION_MESSAGES_PAGE_LIMIT,
          ENV.sessionMessagesPageMaxLimit
        ),
        includeCompacted: input.includeCompacted ?? true,
      });
    }),

  /** Get current SQLite storage statistics */
  getStorageStats: protectedProcedure.query(async ({ ctx }) => {
    const service = ctx.sessionServices.getSessionStorageStats();
    return await service.execute();
  }),

  /** Subscribe to real-time session events */
  onSessionEvents: protectedProcedure
    .input(SessionChatIdInputSchema)
    .subscription(({ input, ctx }) => {
      const service = ctx.sessionServices.subscribeSessionEvents();
      return observable<BroadcastEvent>((emit) => {
        let subscription: ReturnType<typeof service.execute> | undefined;
        try {
          subscription = service.execute(requireUserId(ctx), input.chatId);
        } catch (error) {
          emit.error(
            error instanceof Error ? error : new Error("Chat not found")
          );
          return;
        }

        if (!subscription) {
          emit.error(new Error("Chat not found"));
          return;
        }

        emit.next({ type: "connected" });
        emit.next({ type: "chat_status", status: subscription.chatStatus });

        for (const event of subscription.bufferedEvents) {
          emit.next(event);
        }

        const unsubscribe = subscription.subscribe((event) => {
          emit.next(event);
        });

        return () => {
          unsubscribe();
          subscription.release();
        };
      });
    }),
});

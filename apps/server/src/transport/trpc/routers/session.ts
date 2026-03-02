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
  CreateSessionInputSchema,
  DiscoverAgentSessionsInputSchema,
  ListSessionsInputSchema,
  LoadAgentSessionInputSchema,
  SessionChatIdInputSchema,
  SessionEventsInputSchema,
  SessionListPageInputSchema,
  SessionMessageByIdInputSchema,
  SessionMessagesPageInputSchema,
  UpdateSessionMetaInputSchema,
} from "@/modules/session";
import { shouldEmitRuntimeLog } from "@/platform/logging/runtime-log-level";
import { createLogger } from "@/platform/logging/structured-logger";
import type { BroadcastEvent } from "../../../shared/types/session.types";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

const logger = createLogger("tRPC");

function shouldLogStreamEvent(event: BroadcastEvent): boolean {
  return event.type === "ui_message" || event.type === "ui_message_part";
}

function buildStreamEventContext(
  event: BroadcastEvent
): Record<string, unknown> {
  if (event.type === "ui_message") {
    return {
      messageId: event.message.id,
      partsCount: event.message.parts.length,
    };
  }
  if (event.type === "ui_message_part") {
    return {
      messageId: event.messageId,
      partIndex: event.partIndex,
      isNew: event.isNew,
      partType: event.part.type,
    };
  }
  return {
    eventType: event.type,
  };
}

export const sessionRouter = router({
  /** Create a new session for a project */
  createSession: protectedProcedure
    .input(CreateSessionInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.sessionServices.createSession();
      const res = await service.execute({
        userId: getRequiredUserId(ctx),
        projectId: input.projectId,
        agentId: input.agentId,
      });
      return {
        chatId: res.id,
        sessionId: res.sessionId,
        sessionLoadMethod: res.sessionLoadMethod ?? null,
        chatStatus: res.chatStatus,
        modes: res.modes,
        models: res.models,
        configOptions: res.configOptions ?? null,
        sessionInfo: res.sessionInfo ?? null,
        promptCapabilities: res.promptCapabilities,
        loadSessionSupported: res.loadSessionSupported ?? false,
        agentInfo: res.agentInfo ?? null,
      };
    }),

  /** Discover sessions exposed by the agent over ACP session/list (capability-gated). */
  discoverAgentSessions: protectedProcedure
    .input(DiscoverAgentSessionsInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.sessionServices.discoverAgentSessions();
      return await service.execute({
        userId: getRequiredUserId(ctx),
        projectId: input.projectId,
        agentId: input.agentId,
        cursor: input.cursor,
      });
    }),

  /** Import an existing agent session into a new local chat runtime. */
  loadAgentSession: protectedProcedure
    .input(LoadAgentSessionInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.sessionServices.loadAgentSession();
      const res = await service.execute({
        userId: getRequiredUserId(ctx),
        projectId: input.projectId,
        sessionId: input.sessionId,
        agentId: input.agentId,
      });
      return {
        chatId: res.id,
        sessionId: res.sessionId,
        sessionLoadMethod: res.sessionLoadMethod ?? null,
        chatStatus: res.chatStatus,
        modes: res.modes,
        models: res.models,
        configOptions: res.configOptions ?? null,
        sessionInfo: res.sessionInfo ?? null,
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
      return await service.execute(getRequiredUserId(ctx), input.chatId);
    }),

  /** Resume a stopped session */
  resumeSession: protectedProcedure
    .input(SessionChatIdInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.sessionServices.resumeSession();
      return await service.execute(getRequiredUserId(ctx), input.chatId);
    }),

  /** Delete a session */
  deleteSession: protectedProcedure
    .input(SessionChatIdInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.sessionServices.deleteSession();
      return await service.execute(getRequiredUserId(ctx), input.chatId);
    }),

  /** Get current session state */
  getSessionState: protectedProcedure
    .input(SessionChatIdInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.sessionServices.getSessionState();
      return await service.execute(getRequiredUserId(ctx), input.chatId);
    }),

  /** List sessions (paginated) */
  getSessions: protectedProcedure
    .input(ListSessionsInputSchema)
    .query(async ({ ctx, input }) => {
      const runtimeConfig = ctx.appConfig.getConfig();
      const service = ctx.sessionServices.listSessions();
      return await service.execute(
        getRequiredUserId(ctx),
        {
          limit: input?.limit,
          offset: input?.offset,
        },
        runtimeConfig.sessionListPageMaxLimit
      );
    }),

  /** List sessions with cursor pagination (preferred for large datasets). */
  getSessionsPage: protectedProcedure
    .input(SessionListPageInputSchema)
    .query(async ({ ctx, input }) => {
      const runtimeConfig = ctx.appConfig.getConfig();
      const service = ctx.sessionServices.listSessions();
      return await service.executePage(
        getRequiredUserId(ctx),
        {
          limit: input?.limit,
          cursor: input?.cursor,
        },
        runtimeConfig.sessionListPageMaxLimit
      );
    }),

  /** Update session metadata (name, pinned, archived) */
  updateSessionMeta: protectedProcedure
    .input(UpdateSessionMetaInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.sessionServices.updateSessionMeta();
      return await service.execute({
        ...input,
        userId: getRequiredUserId(ctx),
      });
    }),

  /** Get paginated session message history */
  getSessionMessagesPage: protectedProcedure
    .input(SessionMessagesPageInputSchema)
    .query(async ({ input, ctx }) => {
      const runtimeConfig = ctx.appConfig.getConfig();
      const service = ctx.sessionServices.getSessionMessagesPage();
      return await service.execute({
        userId: getRequiredUserId(ctx),
        chatId: input.chatId,
        cursor: input.cursor,
        direction: input.direction,
        limit: input.limit,
        maxLimit: runtimeConfig.sessionMessagesPageMaxLimit,
        includeCompacted: input.includeCompacted ?? true,
      });
    }),

  /** Get a single session message by id */
  getSessionMessageById: protectedProcedure
    .input(SessionMessageByIdInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.sessionServices.getSessionMessageById();
      return await service.execute({
        userId: getRequiredUserId(ctx),
        chatId: input.chatId,
        messageId: input.messageId,
      });
    }),

  /** Get current SQLite storage statistics */
  getStorageStats: protectedProcedure.query(async ({ ctx }) => {
    const service = ctx.sessionServices.getSessionStorageStats();
    return await service.execute();
  }),

  /** Subscribe to real-time session events */
  onSessionEvents: protectedProcedure
    .input(SessionEventsInputSchema)
    .subscription(({ input, ctx }) => {
      const service = ctx.sessionServices.subscribeSessionEvents();
      return observable<BroadcastEvent>((emit) => {
        const userId = getRequiredUserId(ctx);
        let subscription:
          | Awaited<ReturnType<typeof service.execute>>
          | undefined;
        let unsubscribe: (() => void) | undefined;
        let disposed = false;

        const start = async () => {
          try {
            subscription = await service.execute(userId, input.chatId);
          } catch (error) {
            if (shouldEmitRuntimeLog("debug")) {
              logger.debug("tRPC onSessionEvents subscribe failed", {
                chatId: input.chatId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
            if (!disposed) {
              emit.error(
                error instanceof Error ? error : new Error("Chat not found")
              );
            }
            return;
          }

          if (disposed || !subscription) {
            if (subscription) {
              await subscription.release().catch(() => undefined);
            }
            return;
          }

          if (shouldEmitRuntimeLog("debug")) {
            logger.debug("tRPC onSessionEvents subscribed", {
              chatId: input.chatId,
              bufferedEvents: subscription.bufferedEvents.length,
              chatStatus: subscription.chatStatus,
              activeTurnId: subscription.activeTurnId,
              subscriptionSource: subscription.source,
            });
          }

          // Only emit "connected" when the subscription is backed by a live
          // runtime emitter.  Stored-snapshot subscriptions have no runtime
          // listener; emitting "connected" would trick the client into
          // thinking the subscription is live for sending prompts.
          if (subscription.source === "runtime") {
            emit.next({ type: "connected" });
          }
          emit.next({
            type: "chat_status",
            status: subscription.chatStatus,
            ...(subscription.activeTurnId
              ? { turnId: subscription.activeTurnId }
              : {}),
          });

          for (const event of subscription.bufferedEvents) {
            if (shouldEmitRuntimeLog("debug") && shouldLogStreamEvent(event)) {
              logger.debug("tRPC onSessionEvents buffered event", {
                chatId: input.chatId,
                eventType: event.type,
                ...buildStreamEventContext(event),
              });
            }
            emit.next(event);
          }

          unsubscribe = subscription.subscribe((event) => {
            if (shouldEmitRuntimeLog("debug") && shouldLogStreamEvent(event)) {
              logger.debug("tRPC onSessionEvents live event", {
                chatId: input.chatId,
                eventType: event.type,
                ...buildStreamEventContext(event),
              });
            }
            emit.next(event);
          });
        };

        void start();

        return () => {
          disposed = true;
          if (shouldEmitRuntimeLog("debug")) {
            logger.debug("tRPC onSessionEvents unsubscribed", {
              chatId: input.chatId,
            });
          }
          unsubscribe?.();
          if (subscription) {
            void subscription.release().catch((error) => {
              if (shouldEmitRuntimeLog("debug")) {
                logger.debug("tRPC onSessionEvents release failed", {
                  chatId: input.chatId,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            });
          }
        };
      });
    }),
});

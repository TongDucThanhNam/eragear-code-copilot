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
  MAX_SESSION_MESSAGES_PAGE_LIMIT,
} from "@/config/constants";
import {
  CreateSessionInputSchema,
  ListSessionsInputSchema,
  SessionChatIdInputSchema,
  SessionMessagesPageInputSchema,
  UpdateSessionMetaInputSchema,
} from "@/modules/session";
import { NotFoundError } from "@/shared/errors";
import type { BroadcastEvent } from "../../../shared/types/session.types";
import { protectedProcedure, router } from "../base";

export const sessionRouter = router({
  /** Create a new session for a project */
  createSession: protectedProcedure
    .input(CreateSessionInputSchema)
    .mutation(async ({ input, ctx }) => {
      // DEBUG: Log tRPC input
      console.log(
        "[DEBUG] createSession tRPC input:",
        JSON.stringify(input, null, 2)
      );

      const project = await ctx.container
        .getProjects()
        .findById(input.projectId);
      if (!project) {
        throw new NotFoundError("Project not found", {
          module: "session",
          op: "session.lifecycle.create",
          details: { projectId: input.projectId },
        });
      }
      const service = ctx.container.getSessionServices().createSession();
      const res = await service.execute({
        projectId: input.projectId,
        projectRoot: project.path,
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
      const service = ctx.container.getSessionServices().stopSession();
      return await service.execute(input.chatId);
    }),

  /** Resume a stopped session */
  resumeSession: protectedProcedure
    .input(SessionChatIdInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.container.getSessionServices().resumeSession();
      return await service.execute(input.chatId);
    }),

  /** Delete a session */
  deleteSession: protectedProcedure
    .input(SessionChatIdInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.container.getSessionServices().deleteSession();
      return await service.execute(input.chatId);
    }),

  /** Get current session state */
  getSessionState: protectedProcedure
    .input(SessionChatIdInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.container.getSessionServices().getSessionState();
      return await service.execute(input.chatId);
    }),

  /** List sessions (paginated) */
  getSessions: protectedProcedure
    .input(ListSessionsInputSchema)
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? DEFAULT_SESSION_LIST_PAGE_LIMIT;
      const offset = input?.offset ?? 0;

      const service = ctx.container.getSessionServices().listSessions();
      return await service.execute({ limit, offset });
    }),

  /** Update session metadata (name, pinned, archived) */
  updateSessionMeta: protectedProcedure
    .input(UpdateSessionMetaInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.container.getSessionServices().updateSessionMeta();
      return await service.execute(input);
    }),

  /** @deprecated Use getSessionMessagesPage for paginated history retrieval. */
  getSessionMessages: protectedProcedure
    .input(SessionChatIdInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.container.getSessionServices().getSessionMessages();
      const messages: Awaited<ReturnType<typeof service.execute>>["messages"] =
        [];
      let cursor: number | undefined;

      while (true) {
        const page = await service.execute({
          chatId: input.chatId,
          cursor,
          limit: MAX_SESSION_MESSAGES_PAGE_LIMIT,
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
      const service = ctx.container.getSessionServices().getSessionMessages();
      return await service.execute({
        chatId: input.chatId,
        cursor: input.cursor,
        limit: input.limit ?? DEFAULT_SESSION_MESSAGES_PAGE_LIMIT,
        includeCompacted: input.includeCompacted ?? true,
      });
    }),

  /** Get current SQLite storage statistics */
  getStorageStats: protectedProcedure.query(({ ctx }) => {
    return ctx.container.getSessions().getStorageStats();
  }),

  /** Subscribe to real-time session events */
  onSessionEvents: protectedProcedure
    .input(SessionChatIdInputSchema)
    .subscription(({ input, ctx }) => {
      return observable<BroadcastEvent>((emit) => {
        const session = ctx.container.getSessionRuntime().get(input.chatId);
        if (!session) {
          emit.error(new Error("Chat not found"));
          return;
        }

        session.idleSinceAt = undefined;
        session.subscriberCount++;
        emit.next({ type: "connected" });
        emit.next({ type: "chat_status", status: session.chatStatus });

        for (const event of session.messageBuffer) {
          emit.next(event);
        }

        const onData = (data: BroadcastEvent) => {
          emit.next(data);
        };

        session.emitter.on("data", onData);

        return () => {
          session.subscriberCount = Math.max(0, session.subscriberCount - 1);
          session.emitter.off("data", onData);

          if (session.subscriberCount <= 0) {
            session.idleSinceAt = Date.now();
          }
        };
      });
    }),
});

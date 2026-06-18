import {
  CompactSessionMessagesInputSchema,
  ListSessionsInputSchema,
  SessionChatIdInputSchema,
  SessionListPageInputSchema,
  SessionMessageByIdInputSchema,
  SessionMessagesPageInputSchema,
} from "@/modules/session";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const sessionQueryRouter = router({
  /** Get current session state */
  getSessionState: protectedProcedure
    .input(SessionChatIdInputSchema)
    .query(async ({ input, ctx }) => {
      const queries = ctx.useCases.session.queries;
      return await queries.state(getRequiredUserId(ctx), input.chatId);
    }),

  /** List sessions (paginated) */
  getSessions: protectedProcedure
    .input(ListSessionsInputSchema)
    .query(async ({ ctx, input }) => {
      const runtimeConfig = ctx.appConfig.getConfig();
      const queries = ctx.useCases.session.queries;
      return await queries.list(
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
      const queries = ctx.useCases.session.queries;
      return await queries.listPage(
        getRequiredUserId(ctx),
        {
          limit: input?.limit,
          cursor: input?.cursor,
        },
        runtimeConfig.sessionListPageMaxLimit
      );
    }),

  /** Get paginated session message history */
  getSessionMessagesPage: protectedProcedure
    .input(SessionMessagesPageInputSchema)
    .query(async ({ input, ctx }) => {
      const runtimeConfig = ctx.appConfig.getConfig();
      const queries = ctx.useCases.session.queries;
      return await queries.messages({
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
      const queries = ctx.useCases.session.queries;
      return await queries.messageById({
        userId: getRequiredUserId(ctx),
        chatId: input.chatId,
        messageId: input.messageId,
      });
    }),

  /** Get current SQLite storage statistics */
  getStorageStats: protectedProcedure.query(async ({ ctx }) => {
    const queries = ctx.useCases.session.queries;
    return await queries.storageStats();
  }),

  /** Compact old stopped-session message payloads in SQLite storage. */
  compactSessionMessages: protectedProcedure
    .input(CompactSessionMessagesInputSchema)
    .mutation(async ({ input, ctx }) => {
      const queries = ctx.useCases.session.queries;
      return await queries.compact(input);
    }),
});

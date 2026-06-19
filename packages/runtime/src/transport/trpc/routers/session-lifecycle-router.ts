import {
  CreateSessionInputSchema,
  DiscoverAgentSessionsInputSchema,
  LoadAgentSessionInputSchema,
  SessionChatIdInputSchema,
} from "#runtime/modules/session";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";
import {
  createSessionResumeResponse,
  createSessionStartResponse,
} from "./session-router-data";

export const sessionLifecycleRouter = router({
  /** Create a new session for a project */
  createSession: protectedProcedure
    .input(CreateSessionInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.session.create;
      const res = await service.execute({
        userId: getRequiredUserId(ctx),
        projectId: input.projectId,
        agentId: input.agentId,
      });
      return createSessionStartResponse(res);
    }),

  /** Discover sessions exposed by the agent over ACP session/list (capability-gated). */
  discoverAgentSessions: protectedProcedure
    .input(DiscoverAgentSessionsInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.useCases.session.discoverAgentSessions;
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
      const service = ctx.useCases.session.loadAgentSession;
      const res = await service.execute({
        userId: getRequiredUserId(ctx),
        projectId: input.projectId,
        sessionId: input.sessionId,
        agentId: input.agentId,
      });
      return createSessionStartResponse(res);
    }),

  /** Stop a running session */
  stopSession: protectedProcedure
    .input(SessionChatIdInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.session.stop;
      return await service.execute(getRequiredUserId(ctx), input.chatId);
    }),

  /** Resume a stopped session */
  resumeSession: protectedProcedure
    .input(SessionChatIdInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.session.resume;
      const userId = getRequiredUserId(ctx);
      const res = await service.execute(userId, input.chatId);
      const sessionState = await ctx.useCases.session.queries.state(
        userId,
        input.chatId
      );
      return createSessionResumeResponse(res, sessionState);
    }),
});

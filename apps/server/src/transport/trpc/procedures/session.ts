import { observable } from "@trpc/server/observable";
import { z } from "zod";
import { ENV } from "../../../config/environment";
import {
  CreateSessionService,
  DeleteSessionService,
  GetSessionMessagesService,
  GetSessionStateService,
  ListSessionsService,
  ResumeSessionService,
  StopSessionService,
  UpdateSessionMetaService,
} from "../../../modules/session/application";
import type { BroadcastEvent } from "../../../shared/types/session.types";
import { publicProcedure, router } from "../base";

export const sessionRouter = router({
  createSession: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string(), z.string()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const project = ctx.container.getProjects().findById(input.projectId);
      if (!project) {
        throw new Error("Project not found");
      }
      const service = new CreateSessionService(
        ctx.container.getSessions(),
        ctx.container.getSessionRuntime(),
        ctx.container.getAgentRuntime(),
        ctx.container.getSettings()
      );
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
        modes: res.modes,
        models: res.models,
        promptCapabilities: res.promptCapabilities,
        loadSessionSupported: res.loadSessionSupported ?? false,
      };
    }),

  stopSession: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .mutation(({ input, ctx }) => {
      const service = new StopSessionService(
        ctx.container.getSessions(),
        ctx.container.getSessionRuntime()
      );
      return service.execute(input.chatId);
    }),

  resumeSession: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const service = new ResumeSessionService(
        ctx.container.getSessions(),
        ctx.container.getSessionRuntime(),
        ctx.container.getAgentRuntime(),
        ctx.container.getSettings()
      );
      return await service.execute(input.chatId);
    }),

  deleteSession: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .mutation(({ input, ctx }) => {
      const service = new DeleteSessionService(
        ctx.container.getSessions(),
        ctx.container.getSessionRuntime()
      );
      return service.execute(input.chatId);
    }),

  getSessionState: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(({ input, ctx }) => {
      const service = new GetSessionStateService(
        ctx.container.getSessions(),
        ctx.container.getSessionRuntime()
      );
      return service.execute(input.chatId);
    }),

  getSessions: publicProcedure.query(({ ctx }) => {
    const service = new ListSessionsService(
      ctx.container.getSessions(),
      ctx.container.getSessionRuntime(),
      ctx.container.getProjects()
    );
    return service.execute();
  }),

  updateSessionMeta: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        name: z.string().nullable().optional(),
        pinned: z.boolean().optional(),
        archived: z.boolean().optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      const service = new UpdateSessionMetaService(ctx.container.getSessions());
      return service.execute(input);
    }),

  getSessionMessages: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(({ input, ctx }) => {
      const service = new GetSessionMessagesService(
        ctx.container.getSessions()
      );
      return service.execute(input.chatId);
    }),

  onSessionEvents: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .subscription(({ input, ctx }) => {
      return observable<BroadcastEvent>((emit) => {
        const session = ctx.container.getSessionRuntime().get(input.chatId);
        if (!session) {
          emit.error(new Error("Chat not found"));
          return;
        }

        if (session.cleanupTimer) {
          clearTimeout(session.cleanupTimer);
          session.cleanupTimer = undefined;
        }

        session.subscriberCount++;
        emit.next({ type: "connected" });

        for (const event of session.messageBuffer) {
          emit.next(event);
        }

        const onData = (data: BroadcastEvent) => {
          emit.next(data);
        };

        session.emitter.on("data", onData);

        return () => {
          session.subscriberCount--;
          session.emitter.off("data", onData);

          if (session.subscriberCount <= 0) {
            session.cleanupTimer = setTimeout(() => {
              const currentSession = ctx.container
                .getSessionRuntime()
                .get(input.chatId);
              if (currentSession && currentSession.subscriberCount <= 0) {
                currentSession.proc.kill();
                ctx.container.getSessionRuntime().delete(input.chatId);
                ctx.container
                  .getSessions()
                  .updateStatus(input.chatId, "stopped");
              }
            }, ENV.sessionIdleTimeoutMs);
          }
        };
      });
    }),
});

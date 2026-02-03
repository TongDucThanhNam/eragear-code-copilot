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
import { z } from "zod";
import { CreateSessionService } from "@/modules/session/application/create-session.service";
import { DeleteSessionService } from "@/modules/session/application/delete-session.service";
import { GetSessionMessagesService } from "@/modules/session/application/get-session-messages.service";
import { GetSessionStateService } from "@/modules/session/application/get-session-state.service";
import { ListSessionsService } from "@/modules/session/application/list-sessions.service";
import { ResumeSessionService } from "@/modules/session/application/resume-session.service";
import { StopSessionService } from "@/modules/session/application/stop-session.service";
import { UpdateSessionMetaService } from "@/modules/session/application/update-session-meta.service";
import { ENV } from "../../../config/environment";
import type { BroadcastEvent } from "../../../shared/types/session.types";
import { terminateSessionTerminals } from "../../../shared/utils/session-cleanup.util";
import { protectedProcedure, router } from "../base";

export const sessionRouter = router({
  /** Create a new session for a project */
  createSession: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string(), z.string()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // DEBUG: Log tRPC input
      console.log(
        "[DEBUG] createSession tRPC input:",
        JSON.stringify(input, null, 2)
      );

      const project = ctx.container.getProjects().findById(input.projectId);
      if (!project) {
        throw new Error("Project not found");
      }
      const service = new CreateSessionService(
        ctx.container.getSessions(),
        ctx.container.getSessionRuntime(),
        ctx.container.getAgentRuntime(),
        ctx.container.getSettings(),
        ctx.container.getSessionAcp()
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
    .input(z.object({ chatId: z.string() }))
    .mutation(({ input, ctx }) => {
      const service = new StopSessionService(
        ctx.container.getSessions(),
        ctx.container.getSessionRuntime()
      );
      return service.execute(input.chatId);
    }),

  /** Resume a stopped session */
  resumeSession: protectedProcedure
    .input(z.object({ chatId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const service = new ResumeSessionService(
        ctx.container.getSessions(),
        ctx.container.getSessionRuntime(),
        ctx.container.getAgentRuntime(),
        ctx.container.getSettings(),
        ctx.container.getSessionAcp()
      );
      return await service.execute(input.chatId);
    }),

  /** Delete a session */
  deleteSession: protectedProcedure
    .input(z.object({ chatId: z.string() }))
    .mutation(({ input, ctx }) => {
      const service = new DeleteSessionService(
        ctx.container.getSessions(),
        ctx.container.getSessionRuntime()
      );
      return service.execute(input.chatId);
    }),

  /** Get current session state */
  getSessionState: protectedProcedure
    .input(z.object({ chatId: z.string() }))
    .query(({ input, ctx }) => {
      const service = new GetSessionStateService(
        ctx.container.getSessions(),
        ctx.container.getSessionRuntime()
      );
      return service.execute(input.chatId);
    }),

  /** List all sessions */
  getSessions: protectedProcedure.query(({ ctx }) => {
    const service = new ListSessionsService(
      ctx.container.getSessions(),
      ctx.container.getSessionRuntime(),
      ctx.container.getProjects()
    );
    return service.execute();
  }),

  /** Update session metadata (name, pinned, archived) */
  updateSessionMeta: protectedProcedure
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

  /** Get session message history */
  getSessionMessages: protectedProcedure
    .input(z.object({ chatId: z.string() }))
    .query(({ input, ctx }) => {
      const service = new GetSessionMessagesService(
        ctx.container.getSessions()
      );
      return service.execute(input.chatId);
    }),

  /** Subscribe to real-time session events */
  onSessionEvents: protectedProcedure
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
        emit.next({ type: "chat_status", status: session.chatStatus });

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
                terminateSessionTerminals(currentSession);
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

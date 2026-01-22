import { observable } from "@trpc/server/observable";
import { z } from "zod";
import { ENV } from "../../config/environment";
import { getProjectById, listProjects } from "../../projects/storage";
import { chats } from "../../session/events";
import { createChatSession } from "../../session/manager";
import {
  deleteSession as deleteStoredSession,
  getSession,
  getSessionMessages,
  loadSessions,
  updateSessionMetadata,
  updateSessionStatus,
} from "../../session/storage";
import type { BroadcastEvent } from "../../session/types";
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
    .mutation(async ({ input }) => {
      console.log("[tRPC] Creating new session", input);
      const project = getProjectById(input.projectId);
      if (!project) {
        throw new Error("Project not found");
      }
      const res = await createChatSession({
        projectId: input.projectId,
        projectRoot: project.path,
        command: input.command,
        args: input.args,
        env: input.env,
      });
      return res;
    }),

  stopSession: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .mutation(({ input }) => {
      const session = chats.get(input.chatId);
      if (session) {
        console.log(`[tRPC] Stopping session ${input.chatId}`);
        session.proc.kill();
      }
      updateSessionStatus(input.chatId, "stopped");
      return { ok: true };
    }),

  resumeSession: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .mutation(async ({ input }) => {
      const stored = getSession(input.chatId);
      if (!stored) {
        throw new Error("Session not found in store");
      }
      if (!stored.sessionId) {
        throw new Error("Session is missing ACP sessionId");
      }

      const existing = chats.get(input.chatId);
      if (existing) {
        return {
          ok: true,
          alreadyRunning: true,
          modes: existing.modes,
          models: existing.models,
          promptCapabilities: existing.promptCapabilities,
          loadSessionSupported: existing.loadSessionSupported ?? false,
        };
      }

      console.log(
        `[tRPC] Resuming session ${stored.sessionId} for chatID ${input.chatId} `
      );
      const res = await createChatSession({
        projectId: stored.projectId,
        projectRoot: stored.projectRoot,
        command: stored.command,
        args: stored.args,
        env: stored.env,
        chatId: stored.id,
        sessionIdToLoad: stored.sessionId,
      });

      return {
        ok: true,
        chatId: res.chatId,
        modes: res.modes,
        models: res.models,
        promptCapabilities: res.promptCapabilities,
        loadSessionSupported: res.loadSessionSupported ?? false,
      };
    }),

  deleteSession: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .mutation(({ input }) => {
      const session = chats.get(input.chatId);
      if (session) {
        session.proc.kill();
      }
      deleteStoredSession(input.chatId);
      if (chats.has(input.chatId)) {
        chats.delete(input.chatId);
      }
      return { ok: true };
    }),

  getSessionState: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(({ input }) => {
      const session = chats.get(input.chatId);
      if (session) {
        return {
          status: "running" as const,
          modes: session.modes,
          models: session.models,
          commands: session.commands,
          promptCapabilities: session.promptCapabilities,
          loadSessionSupported: session.loadSessionSupported,
        };
      }

      const stored = getSession(input.chatId);
      if (stored) {
        return {
          status: "stopped" as const,
          modes: null,
          models: null,
          commands: null,
          promptCapabilities: null,
          loadSessionSupported: stored.loadSessionSupported,
        };
      }

      throw new Error("Chat not found");
    }),

  getSessions: publicProcedure.query(() => {
    const { projects } = listProjects();
    const storedSessions = loadSessions();

    return storedSessions.map((session) => {
      const activeSession = chats.get(session.id);
      const isActive = Boolean(activeSession);
      const loadSessionSupported =
        activeSession?.loadSessionSupported ?? session.loadSessionSupported;
      const agentInfo = activeSession?.agentInfo ?? session.agentInfo;
      const agentName = agentInfo?.title ?? agentInfo?.name;
      const derivedProjectId =
        session.projectId ??
        projects.find((project) => project.path === session.projectRoot)?.id;
      if (!session.projectId && derivedProjectId) {
        updateSessionMetadata(session.id, { projectId: derivedProjectId });
      }
      return {
        id: session.id,
        name: session.name,
        sessionId: activeSession?.sessionId ?? session.sessionId,
        projectId: derivedProjectId ?? session.projectId ?? null,
        projectRoot: session.projectRoot,
        modeId: session.modeId,
        status: session.status,
        isActive,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
        loadSessionSupported,
        agentInfo,
        agentName,
        pinned: session.pinned ?? false,
        archived: session.archived ?? false,
      };
    });
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
    .mutation(({ input }) => {
      updateSessionMetadata(input.chatId, {
        name: input.name ?? undefined,
        pinned: input.pinned,
        archived: input.archived,
      });
      return { ok: true };
    }),

  getSessionMessages: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(({ input }) => {
      return getSessionMessages(input.chatId);
    }),

  onSessionEvents: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .subscription(({ input }) => {
      return observable<BroadcastEvent>((emit) => {
        const session = chats.get(input.chatId);
        if (!session) {
          emit.error(new Error("Chat not found"));
          return;
        }

        if (session.cleanupTimer) {
          clearTimeout(session.cleanupTimer);
          session.cleanupTimer = undefined;
          console.log(`[tRPC] Cancelled cleanup timer for ${input.chatId}`);
        }

        session.subscriberCount++;
        console.log(
          `[tRPC] Client subscribed to events for ${input.chatId} (subscribers: ${session.subscriberCount})`
        );

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
          console.log(
            `[tRPC] Client unsubscribed from ${input.chatId} (subscribers: ${session.subscriberCount})`
          );
          session.emitter.off("data", onData);

          if (session.subscriberCount <= 0) {
            console.log(
              `[tRPC] No subscribers left for ${input.chatId}, starting cleanup timer (${ENV.sessionIdleTimeoutMs / 1000}s)`
            );
            session.cleanupTimer = setTimeout(() => {
              const currentSession = chats.get(input.chatId);
              if (currentSession && currentSession.subscriberCount <= 0) {
                console.log(`[tRPC] Cleaning up idle session ${input.chatId}`);
                currentSession.proc.kill();
                chats.delete(input.chatId);
                updateSessionStatus(input.chatId, "stopped");
              }
            }, ENV.sessionIdleTimeoutMs);
          }
        };
      });
    }),
});

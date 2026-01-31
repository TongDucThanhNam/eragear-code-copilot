/**
 * HTTP Routes
 *
 * REST API endpoints for dashboard, projects, agents, and sessions management.
 * Provides endpoints for UI settings, project CRUD, agent management, and session control.
 * Uses Server-Sent Events (SSE) for real-time dashboard updates.
 *
 * @module transport/http/routes
 */

import type { Context, Hono } from "hono";

import { getContainer } from "../../bootstrap/container";
import { StopSessionService } from "../../modules/session/application/stop-session.service";
import type { Project } from "../../shared/types/project.types";
import type { StoredSession } from "../../shared/types/session.types";
import { isPathWithinRoots } from "../../shared/utils/project-roots.util";
import { terminateSessionTerminals } from "../../shared/utils/session-cleanup.util";
import { parseUiSettingsForm } from "../../shared/utils/ui-settings.util";
import {
  type ApiKeyCreateResponse,
  buildDashboardData,
} from "./ui/dashboard-data";
import { ConfigPage } from "./ui/dashboard-view";
import { getSessionFromRequest } from "./utils/auth";

type FormDataRecord = Record<string, string | File | undefined>;

function getFormValue(formData: FormDataRecord, key: string): string {
  const value = formData[key];
  return typeof value === "string" ? value : "";
}

function parseArgsInput(value: string): string[] | undefined {
  const parts = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function redirectWithParams(
  c: Context,
  params: Record<string, string | undefined>
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      search.set(key, value);
    }
  }
  const query = search.toString();
  return c.redirect(query ? `/?${query}` : "/");
}

export function registerHttpRoutes(app: Hono) {
  const container = getContainer();
  const auth = container.getAuth();

  // Get UI settings
  app.get("/api/ui-settings", (c: Context) => {
    const settings = container.getSettings().get();
    return c.json(settings);
  });

  // Update UI settings
  app.all("/api/ui-settings", async (c: Context) => {
    if (c.req.method === "PUT" || c.req.method === "POST") {
      try {
        const body = await c.req.parseBody();
        const currentSettings = container.getSettings().get();
        const formData = body as Record<string, string | File | undefined>;

        const { ui, projectRoots } = parseUiSettingsForm(
          formData,
          currentSettings
        );
        const next = container.getSettings().update({ ui, projectRoots });
        const applied = container.applySettings(next);
        container.getEventBus().publish({
          type: "settings_updated",
          changedKeys: applied.changedKeys,
          requiresRestart: applied.requiresRestart,
        });
        return c.json({ ...next, ...applied });
      } catch (error) {
        console.error("Settings parse error:", error);
        return c.json({ error: "Failed to parse settings" }, 400);
      }
    }
    return c.json({ error: "Method not allowed" }, 405);
  });

  // UI form: update settings (HTML form submission)
  app.post("/form/settings", async (c: Context) => {
    try {
      const body = await c.req.parseBody();
      const formData = body as FormDataRecord;
      const currentSettings = container.getSettings().get();
      const { ui, projectRoots } = parseUiSettingsForm(
        formData,
        currentSettings
      );
      if (projectRoots.length < 1) {
        return redirectWithParams(c, {
          tab: "settings",
          error: "At least one project root is required.",
        });
      }
      const next = container.getSettings().update({ ui, projectRoots });
      const applied = container.applySettings(next);
      container.getEventBus().publish({
        type: "settings_updated",
        changedKeys: applied.changedKeys,
        requiresRestart: applied.requiresRestart,
      });

      return redirectWithParams(c, {
        tab: "settings",
        success: "1",
        restart: applied.requiresRestart.length
          ? applied.requiresRestart.join(",")
          : undefined,
      });
    } catch (error) {
      console.error("Settings parse error:", error);
      return redirectWithParams(c, {
        tab: "settings",
        error: "Failed to save settings",
      });
    }
  });

  // Dashboard endpoints
  app.get("/api/dashboard/projects", (c: Context) => {
    const projects = container.getProjects().findAll();
    const sessions = container.getSessions().findAll();

    const projectsWithStats = projects.map((project: Project) => {
      const projectSessions = sessions.filter(
        (s: StoredSession) =>
          s.projectId === project.id || s.projectRoot === project.path
      );
      const runningSessions = projectSessions.filter(
        (s: StoredSession) => s.status === "running"
      );
      return {
        ...project,
        sessionCount: projectSessions.length,
        runningCount: runningSessions.length,
        lastOpenedAt: project.lastOpenedAt,
      };
    });

    return c.json({ projects: projectsWithStats });
  });

  app.get("/api/dashboard/sessions", (c: Context) => {
    const projects = container.getProjects().findAll();
    const storedSessions = container.getSessions().findAll();
    const runtime = container.getSessionRuntime();

    const sessions = storedSessions.map((session: StoredSession) => {
      const activeSession = runtime.get(session.id);
      const isActive = Boolean(activeSession);
      const agentInfo = activeSession?.agentInfo ?? session.agentInfo;
      const agentName = agentInfo?.title ?? agentInfo?.name ?? "Unknown Agent";

      return {
        id: session.id,
        sessionId: session.sessionId,
        projectId: session.projectId,
        projectRoot: session.projectRoot,
        projectName: session.projectId
          ? projects.find((p) => p.id === session.projectId)?.name
          : session.projectRoot.split("/").pop(),
        modeId: session.modeId,
        status: session.status,
        isActive,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
        agentInfo,
        agentName,
        messageCount: session.messages?.length ?? 0,
      };
    });

    const sortedSessions = [...sessions];
    sortedSessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    return c.json({ sessions: sortedSessions });
  });

  app.get("/api/dashboard/stats", (c: Context) => {
    const projects = container.getProjects().findAll();
    const sessions = container.getSessions().findAll();

    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

    const recentSessions = sessions.filter(
      (s: StoredSession) => s.lastActiveAt > oneDayAgo
    );
    const weeklySessions = sessions.filter(
      (s: StoredSession) => s.lastActiveAt > oneWeekAgo
    );
    const runningSessions = sessions.filter(
      (s: StoredSession) => s.status === "running"
    );

    const agentStats: Record<string, { count: number; running: number }> = {};
    for (const session of sessions) {
      const agentName =
        session.agentInfo?.title ?? session.agentInfo?.name ?? "Unknown";
      if (!agentStats[agentName]) {
        agentStats[agentName] = { count: 0, running: 0 };
      }
      agentStats[agentName].count++;
      if (session.status === "running") {
        agentStats[agentName].running++;
      }
    }

    return c.json({
      totalProjects: projects.length,
      totalSessions: sessions.length,
      activeSessions: runningSessions.length,
      recentSessions24h: recentSessions.length,
      weeklySessions: weeklySessions.length,
      agentStats,
      serverUptime: process.uptime(),
    });
  });

  app.get("/api/dashboard/stream", (c: Context) => {
    const eventBus = container.getEventBus();
    const encoder = new TextEncoder();

    let unsubscribe: (() => void) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream({
      start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        };

        send("connected", { ok: true, ts: Date.now() });

        unsubscribe = eventBus.subscribe((event) => {
          if (event && typeof event === "object" && "type" in event) {
            const eventType = (event as { type: string }).type;
            send(eventType, { ts: Date.now(), event });
            return;
          }
          send("refresh", { ts: Date.now(), event });
        });

        heartbeat = setInterval(() => {
          send("ping", { ts: Date.now() });
        }, 15_000);
      },
      cancel() {
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      },
    });

    return c.body(stream, 200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
  });

  // UI form: stop/delete sessions
  app.post("/form/sessions/stop", async (c: Context) => {
    const body = await c.req.parseBody();
    const formData = body as FormDataRecord;
    const chatId = getFormValue(formData, "chatId");
    if (!chatId) {
      return redirectWithParams(c, {
        tab: "sessions",
        error: "chatId is required",
      });
    }

    const service = new StopSessionService(
      container.getSessions(),
      container.getSessionRuntime()
    );
    service.execute(chatId);
    container.getEventBus().publish({
      type: "dashboard_refresh",
      reason: "session_stopped",
      chatId,
    });

    return redirectWithParams(c, { tab: "sessions" });
  });

  app.post("/form/sessions/delete", async (c: Context) => {
    const body = await c.req.parseBody();
    const formData = body as FormDataRecord;
    const chatId = getFormValue(formData, "chatId");
    if (!chatId) {
      return redirectWithParams(c, {
        tab: "sessions",
        error: "chatId is required",
      });
    }

    const runtime = container.getSessionRuntime();
    const session = runtime.get(chatId);
    if (session) {
      console.log(`[UI] Deleting session ${chatId}`);
      terminateSessionTerminals(session);
      session.proc.kill();
      runtime.delete(chatId);
    }

    container.getSessions().delete(chatId);
    container.getEventBus().publish({
      type: "dashboard_refresh",
      reason: "session_deleted",
      chatId,
    });
    return redirectWithParams(c, { tab: "sessions" });
  });

  app.post("/api/sessions/stop", async (c: Context) => {
    const body = await c.req.parseBody();
    const chatId = body.chatId as string;

    if (!chatId) {
      return c.json({ error: "chatId is required" }, 400);
    }

    const service = new StopSessionService(
      container.getSessions(),
      container.getSessionRuntime()
    );
    service.execute(chatId);
    container.getEventBus().publish({
      type: "dashboard_refresh",
      reason: "session_stopped",
      chatId,
    });

    return c.json({ ok: true });
  });

  app.delete("/api/sessions", async (c: Context) => {
    const body = await c.req.parseBody();
    const chatId = body.chatId as string;

    if (!chatId) {
      return c.json({ error: "chatId is required" }, 400);
    }

    const runtime = container.getSessionRuntime();
    const session = runtime.get(chatId);
    if (session) {
      console.log(`[API] Deleting session ${chatId}`);
      terminateSessionTerminals(session);
      session.proc.kill();
      runtime.delete(chatId);
    }

    container.getSessions().delete(chatId);
    container.getEventBus().publish({
      type: "dashboard_refresh",
      reason: "session_deleted",
      chatId,
    });
    return c.json({ ok: true });
  });

  // Create a new project
  app.post("/api/projects", async (c: Context) => {
    try {
      const body = await c.req.json();
      const { name, path, description, tags } = body as {
        name: string;
        path: string;
        description?: string;
        tags?: string[];
      };

      if (!(name && path)) {
        return c.json({ error: "name and path are required" }, 400);
      }

      // Validate path is within allowed project roots
      const settings = container.getSettings().get();
      const isAllowed = isPathWithinRoots(path, settings.projectRoots);

      if (!isAllowed) {
        return c.json(
          {
            error: `Path must be within allowed project roots: ${settings.projectRoots.join(", ")}`,
          },
          400
        );
      }

      const project = container.getProjects().create({
        name,
        path,
        description: description || null,
        tags: tags || [],
        favorite: false,
      });

      container.getEventBus().publish({
        type: "dashboard_refresh",
        reason: "project_created",
        projectId: project.id,
      });

      return c.json({ ok: true, project });
    } catch (error) {
      console.error("Failed to create project:", error);
      return c.json({ error: "Failed to create project" }, 500);
    }
  });

  // UI form: create project
  app.post("/form/projects/create", async (c: Context) => {
    try {
      const body = await c.req.parseBody();
      const formData = body as FormDataRecord;
      const name = getFormValue(formData, "name").trim();
      const path = getFormValue(formData, "path").trim();
      const description = getFormValue(formData, "description").trim();

      if (!(name && path)) {
        return redirectWithParams(c, {
          tab: "projects",
          error: "Project name and path are required",
        });
      }

      const settings = container.getSettings().get();
      const isAllowed = isPathWithinRoots(path, settings.projectRoots);
      if (!isAllowed) {
        return redirectWithParams(c, {
          tab: "projects",
          error: "Project path is not within allowed roots",
        });
      }

      const project = container.getProjects().create({
        name,
        path,
        description: description || null,
        tags: [],
        favorite: false,
      });

      container.getEventBus().publish({
        type: "dashboard_refresh",
        reason: "project_created",
        projectId: project.id,
      });

      return redirectWithParams(c, {
        tab: "projects",
        notice: "Project added.",
      });
    } catch (error) {
      console.error("Failed to create project:", error);
      return redirectWithParams(c, {
        tab: "projects",
        error: "Failed to create project",
      });
    }
  });

  // Delete a project
  app.delete("/api/projects", async (c: Context) => {
    try {
      const body = await c.req.parseBody();
      const projectId = body.projectId as string;

      if (!projectId) {
        return c.json({ error: "projectId is required" }, 400);
      }

      container.getProjects().delete(projectId);
      container.getEventBus().publish({
        type: "dashboard_refresh",
        reason: "project_deleted",
        projectId,
      });

      return c.json({ ok: true });
    } catch (error) {
      console.error("Failed to delete project:", error);
      return c.json({ error: "Failed to delete project" }, 500);
    }
  });

  // ============================================================================
  // AGENTS API
  // ============================================================================

  // List all agent configs
  app.get("/api/agents", (c: Context) => {
    const agents = container.getAgents().findAll();
    return c.json({ agents });
  });

  // Create a new agent config
  app.post("/api/agents", async (c: Context) => {
    try {
      const body = await c.req.json();
      const { name, type, command, args, env, projectId } = body as {
        name: string;
        type: "claude" | "codex" | "opencode" | "gemini" | "other";
        command: string;
        args?: string[];
        env?: Record<string, string>;
        projectId?: string | null;
      };

      if (!(name && type && command)) {
        return c.json({ error: "name, type, and command are required" }, 400);
      }

      const validTypes = ["claude", "codex", "opencode", "gemini", "other"];
      if (!validTypes.includes(type)) {
        return c.json(
          { error: `type must be one of: ${validTypes.join(", ")}` },
          400
        );
      }

      const agent = container.getAgents().create({
        name,
        type,
        command,
        args,
        env,
        projectId,
      });

      container.getEventBus().publish({
        type: "dashboard_refresh",
        reason: "agent_created",
        agentId: agent.id,
      });

      return c.json({ ok: true, agent });
    } catch (error) {
      console.error("Failed to create agent:", error);
      return c.json({ error: "Failed to create agent" }, 500);
    }
  });

  // UI form: create agent config
  app.post("/form/agents/create", async (c: Context) => {
    try {
      const body = await c.req.parseBody();
      const formData = body as FormDataRecord;
      const name = getFormValue(formData, "name").trim();
      const type = getFormValue(formData, "type").trim() as
        | "claude"
        | "codex"
        | "opencode"
        | "gemini"
        | "other";
      const command = getFormValue(formData, "command").trim();
      const argsInput = getFormValue(formData, "args");
      const projectId = getFormValue(formData, "projectId") || undefined;

      if (!(name && type && command)) {
        return redirectWithParams(c, {
          tab: "agents",
          error: "name, type, and command are required",
        });
      }

      const validTypes = ["claude", "codex", "opencode", "gemini", "other"];
      if (!validTypes.includes(type)) {
        return redirectWithParams(c, {
          tab: "agents",
          error: `type must be one of: ${validTypes.join(", ")}`,
        });
      }

      const agent = container.getAgents().create({
        name,
        type,
        command,
        args: parseArgsInput(argsInput),
        projectId: projectId || null,
      });

      container.getEventBus().publish({
        type: "dashboard_refresh",
        reason: "agent_created",
        agentId: agent.id,
      });

      return redirectWithParams(c, { tab: "agents", notice: "Agent added." });
    } catch (error) {
      console.error("Failed to create agent:", error);
      return redirectWithParams(c, {
        tab: "agents",
        error: "Failed to create agent",
      });
    }
  });

  // Update an agent config
  app.put("/api/agents", async (c: Context) => {
    try {
      const body = await c.req.json();
      const { id, name, type, command, args, env, projectId } = body as {
        id: string;
        name?: string;
        type?: "claude" | "codex" | "opencode" | "gemini" | "other";
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        projectId?: string | null;
      };

      if (!id) {
        return c.json({ error: "id is required" }, 400);
      }

      const existing = container.getAgents().findById(id);
      if (!existing) {
        return c.json({ error: "Agent not found" }, 404);
      }

      if (type) {
        const validTypes = ["claude", "codex", "opencode", "gemini", "other"];
        if (!validTypes.includes(type)) {
          return c.json(
            { error: `type must be one of: ${validTypes.join(", ")}` },
            400
          );
        }
      }

      const agent = container.getAgents().update({
        id,
        name,
        type,
        command,
        args,
        env,
        projectId,
      });

      container.getEventBus().publish({
        type: "dashboard_refresh",
        reason: "agent_updated",
        agentId: agent.id,
      });

      return c.json({ ok: true, agent });
    } catch (error) {
      console.error("Failed to update agent:", error);
      return c.json({ error: "Failed to update agent" }, 500);
    }
  });

  // UI form: update agent config
  app.post("/form/agents/update", async (c: Context) => {
    try {
      const body = await c.req.parseBody();
      const formData = body as FormDataRecord;
      const id = getFormValue(formData, "id");
      if (!id) {
        return redirectWithParams(c, {
          tab: "agents",
          error: "id is required",
        });
      }

      const existing = container.getAgents().findById(id);
      if (!existing) {
        return redirectWithParams(c, {
          tab: "agents",
          error: "Agent not found",
        });
      }

      const name = getFormValue(formData, "name") || undefined;
      const type = getFormValue(formData, "type") as
        | "claude"
        | "codex"
        | "opencode"
        | "gemini"
        | "other"
        | "";
      const command = getFormValue(formData, "command") || undefined;
      const argsInput = getFormValue(formData, "args");
      const projectId = getFormValue(formData, "projectId");

      const validTypes = ["claude", "codex", "opencode", "gemini", "other"];
      if (type && !validTypes.includes(type)) {
        return redirectWithParams(c, {
          tab: "agents",
          error: `type must be one of: ${validTypes.join(", ")}`,
        });
      }

      const agent = container.getAgents().update({
        id,
        name,
        type: type || undefined,
        command,
        args: argsInput ? parseArgsInput(argsInput) : undefined,
        projectId: projectId || undefined,
      });

      container.getEventBus().publish({
        type: "dashboard_refresh",
        reason: "agent_updated",
        agentId: agent.id,
      });

      return redirectWithParams(c, {
        tab: "agents",
        notice: "Agent updated.",
      });
    } catch (error) {
      console.error("Failed to update agent:", error);
      return redirectWithParams(c, {
        tab: "agents",
        error: "Failed to update agent",
      });
    }
  });

  // Delete an agent config
  app.delete("/api/agents", async (c: Context) => {
    try {
      const body = await c.req.parseBody();
      const agentId = body.agentId as string;

      if (!agentId) {
        return c.json({ error: "agentId is required" }, 400);
      }

      container.getAgents().delete(agentId);
      container.getEventBus().publish({
        type: "dashboard_refresh",
        reason: "agent_deleted",
        agentId,
      });

      return c.json({ ok: true });
    } catch (error) {
      console.error("Failed to delete agent:", error);
      return c.json({ error: "Failed to delete agent" }, 500);
    }
  });

  // UI form: delete agent config
  app.post("/form/agents/delete", async (c: Context) => {
    try {
      const body = await c.req.parseBody();
      const formData = body as FormDataRecord;
      const agentId = getFormValue(formData, "agentId");

      if (!agentId) {
        return redirectWithParams(c, {
          tab: "agents",
          error: "agentId is required",
        });
      }

      container.getAgents().delete(agentId);
      container.getEventBus().publish({
        type: "dashboard_refresh",
        reason: "agent_deleted",
        agentId,
      });

      return redirectWithParams(c, {
        tab: "agents",
        notice: "Agent deleted.",
      });
    } catch (error) {
      console.error("Failed to delete agent:", error);
      return redirectWithParams(c, {
        tab: "agents",
        error: "Failed to delete agent",
      });
    }
  });

  // ============================================================================
  // AUTH ADMIN API
  // ============================================================================

  app.get("/api/admin/api-keys", async (c: Context) => {
    try {
      const keys = await auth.api.listApiKeys({
        headers: c.req.raw.headers,
      });
      return c.json({ keys });
    } catch (error) {
      console.error("Failed to list API keys:", error);
      return c.json({ error: "Failed to list API keys" }, 500);
    }
  });

  app.post("/api/admin/api-keys", async (c: Context) => {
    try {
      const body = await c.req.json();
      const { name, prefix, expiresIn } = body as {
        name?: string;
        prefix?: string;
        expiresIn?: number;
      };

      const session = await auth.api.getSession({
        headers: c.req.raw.headers,
      });
      if (!session) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      const apiKey = await auth.api.createApiKey({
        body: {
          name,
          prefix,
          expiresIn,
          userId: session.user.id,
        },
      });

      return c.json({ apiKey });
    } catch (error) {
      console.error("Failed to create API key:", error);
      return c.json({ error: "Failed to create API key" }, 500);
    }
  });

  app.delete("/api/admin/api-keys", async (c: Context) => {
    try {
      const body = await c.req.json();
      const { keyId, id } = body as { keyId?: string; id?: string };
      const resolvedKeyId = keyId ?? id;
      if (!resolvedKeyId) {
        return c.json({ error: "keyId is required" }, 400);
      }

      const result = await auth.api.deleteApiKey({
        body: { keyId: resolvedKeyId },
        headers: c.req.raw.headers,
      });
      return c.json({ result });
    } catch (error) {
      console.error("Failed to delete API key:", error);
      return c.json({ error: "Failed to delete API key" }, 500);
    }
  });

  app.get("/api/admin/device-sessions", async (c: Context) => {
    try {
      const sessions = await auth.api.listDeviceSessions({
        headers: c.req.raw.headers,
      });
      return c.json({ sessions });
    } catch (error) {
      console.error("Failed to list device sessions:", error);
      return c.json({ error: "Failed to list device sessions" }, 500);
    }
  });

  app.post("/api/admin/device-sessions/revoke", async (c: Context) => {
    try {
      const body = await c.req.json();
      const { sessionToken } = body as { sessionToken?: string };
      if (!sessionToken) {
        return c.json({ error: "sessionToken is required" }, 400);
      }

      const result = await auth.api.revokeDeviceSession({
        body: { sessionToken },
        headers: c.req.raw.headers,
      });
      return c.json({ result });
    } catch (error) {
      console.error("Failed to revoke device session:", error);
      return c.json({ error: "Failed to revoke device session" }, 500);
    }
  });

  app.post("/api/admin/device-sessions/activate", async (c: Context) => {
    try {
      const body = await c.req.json();
      const { sessionToken } = body as { sessionToken?: string };
      if (!sessionToken) {
        return c.json({ error: "sessionToken is required" }, 400);
      }

      const result = await auth.api.setActiveSession({
        body: { sessionToken },
        headers: c.req.raw.headers,
      });
      return c.json({ session: result });
    } catch (error) {
      console.error("Failed to set active session:", error);
      return c.json({ error: "Failed to set active session" }, 500);
    }
  });

  // UI form: create/revoke API keys and manage device sessions
  app.post("/form/admin/api-keys/create", async (c: Context) => {
    try {
      const session = await getSessionFromRequest({
        headers: c.req.raw.headers,
        url: c.req.raw.url,
      });
      if (!session) {
        return c.redirect("/login");
      }

      const body = await c.req.parseBody();
      const formData = body as FormDataRecord;
      const name = getFormValue(formData, "name").trim();
      const prefix = getFormValue(formData, "prefix").trim();
      const expiresInDays = Number(
        getFormValue(formData, "expiresInDays") || 0
      );
      const expiresIn =
        Number.isFinite(expiresInDays) && expiresInDays > 0
          ? Math.round(expiresInDays * 86_400)
          : undefined;

      const created = (await auth.api.createApiKey({
        body: {
          name: name || undefined,
          prefix: prefix || undefined,
          expiresIn,
          userId: session.user.id,
        },
      })) as ApiKeyCreateResponse;

      const apiKeys = await auth.api.listApiKeys({
        headers: c.req.raw.headers,
      });
      const deviceSessions = await auth.api.listDeviceSessions({
        headers: c.req.raw.headers,
      });

      const dashboardData = buildDashboardData({
        projects: container.getProjects().findAll(),
        sessions: container.getSessions().findAll(),
        runtimeSessions: container.getSessionRuntime(),
        agents: container.getAgents().findAll(),
        apiKeys: Array.isArray(apiKeys) ? apiKeys : [],
        deviceSessions: Array.isArray(deviceSessions) ? deviceSessions : [],
      });

      const html = `<!DOCTYPE html>${ConfigPage({
        settings: container.getSettings().get(),
        dashboardData,
        activeTab: "auth",
        notice: "API key created.",
        createdApiKey: created,
      })}`;
      return c.html(html);
    } catch (error) {
      console.error("Failed to create API key:", error);
      return redirectWithParams(c, {
        tab: "auth",
        error: "Failed to create API key",
      });
    }
  });

  app.post("/form/admin/api-keys/delete", async (c: Context) => {
    try {
      const body = await c.req.parseBody();
      const formData = body as FormDataRecord;
      const keyId = getFormValue(formData, "keyId");
      if (!keyId) {
        return redirectWithParams(c, {
          tab: "auth",
          error: "keyId is required",
        });
      }

      await auth.api.deleteApiKey({
        body: { keyId },
        headers: c.req.raw.headers,
      });

      return redirectWithParams(c, {
        tab: "auth",
        notice: "API key revoked.",
      });
    } catch (error) {
      console.error("Failed to delete API key:", error);
      return redirectWithParams(c, {
        tab: "auth",
        error: "Failed to revoke API key",
      });
    }
  });

  app.post("/form/admin/device-sessions/revoke", async (c: Context) => {
    try {
      const body = await c.req.parseBody();
      const formData = body as FormDataRecord;
      const sessionToken = getFormValue(formData, "sessionToken");
      if (!sessionToken) {
        return redirectWithParams(c, {
          tab: "auth",
          error: "sessionToken is required",
        });
      }

      await auth.api.revokeDeviceSession({
        body: { sessionToken },
        headers: c.req.raw.headers,
      });

      return redirectWithParams(c, {
        tab: "auth",
        notice: "Device session revoked.",
      });
    } catch (error) {
      console.error("Failed to revoke device session:", error);
      return redirectWithParams(c, {
        tab: "auth",
        error: "Failed to revoke device session",
      });
    }
  });

  app.post("/form/admin/device-sessions/activate", async (c: Context) => {
    try {
      const body = await c.req.parseBody();
      const formData = body as FormDataRecord;
      const sessionToken = getFormValue(formData, "sessionToken");
      if (!sessionToken) {
        return redirectWithParams(c, {
          tab: "auth",
          error: "sessionToken is required",
        });
      }

      await auth.api.setActiveSession({
        body: { sessionToken },
        headers: c.req.raw.headers,
      });

      return redirectWithParams(c, {
        tab: "auth",
        notice: "Device session activated.",
      });
    } catch (error) {
      console.error("Failed to set active session:", error);
      return redirectWithParams(c, {
        tab: "auth",
        error: "Failed to activate device session",
      });
    }
  });
}

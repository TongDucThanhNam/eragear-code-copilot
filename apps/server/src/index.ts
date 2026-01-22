import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { ENV } from "./config/environment";
import { getSettings, updateSettings } from "./config/settings";
import { listProjects } from "./projects/storage";
import { chats } from "./session/events";
import { loadSessions } from "./session/storage";
import { appRouter } from "./trpc/router";
import { ConfigPage } from "./ui/config";
import { createTrpcWebsocketServer } from "./websocket/adapter";
import { attachWebsocketHandlers } from "./websocket/handler";

const app = new Hono();
app.use(logger());

app.get("/api/ui-settings", (c) => {
  return c.json(getSettings());
});

app.all("/api/ui-settings", async (c) => {
  if (c.req.method === "PUT" || c.req.method === "POST") {
    try {
      const body = await c.req.parseBody();
      const settings = getSettings();

      // Cast body to Record for easier access
      const formData = body as Record<string, string | File | undefined>;

      // Parse nested values from form
      const getString = (key: string): string => {
        const value = formData[key];
        return typeof value === "string" ? value : "";
      };

      const ui: typeof settings.ui = {
        theme: (getString("ui.theme") || settings.ui.theme) as
          | "light"
          | "dark"
          | "system",
        accentColor: getString("ui.accentColor") || settings.ui.accentColor,
        density: (getString("ui.density") || settings.ui.density) as
          | "comfortable"
          | "compact",
        fontScale:
          Number.parseFloat(getString("ui.fontScale")) || settings.ui.fontScale,
      };

      // Parse project roots from form
      const projectRoots: string[] = [];
      const newRoot = getString("newRoot").trim();

      // Collect existing roots from form submissions
      for (const key of Object.keys(formData)) {
        if (key.startsWith("projectRoots[")) {
          const value = formData[key];
          if (typeof value === "string") {
            projectRoots.push(value);
          }
        }
      }

      // Add new root if provided and not already in list
      if (newRoot && !projectRoots.includes(newRoot)) {
        projectRoots.push(newRoot);
      }

      const next = updateSettings({ ui, projectRoots });
      return c.json(next);
    } catch (error) {
      console.error("Settings parse error:", error);
      return c.json({ error: "Failed to parse settings" }, 400);
    }
  }
  return c.json({ error: "Method not allowed" }, 405);
});

// Dashboard API endpoints
app.get("/api/dashboard/projects", (c) => {
  const { projects } = listProjects();
  const sessions = loadSessions();

  // Calculate session counts per project
  const projectsWithStats = projects.map((project) => {
    const projectSessions = sessions.filter(
      (s) => s.projectId === project.id || s.projectRoot === project.path
    );
    const runningSessions = projectSessions.filter((s) => s.status === "running");
    return {
      ...project,
      sessionCount: projectSessions.length,
      runningCount: runningSessions.length,
      lastOpenedAt: project.lastOpenedAt,
    };
  });

  return c.json({ projects: projectsWithStats });
});

app.get("/api/dashboard/sessions", (c) => {
  const { projects } = listProjects();
  const storedSessions = loadSessions();

  const sessions = storedSessions.map((session) => {
    const activeSession = chats.get(session.id);
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

  // Sort by lastActiveAt descending
  sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt);

  return c.json({ sessions });
});

app.get("/api/dashboard/stats", (c) => {
  const { projects } = listProjects();
  const sessions = loadSessions();

  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const recentSessions = sessions.filter((s) => s.lastActiveAt > oneDayAgo);
  const weeklySessions = sessions.filter((s) => s.lastActiveAt > oneWeekAgo);

  // Count running sessions from storage (more reliable than in-memory)
  const runningSessions = sessions.filter((s) => s.status === "running");

  // Group by agent
  const agentStats: Record<string, { count: number; running: number }> = {};
  for (const session of sessions) {
    const agentName = session.agentInfo?.title ?? session.agentInfo?.name ?? "Unknown";
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

// Session management endpoints
app.post("/api/sessions/stop", async (c) => {
  const body = await c.req.parseBody();
  const chatId = body.chatId as string;

  if (!chatId) {
    return c.json({ error: "chatId is required" }, 400);
  }

  const session = chats.get(chatId);
  if (session) {
    console.log(`[API] Stopping session ${chatId}`);
    // Update status FIRST, then kill process (which removes from chats)
    const { updateSessionStatus } = await import("./session/storage");
    updateSessionStatus(chatId, "stopped");
    session.proc.kill();
  }

  return c.json({ ok: true });
});

app.delete("/api/sessions", async (c) => {
  const body = await c.req.parseBody();
  const chatId = body.chatId as string;

  if (!chatId) {
    return c.json({ error: "chatId is required" }, 400);
  }

  const session = chats.get(chatId);
  if (session) {
    console.log(`[API] Deleting session ${chatId}`);
    session.proc.kill();
    chats.delete(chatId);
  }

  // Delete stored session
  const { deleteSession } = await import("./session/storage");
  deleteSession(chatId);

  return c.json({ ok: true });
});

app.get("/", (c) => {
  const html = `<!DOCTYPE html>${ConfigPage({
    settings: getSettings(),
  })}`;
  return c.html(html);
});

// Combined HTTP + WebSocket server on port 3000
const server = createServer(getRequestListener(app.fetch));
const { wss, handler } = createTrpcWebsocketServer(appRouter);

attachWebsocketHandlers(server, wss);

server.listen(ENV.wsPort, ENV.wsHost, () => {
  console.log(
    `[Server] HTTP UI + WebSocket running on http://${ENV.wsHost}:${ENV.wsPort}`
  );
});

process.on("SIGTERM", () => {
  handler.broadcastReconnectNotification();
  wss.close();
  server.close();
});

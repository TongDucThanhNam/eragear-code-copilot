// HTTP routes - dashboard and settings
import type { Context, Hono } from "hono";
import { getContainer } from "../../bootstrap/container";

export function registerHttpRoutes(app: Hono) {
  const container = getContainer();

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
        const settings = container.getSettings().get();

        const formData = body as Record<string, string | File | undefined>;

        const getString = (key: string): string => {
          const value = formData[key];
          return typeof value === "string" ? value : "";
        };

        const ui = {
          theme: (getString("ui.theme") || settings.ui.theme) as
            | "light"
            | "dark"
            | "system",
          accentColor: getString("ui.accentColor") || settings.ui.accentColor,
          density: (getString("ui.density") || settings.ui.density) as
            | "comfortable"
            | "compact",
          fontScale:
            Number.parseFloat(getString("ui.fontScale")) ||
            settings.ui.fontScale,
        };

        const projectRoots: string[] = [];
        const newRoot = getString("newRoot").trim();

        for (const key of Object.keys(formData)) {
          if (key.startsWith("projectRoots[")) {
            const value = formData[key];
            if (typeof value === "string") {
              projectRoots.push(value);
            }
          }
        }

        if (newRoot && !projectRoots.includes(newRoot)) {
          projectRoots.push(newRoot);
        }

        const next = container.getSettings().update({ ui, projectRoots });
        return c.json(next);
      } catch (error) {
        console.error("Settings parse error:", error);
        return c.json({ error: "Failed to parse settings" }, 400);
      }
    }
    return c.json({ error: "Method not allowed" }, 405);
  });

  // Dashboard endpoints
  app.get("/api/dashboard/projects", (c: Context) => {
    const projects = container.getProjects().findAll();
    const sessions = container.getSessions().findAll();

    const projectsWithStats = projects.map((project: any) => {
      const projectSessions = sessions.filter(
        (s: any) => s.projectId === project.id || s.projectRoot === project.path
      );
      const runningSessions = projectSessions.filter(
        (s: any) => s.status === "running"
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

    const sessions = storedSessions.map((session: any) => {
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

    sessions.sort((a: any, b: any) => b.lastActiveAt - a.lastActiveAt);
    return c.json({ sessions });
  });

  app.get("/api/dashboard/stats", (c: Context) => {
    const projects = container.getProjects().findAll();
    const sessions = container.getSessions().findAll();

    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

    const recentSessions = sessions.filter(
      (s: any) => s.lastActiveAt > oneDayAgo
    );
    const weeklySessions = sessions.filter(
      (s: any) => s.lastActiveAt > oneWeekAgo
    );
    const runningSessions = sessions.filter((s: any) => s.status === "running");

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

  app.post("/api/sessions/stop", async (c: Context) => {
    const body = await c.req.parseBody();
    const chatId = body.chatId as string;

    if (!chatId) {
      return c.json({ error: "chatId is required" }, 400);
    }

    const runtime = container.getSessionRuntime();
    const session = runtime.get(chatId);
    if (session) {
      console.log(`[API] Stopping session ${chatId}`);
      container.getSessions().updateStatus(chatId, "stopped");
      session.proc.kill();
    }

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
      session.proc.kill();
      runtime.delete(chatId);
    }

    container.getSessions().delete(chatId);
    return c.json({ ok: true });
  });
}

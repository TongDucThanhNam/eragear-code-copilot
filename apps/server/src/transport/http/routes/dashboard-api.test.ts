import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { DashboardEventVisibilityService } from "@/modules/ops/application/dashboard-event-visibility.service";
import type { OpsServiceFactory } from "@/modules/service-factories";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { LogStorePort } from "@/shared/ports/log-store.port";
import type { LogEntry, LogQuery } from "@/shared/types/log.types";
import { matchesLogQuery } from "@/shared/utils/log-query.util";
import { registerDashboardApiRoutes } from "./dashboard-api";
import type { HttpRouteDependencies } from "./deps";

function createOpsServices(): OpsServiceFactory {
  return {
    dashboardEventVisibility: () => new DashboardEventVisibilityService(),
    observabilitySnapshot: () => ({
      execute: async (userId: string) => ({ memory: { used: 1 }, userId }),
    }),
    dashboardProjects: () => ({
      execute: async () => [],
    }),
    dashboardSessions: () => ({
      execute: async () => ({ items: [], total: 0 }),
    }),
    dashboardStats: () => ({
      execute: async () => ({ projects: 0, sessions: 0 }),
    }),
    dashboardPageData: () => ({
      execute: async () => ({ ok: true }),
    }),
  } as unknown as OpsServiceFactory;
}

function createLogStore(params?: {
  onSubscribe?: (listener: (entry: unknown) => void) => () => void;
  onQuery?: (query?: LogQuery) => Promise<{
    entries: LogEntry[];
    stats: {
      total: number;
      levels: {
        debug: number;
        info: number;
        warn: number;
        error: number;
      };
    };
  }>;
}): LogStorePort {
  const list = (_query?: LogQuery) => ({
    entries: [],
    stats: {
      total: 0,
      levels: {
        debug: 0,
        info: 0,
        warn: 0,
        error: 0,
      },
    },
  });

  return {
    append() {
      return undefined;
    },
    list,
    query(query?: LogQuery) {
      return params?.onQuery?.(query) ?? Promise.resolve(list(query));
    },
    subscribe(listener) {
      return (
        params?.onSubscribe?.(listener as (entry: unknown) => void) ??
        (() => undefined)
      );
    },
    flush() {
      return Promise.resolve();
    },
  };
}

function createEventBus(params?: {
  onSubscribe?: (listener: (event: unknown) => void) => () => void;
}): EventBusPort {
  return {
    subscribe(listener) {
      return (
        params?.onSubscribe?.(listener as (event: unknown) => void) ??
        (() => undefined)
      );
    },
    publish() {
      return Promise.resolve();
    },
  };
}

function createApp(params?: {
  userId?: string | null;
  logStore?: LogStorePort;
  eventBus?: EventBusPort;
}) {
  const app = new Hono();
  const api = new Hono();

  registerDashboardApiRoutes(api, {
    eventBus: params?.eventBus ?? createEventBus(),
    logStore: params?.logStore ?? createLogStore(),
    opsServices: createOpsServices(),
    appConfig: {
      getConfig: () => ({
        sessionListPageMaxLimit: 100,
      }),
    } as HttpRouteDependencies["appConfig"],
    resolveAuthContext: async () =>
      params?.userId ? { userId: params.userId } : null,
  });

  app.route("/api", api);
  return app;
}

describe("registerDashboardApiRoutes auth hardening", () => {
  for (const pathname of [
    "/api/logs",
    "/api/logs/stream",
    "/api/dashboard/observability",
  ]) {
    test(`rejects anonymous access to ${pathname}`, async () => {
      const app = createApp({ userId: null });

      const response = await app.request(`http://localhost${pathname}`);

      expect(response.status).toBe(401);
    });
  }

  test("falls back to default pagination when session query params are invalid", async () => {
    const app = createApp({ userId: "user-1" });

    const response = await app.request(
      "http://localhost/api/dashboard/sessions?limit=oops&offset=-1"
    );

    expect(response.status).toBe(200);
  });

  test("queries persisted log history for /api/logs", async () => {
    let receivedQuery: LogQuery | undefined;
    const app = createApp({
      userId: "user-1",
      logStore: createLogStore({
        onQuery: (query) => {
          receivedQuery = query;
          return Promise.resolve({
            entries: [
              {
                id: "log-1",
                timestamp: 1_700_000_000_000,
                level: "info",
                message: "persisted history",
                userId: "user-1",
                meta: { worker: "sqlite" },
              },
            ],
            stats: {
              total: query?.from ? 1 : 0,
              levels: {
                debug: 0,
                info: 1,
                warn: 0,
                error: 0,
              },
            },
          });
        },
      }),
    });

    const response = await app.request(
      "http://localhost/api/logs?from=1699999999999"
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      entries: Array<{ message: string; meta?: { worker?: string } }>;
      stats: { total: number };
      now?: number;
    };
    expect(payload.stats.total).toBe(1);
    expect(payload.entries[0]?.message).toBe("persisted history");
    expect(payload.entries[0]?.meta?.worker).toBe("sqlite");
    expect(typeof payload.now).toBe("number");
    expect(receivedQuery?.userId).toBe("user-1");
  });

  test("excludes unowned system logs from authenticated queries", async () => {
    const app = createApp({
      userId: "user-1",
      logStore: createLogStore({
        onQuery: (query) => {
          const entries: LogEntry[] = [
            {
              id: "log-system",
              timestamp: 1_700_000_000_000,
              level: "info",
              message: "worker heartbeat",
            },
            {
              id: "log-user",
              timestamp: 1_700_000_000_001,
              level: "info",
              message: "request completed",
              userId: query?.userId,
            },
          ];

          return Promise.resolve({
            entries: entries.filter((entry) => matchesLogQuery(entry, query)),
            stats: {
              total: 2,
              levels: {
                debug: 0,
                info: 2,
                warn: 0,
                error: 0,
              },
            },
          });
        },
      }),
    });

    const response = await app.request("http://localhost/api/logs");

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      entries?: Array<{ id: string }>;
    };
    expect(payload.entries?.map((entry) => entry.id)).toEqual(["log-user"]);
  });

  test("passes authenticated userId into observability snapshot", async () => {
    const app = createApp({ userId: "user-1" });

    const response = await app.request(
      "http://localhost/api/dashboard/observability"
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      observability?: { userId?: string };
    };
    expect(payload.observability?.userId).toBe("user-1");
  });
});

describe("registerDashboardApiRoutes SSE lifecycle", () => {
  test("releases log subscribers when the client cancels the stream", async () => {
    let unsubscribeCalls = 0;
    const app = createApp({
      userId: "user-1",
      logStore: createLogStore({
        onSubscribe: () => () => {
          unsubscribeCalls += 1;
        },
      }),
    });

    const response = await app.request("http://localhost/api/logs/stream");
    const reader = response.body?.getReader();
    await reader?.read();
    await reader?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(unsubscribeCalls).toBe(1);
  });

  test("releases dashboard subscribers when the request aborts", async () => {
    let unsubscribeCalls = 0;
    const app = createApp({
      userId: "user-1",
      eventBus: createEventBus({
        onSubscribe: () => () => {
          unsubscribeCalls += 1;
        },
      }),
    });
    const abortController = new AbortController();

    const response = await app.request(
      new Request("http://localhost/api/dashboard/stream", {
        signal: abortController.signal,
      })
    );

    expect(response.status).toBe(200);

    abortController.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(unsubscribeCalls).toBe(1);
  });

  test("tears down log subscribers when the stream backpressures immediately", async () => {
    let unsubscribeCalls = 0;
    const app = createApp({
      userId: "user-1",
      logStore: createLogStore({
        onSubscribe: (listener) => {
          listener({
            id: "log-1",
            timestamp: 1_700_000_000_000,
            level: "info",
            message: "burst log",
            userId: "user-1",
          });
          return () => {
            unsubscribeCalls += 1;
          };
        },
      }),
    });

    const response = await app.request("http://localhost/api/logs/stream");
    const reader = response.body?.getReader();
    await reader?.read();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(unsubscribeCalls).toBe(1);
    await reader?.cancel();
  });

  test("tears down dashboard subscribers when the stream backpressures immediately", async () => {
    let unsubscribeCalls = 0;
    const app = createApp({
      userId: "user-1",
      eventBus: createEventBus({
        onSubscribe: (listener) => {
          listener({ type: "refresh" });
          return () => {
            unsubscribeCalls += 1;
          };
        },
      }),
    });

    const response = await app.request("http://localhost/api/dashboard/stream");
    const reader = response.body?.getReader();
    await reader?.read();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(unsubscribeCalls).toBe(1);
    await reader?.cancel();
  });

  test("returns 503 when dashboard stream initialization fails", async () => {
    const app = createApp({
      userId: "user-1",
      eventBus: {
        subscribe() {
          throw new Error("event bus unavailable");
        },
        publish() {
          return Promise.resolve();
        },
      },
    });

    const response = await app.request("http://localhost/api/dashboard/stream");

    expect(response.status).toBe(503);
    expect(await response.text()).toContain("Failed to initialize");
  });

  test("returns 503 when log stream initialization fails", async () => {
    const app = createApp({
      userId: "user-1",
      logStore: {
        append() {
          return undefined;
        },
        list() {
          return {
            entries: [],
            stats: {
              total: 0,
              levels: {
                debug: 0,
                info: 0,
                warn: 0,
                error: 0,
              },
            },
          };
        },
        query() {
          return Promise.resolve({
            entries: [],
            stats: {
              total: 0,
              levels: {
                debug: 0,
                info: 0,
                warn: 0,
                error: 0,
              },
            },
          });
        },
        subscribe() {
          throw new Error("log stream unavailable");
        },
        flush() {
          return Promise.resolve();
        },
      },
    });

    const response = await app.request("http://localhost/api/logs/stream");

    expect(response.status).toBe(503);
    expect(await response.text()).toContain("Failed to initialize");
  });
});

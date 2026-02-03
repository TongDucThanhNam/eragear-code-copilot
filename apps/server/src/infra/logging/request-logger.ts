import { performance } from "node:perf_hooks";
import type { MiddlewareHandler } from "hono";
import type { LogLevel } from "@/shared/types/log.types";
import { getLogger } from "./logger";

const IGNORE_PATH_PREFIXES = ["/api/logs", "/api/logs/stream"];

function shouldIgnorePath(path: string): boolean {
  return IGNORE_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function resolveLevel(status: number): LogLevel {
  if (status >= 500) {
    return "error";
  }
  if (status >= 400) {
    return "warn";
  }
  return "info";
}

export function createRequestLogger(): MiddlewareHandler {
  const logger = getLogger();

  return async (c, next) => {
    const start = performance.now();
    await next();
    const durationMs = Math.round(performance.now() - start);
    const path = c.req.path;

    if (c.req.method === "OPTIONS" || shouldIgnorePath(path)) {
      return;
    }

    const status = c.res.status;
    const level = resolveLevel(status);
    const host =
      c.req.header("x-forwarded-host") ?? c.req.header("host") ?? undefined;

    logger.log(level, `${c.req.method} ${path} ${durationMs}ms`, {
      source: "http",
      request: {
        method: c.req.method,
        path,
        status,
        host,
        durationMs,
      },
    });
  };
}

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { AppError } from "../../../shared/errors";
import type { LoggerPort } from "../../../shared/ports/logger.port";
import { JsonBodyParseError } from "./helpers";
import { respondToRouteError } from "./route-errors";

function createLogger() {
  const entries: unknown[] = [];
  const logger = {
    error(message: string, meta?: unknown) {
      entries.push({ message, meta });
    },
  } as unknown as LoggerPort;

  return { logger, entries };
}

async function runErrorResponse(
  error: unknown,
  params?: {
    fallbackStatus?: 400 | 500;
    exposeUnexpectedErrorMessage?: boolean;
  }
) {
  const { logger, entries } = createLogger();
  const app = new Hono();
  app.get("/", (c) =>
    respondToRouteError(c, error, {
      logger,
      logMessage: "Operation failed",
      fallbackMessage: "Fallback failure",
      fallbackStatus: params?.fallbackStatus ?? 500,
      exposeUnexpectedErrorMessage: params?.exposeUnexpectedErrorMessage,
    })
  );

  const response = await app.request("http://localhost/");
  return {
    response,
    payload: (await response.json()) as { error?: string },
    entries,
  };
}

describe("respondToRouteError", () => {
  test("returns JSON body parse errors with their parser status", async () => {
    const result = await runErrorResponse(
      new JsonBodyParseError("payload too large", 413)
    );

    expect(result.response.status).toBe(413);
    expect(result.payload.error).toBe("payload too large");
    expect(result.entries).toHaveLength(0);
  });

  test("returns application errors with their application status", async () => {
    const result = await runErrorResponse(
      new AppError({
        message: "already exists",
        code: "CONFLICT",
        statusCode: 409,
      })
    );

    expect(result.response.status).toBe(409);
    expect(result.payload.error).toBe("already exists");
    expect(result.entries).toHaveLength(0);
  });

  test("logs unexpected errors and hides them behind fallback response", async () => {
    const result = await runErrorResponse(new Error("database unavailable"));

    expect(result.response.status).toBe(500);
    expect(result.payload.error).toBe("Fallback failure");
    expect(result.entries).toEqual([
      { message: "Operation failed", meta: { error: "database unavailable" } },
    ]);
  });

  test("can expose unexpected Error messages for client-owned parse flows", async () => {
    const result = await runErrorResponse(new Error("invalid field"), {
      fallbackStatus: 400,
      exposeUnexpectedErrorMessage: true,
    });

    expect(result.response.status).toBe(400);
    expect(result.payload.error).toBe("invalid field");
    expect(result.entries).toEqual([
      { message: "Operation failed", meta: { error: "invalid field" } },
    ]);
  });
});

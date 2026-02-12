import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createErrorHandler } from "./error-handler";

function createApp(exposeInternalDetails: boolean) {
  const app = new Hono();
  app.get("/boom", () => {
    throw Object.assign(new Error("db unavailable at /var/lib/app"), {
      code: "INTERNAL_SERVER_ERROR",
      statusCode: 500,
      module: "session",
      op: "session.list",
    });
  });
  app.onError(createErrorHandler({ exposeInternalDetails }));
  return app;
}

describe("createErrorHandler", () => {
  test("returns sanitized production payload", async () => {
    const app = createApp(false);
    const response = await app.request("http://localhost/boom");
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(payload.error).toBe("Internal server error");
    expect(payload.code).toBe("INTERNAL_SERVER_ERROR");
    expect(payload.requestId).toBe("unknown");
    expect(typeof payload.timestamp).toBe("string");
    expect(payload.module).toBeUndefined();
    expect(payload.op).toBeUndefined();
    expect(payload.path).toBeUndefined();
  });

  test("returns debug payload when internal details are enabled", async () => {
    const app = createApp(true);
    const response = await app.request("http://localhost/boom");
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(payload.error).toBe("db unavailable at /var/lib/app");
    expect(payload.code).toBe("INTERNAL_SERVER_ERROR");
    expect(payload.module).toBe("session");
    expect(payload.op).toBe("session.list");
    expect(payload.path).toBe("/boom");
  });
});

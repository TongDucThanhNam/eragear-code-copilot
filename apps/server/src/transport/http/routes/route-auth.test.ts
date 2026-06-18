import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { HttpRouteDependencies } from "./deps";
import { requireRouteUserId, resolveRouteUserId } from "./route-auth";

describe("route auth helpers", () => {
  test("resolves user id from the route request context", async () => {
    let received:
      | Parameters<HttpRouteDependencies["resolveAuthContext"]>[0]
      | undefined;
    const app = new Hono();
    app.get("/", async (c) => {
      const userId = await resolveRouteUserId(c, (input) => {
        received = input;
        return Promise.resolve({ userId: "user-1" });
      });
      return c.json({ userId });
    });

    const response = await app.request("http://localhost/?from=test", {
      headers: {
        "x-eragear-remote-address": "127.0.0.1",
      },
    });
    const payload = (await response.json()) as { userId?: string };

    expect(payload.userId).toBe("user-1");
    expect(received?.headers).toBeInstanceOf(Headers);
    expect(received?.url).toBe("http://localhost/?from=test");
    expect(received?.remoteAddress).toBe("127.0.0.1");
  });

  test("returns the standard unauthorized response when auth is missing", async () => {
    const app = new Hono();
    app.get("/", async (c) => {
      const result = await requireRouteUserId(c, () => Promise.resolve(null));
      if (!result.ok) {
        return result.response;
      }
      return c.json({ userId: result.userId });
    });

    const response = await app.request("http://localhost/");
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(401);
    expect(payload.error).toBe("Unauthorized");
  });
});

import type { Context } from "hono";
import type { HttpRouteDependencies } from "./deps";

export type RouteUserIdResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

export async function resolveRouteUserId(
  c: Context,
  resolveAuthContext: HttpRouteDependencies["resolveAuthContext"]
): Promise<string | null> {
  const auth = await resolveAuthContext({
    headers: c.req.raw.headers,
    url: c.req.raw.url,
    remoteAddress: c.req.header("x-eragear-remote-address"),
  });
  return auth?.userId ?? null;
}

export async function requireRouteUserId(
  c: Context,
  resolveAuthContext: HttpRouteDependencies["resolveAuthContext"]
): Promise<RouteUserIdResult> {
  const userId = await resolveRouteUserId(c, resolveAuthContext);
  if (!userId) {
    return { ok: false, response: c.json({ error: "Unauthorized" }, 401) };
  }
  return { ok: true, userId };
}

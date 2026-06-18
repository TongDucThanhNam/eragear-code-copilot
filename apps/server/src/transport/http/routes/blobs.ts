import type { Context, Hono } from "hono";
// biome-ignore lint/style/noRestrictedImports: Blob storage access required for HTTP blob routes
import { readStoredBlobForUser } from "@/platform/storage/blob-store";
import {
  createBlobRouteHeaders,
  parseBlobRouteRequest,
} from "./blob-route-input";
import type { HttpRouteDependencies } from "./deps";
import { requireRouteUserId } from "./route-auth";

export function registerBlobRoutes(
  api: Hono,
  deps: Pick<HttpRouteDependencies, "resolveAuthContext">
): void {
  const { resolveAuthContext } = deps;

  api.get("/blobs/:blobId", async (c: Context) => {
    const auth = await requireRouteUserId(c, resolveAuthContext);
    if (!auth.ok) {
      return auth.response;
    }
    const request = parseBlobRouteRequest({
      blobId: c.req.param("blobId"),
      filename: c.req.query("filename"),
      download: c.req.query("download"),
    });
    if (!request.ok) {
      return c.json({ error: request.error }, 400);
    }

    const blob = await readStoredBlobForUser({
      blobId: request.input.blobId,
      userId: auth.userId,
    });
    if (!blob) {
      return c.json({ error: "Blob not found" }, 404);
    }

    return new Response(new Uint8Array(blob.payload), {
      status: 200,
      headers: createBlobRouteHeaders({
        request: request.input,
        storedBlobId: blob.metadata.id,
        storedMimeType: blob.metadata.mimeType,
        payloadLength: blob.payload.length,
      }),
    });
  });
}

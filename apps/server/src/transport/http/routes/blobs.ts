import path from "node:path";
import type { Context, Hono } from "hono";
// biome-ignore lint/style/noRestrictedImports: Blob storage access required for HTTP blob routes
import { readStoredBlobForUser } from "@/platform/storage/blob-store";
import type { HttpRouteDependencies } from "./deps";

const DOWNLOAD_TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function resolveFilename(input: {
  requested?: string;
  blobId: string;
  mimeType?: string;
}): string {
  if (input.requested && input.requested.trim().length > 0) {
    const base = path.basename(input.requested.trim());
    if (base && base !== "." && base !== "..") {
      return base;
    }
  }
  const extension = guessExtension(input.mimeType);
  return `${input.blobId}${extension}`;
}

function guessExtension(mimeType?: string): string {
  if (!mimeType) {
    return ".bin";
  }
  if (mimeType === "image/png") {
    return ".png";
  }
  if (mimeType === "image/jpeg") {
    return ".jpg";
  }
  if (mimeType === "image/webp") {
    return ".webp";
  }
  if (mimeType === "audio/wav") {
    return ".wav";
  }
  if (mimeType === "audio/mpeg") {
    return ".mp3";
  }
  if (mimeType === "application/pdf") {
    return ".pdf";
  }
  return ".bin";
}

function shouldDownload(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  return DOWNLOAD_TRUE_VALUES.has(value.trim().toLowerCase());
}

async function resolveUserId(
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

export function registerBlobRoutes(
  api: Hono,
  deps: Pick<HttpRouteDependencies, "resolveAuthContext">
): void {
  const { resolveAuthContext } = deps;

  api.get("/blobs/:blobId", async (c: Context) => {
    const userId = await resolveUserId(c, resolveAuthContext);
    if (!userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const blobId = c.req.param("blobId");
    if (!(typeof blobId === "string" && blobId.length > 0)) {
      return c.json({ error: "blobId is required" }, 400);
    }

    const blob = await readStoredBlobForUser({ blobId, userId });
    if (!blob) {
      return c.json({ error: "Blob not found" }, 404);
    }

    const mimeType =
      blob.metadata.mimeType && blob.metadata.mimeType.length > 0
        ? blob.metadata.mimeType
        : "application/octet-stream";
    const filename = resolveFilename({
      requested: c.req.query("filename"),
      blobId: blob.metadata.id,
      mimeType,
    });
    const dispositionType = shouldDownload(c.req.query("download"))
      ? "attachment"
      : "inline";

    return new Response(new Uint8Array(blob.payload), {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(blob.payload.length),
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `${dispositionType}; filename="${filename}"`,
      },
    });
  });
}

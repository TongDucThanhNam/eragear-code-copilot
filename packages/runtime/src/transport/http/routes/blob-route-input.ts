export type BlobRouteInputResult<T> =
  | { ok: true; input: T }
  | { ok: false; error: string };

export interface BlobRouteRequestInput {
  blobId: string;
  requestedFilename?: string;
  download: boolean;
}

export interface BlobRouteHeaderInput {
  request: BlobRouteRequestInput;
  storedBlobId: string;
  storedMimeType?: string | null;
  payloadLength: number;
}

const DOWNLOAD_TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

export function parseBlobRouteRequest(input: {
  blobId: unknown;
  filename?: string;
  download?: string;
}): BlobRouteInputResult<BlobRouteRequestInput> {
  if (!(typeof input.blobId === "string" && input.blobId.length > 0)) {
    return { ok: false, error: "blobId is required" };
  }

  return {
    ok: true,
    input: {
      blobId: input.blobId,
      requestedFilename: input.filename,
      download: shouldDownload(input.download),
    },
  };
}

export function createBlobRouteHeaders(
  input: BlobRouteHeaderInput
): Record<string, string> {
  const mimeType = normalizeMimeType(input.storedMimeType);
  const filename = resolveFilename({
    requested: input.request.requestedFilename,
    blobId: input.storedBlobId,
    mimeType,
  });
  const dispositionType = input.request.download ? "attachment" : "inline";

  return {
    "Content-Type": mimeType,
    "Content-Length": String(input.payloadLength),
    "Cache-Control": "private, max-age=3600",
    "Content-Disposition": `${dispositionType}; filename="${filename}"`,
  };
}

function normalizeMimeType(mimeType?: string | null): string {
  return mimeType && mimeType.length > 0
    ? mimeType
    : "application/octet-stream";
}

function resolveFilename(input: {
  requested?: string;
  blobId: string;
  mimeType: string;
}): string {
  const requested = sanitizeFilename(input.requested);
  if (requested) {
    return requested;
  }
  return `${sanitizeFilename(input.blobId) ?? "blob"}${guessExtension(
    input.mimeType
  )}`;
}

function sanitizeFilename(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const base = trimmed.replace(/\\/g, "/").split("/").filter(Boolean).at(-1);
  const safe = replaceUnsafeFilenameChars(base).trim();
  if (!(safe && safe !== "." && safe !== "..")) {
    return null;
  }
  return safe;
}

function replaceUnsafeFilenameChars(value: string | undefined): string {
  if (!value) {
    return "";
  }
  return Array.from(value)
    .map((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127 || char === '"' ? "_" : char;
    })
    .join("");
}

function guessExtension(mimeType: string): string {
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

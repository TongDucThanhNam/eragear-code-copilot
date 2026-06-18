/**
 * HTTP Route Helpers
 *
 * Shared utility functions for HTTP route handlers.
 * Provides request body parsing helpers.
 *
 * @module transport/http/routes/helpers
 */

const JSON_BODY_DECODER = new TextDecoder();

export class JsonBodyParseError extends Error {
  readonly statusCode: 400 | 413;

  constructor(message: string, statusCode: 400 | 413) {
    super(message);
    this.name = "JsonBodyParseError";
    this.statusCode = statusCode;
  }
}

export function isJsonBodyParseError(
  error: unknown
): error is JsonBodyParseError {
  return error instanceof JsonBodyParseError;
}

function parseContentLengthHeader(contentLength: string | null): number | null {
  if (!contentLength) {
    return null;
  }
  const parsed = Number(contentLength);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.trunc(parsed);
}

async function readBodyUtf8WithLimit(
  request: Request,
  maxBodyBytes: number
): Promise<string> {
  const normalizedMaxBodyBytes = Math.max(1, Math.trunc(maxBodyBytes));
  const contentLength = parseContentLengthHeader(
    request.headers.get("content-length")
  );
  if (
    typeof contentLength === "number" &&
    contentLength > normalizedMaxBodyBytes
  ) {
    throw new JsonBodyParseError(
      `Request payload exceeds limit (${contentLength} > ${normalizedMaxBodyBytes} bytes)`,
      413
    );
  }

  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.byteLength === 0) {
        continue;
      }
      totalBytes += value.byteLength;
      if (totalBytes > normalizedMaxBodyBytes) {
        throw new JsonBodyParseError(
          `Request payload exceeds limit (${totalBytes} > ${normalizedMaxBodyBytes} bytes)`,
          413
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON_BODY_DECODER.decode(merged);
}

export async function parseJsonBodyWithLimit<T>(
  request: Request,
  maxBodyBytes: number
): Promise<T> {
  const rawBody = await readBodyUtf8WithLimit(request, maxBodyBytes);
  if (rawBody.trim().length === 0) {
    throw new JsonBodyParseError("Request JSON body is required", 400);
  }

  try {
    return JSON.parse(rawBody) as T;
  } catch (error) {
    throw new JsonBodyParseError(
      `Invalid JSON payload: ${
        error instanceof Error ? error.message : String(error)
      }`,
      400
    );
  }
}

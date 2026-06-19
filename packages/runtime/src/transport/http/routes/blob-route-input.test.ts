import { describe, expect, test } from "bun:test";
import {
  createBlobRouteHeaders,
  parseBlobRouteRequest,
} from "./blob-route-input";

describe("blob route input", () => {
  test("parses blob route params and download query", () => {
    expect(
      parseBlobRouteRequest({
        blobId: "blob-1",
        filename: "report.pdf",
        download: "YES",
      })
    ).toEqual({
      ok: true,
      input: {
        blobId: "blob-1",
        requestedFilename: "report.pdf",
        download: true,
      },
    });
  });

  test("returns existing missing blob id error", () => {
    expect(parseBlobRouteRequest({ blobId: "" })).toEqual({
      ok: false,
      error: "blobId is required",
    });
  });

  test("creates inline blob headers with sanitized requested filename", () => {
    const request = parseBlobRouteRequest({
      blobId: "blob-1",
      filename: String.raw`nested\report".pdf`,
    });
    if (!request.ok) {
      throw new Error(request.error);
    }

    expect(
      createBlobRouteHeaders({
        request: request.input,
        storedBlobId: "stored-blob",
        storedMimeType: "application/pdf",
        payloadLength: 42,
      })
    ).toEqual({
      "Content-Type": "application/pdf",
      "Content-Length": "42",
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": 'inline; filename="report_.pdf"',
    });
  });

  test("falls back to stored blob id and MIME extension", () => {
    const request = parseBlobRouteRequest({
      blobId: "blob-1",
      filename: "../..",
      download: "true",
    });
    if (!request.ok) {
      throw new Error(request.error);
    }

    expect(
      createBlobRouteHeaders({
        request: request.input,
        storedBlobId: "stored-blob",
        storedMimeType: "image/jpeg",
        payloadLength: 8,
      })["Content-Disposition"]
    ).toBe('attachment; filename="stored-blob.jpg"');
  });

  test("uses octet-stream and .bin fallback when MIME type is missing", () => {
    const request = parseBlobRouteRequest({ blobId: "blob-1" });
    if (!request.ok) {
      throw new Error(request.error);
    }

    expect(
      createBlobRouteHeaders({
        request: request.input,
        storedBlobId: "stored-blob",
        storedMimeType: "",
        payloadLength: 1,
      })
    ).toMatchObject({
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'inline; filename="stored-blob.bin"',
    });
  });
});

import { describe, expect, test } from "bun:test";
import {
  createDashboardAssetRouteHeaders,
  parseDashboardAssetRouteRequest,
} from "./dashboard-asset-route-input";

describe("dashboard-asset-route-input", () => {
  test("parses a dashboard asset path into an asset name", () => {
    expect(
      parseDashboardAssetRouteRequest("/_/dashboard/assets/client.js")
    ).toEqual({
      ok: true,
      input: { assetName: "client.js" },
    });
  });

  test("rejects paths outside the dashboard asset prefix", () => {
    expect(parseDashboardAssetRouteRequest("/assets/client.js")).toEqual({
      ok: false,
      error: "Not found",
    });
  });

  test("rejects nested raw asset paths", () => {
    expect(
      parseDashboardAssetRouteRequest("/_/dashboard/assets/nested/client.js")
    ).toEqual({
      ok: false,
      error: "Not found",
    });
  });

  test("rejects encoded nested asset paths after decoding", () => {
    expect(
      parseDashboardAssetRouteRequest("/_/dashboard/assets/nested%2Fclient.js")
    ).toEqual({
      ok: false,
      error: "Not found",
    });
  });

  test("rejects malformed percent-encoded asset names", () => {
    expect(
      parseDashboardAssetRouteRequest("/_/dashboard/assets/%E0%A4%A")
    ).toEqual({
      ok: false,
      error: "Not found",
    });
  });

  test("creates immutable production headers for dashboard assets", () => {
    expect(
      createDashboardAssetRouteHeaders({
        assetName: "client.js",
        assetVersion: "abc123",
        contentType: "application/javascript",
        isDev: false,
      })
    ).toEqual({
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": "application/javascript",
      ETag: '"dashboard-client.js-abc123"',
    });
  });

  test("creates no-cache development headers for dashboard assets", () => {
    expect(
      createDashboardAssetRouteHeaders({
        assetName: "styles.css",
        assetVersion: "dev",
        contentType: "text/css",
        isDev: true,
      })["Cache-Control"]
    ).toBe("no-cache");
  });
});

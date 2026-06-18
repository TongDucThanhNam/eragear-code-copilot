import { DASHBOARD_ASSET_PATH_PREFIX } from "../constants";

export type DashboardAssetRouteInputResult<T> =
  | { ok: true; input: T }
  | { ok: false; error: "Not found" };

export interface DashboardAssetRouteRequest {
  assetName: string;
}

export interface DashboardAssetRouteHeaderInput {
  assetName: string;
  assetVersion: string;
  contentType: string;
  isDev: boolean;
}

export function parseDashboardAssetRouteRequest(
  path: string
): DashboardAssetRouteInputResult<DashboardAssetRouteRequest> {
  if (!DASHBOARD_ASSET_PATH_PREFIX.test(path)) {
    return { ok: false, error: "Not found" };
  }

  const rawName = path.replace(DASHBOARD_ASSET_PATH_PREFIX, "");
  if (!isSafeAssetName(rawName)) {
    return { ok: false, error: "Not found" };
  }

  try {
    const decoded = decodeURIComponent(rawName);
    if (!isSafeAssetName(decoded)) {
      return { ok: false, error: "Not found" };
    }
    return { ok: true, input: { assetName: decoded } };
  } catch {
    return { ok: false, error: "Not found" };
  }
}

export function createDashboardAssetRouteHeaders(
  input: DashboardAssetRouteHeaderInput
): Record<string, string> {
  return {
    "Cache-Control": input.isDev
      ? "no-cache"
      : "public, max-age=31536000, immutable",
    "Content-Type": input.contentType,
    ETag: `"dashboard-${input.assetName}-${input.assetVersion}"`,
  };
}

function isSafeAssetName(value: string): boolean {
  return Boolean(value) && !(value.includes("/") || value.includes("\\"));
}

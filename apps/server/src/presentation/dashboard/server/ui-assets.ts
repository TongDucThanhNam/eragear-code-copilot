import { statSync } from "node:fs";
import { join } from "node:path";
import {
  DASHBOARD_ASSET_PATH,
  PUBLIC_DASHBOARD_ASSETS_PATH,
} from "@/transport/http/constants";

export interface UiAssets {
  stylesHref: string;
  stylesEnhancedHref: string;
  clientEntry?: string;
}

const DASHBOARD_ASSET_FILES = [
  "styles.css",
  "styles-enhanced.css",
  "client.js",
  "login.css",
  "login.js",
] as const;

function getDashboardAssetVersion(): string {
  let latestMtimeMs = 0;
  for (const fileName of DASHBOARD_ASSET_FILES) {
    try {
      const { mtimeMs } = statSync(
        join(PUBLIC_DASHBOARD_ASSETS_PATH, fileName)
      );
      if (mtimeMs > latestMtimeMs) {
        latestMtimeMs = mtimeMs;
      }
    } catch {
      // Ignore missing files and keep scanning the known asset set.
    }
  }
  if (latestMtimeMs <= 0) {
    return "dev";
  }
  return Math.floor(latestMtimeMs).toString(36);
}

export function getUiAssets(): UiAssets {
  const assetVersion = getDashboardAssetVersion();
  return {
    stylesHref: `${DASHBOARD_ASSET_PATH}/styles.css?v=${assetVersion}`,
    stylesEnhancedHref: `${DASHBOARD_ASSET_PATH}/styles-enhanced.css?v=${assetVersion}`,
    clientEntry: `${DASHBOARD_ASSET_PATH}/client.js?v=${assetVersion}`,
  };
}

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import clientScriptPath from "../../../../public/dashboard/client.asset" with {
  type: "file",
};
import loginScriptPath from "../../../../public/dashboard/login.asset" with {
  type: "file",
};
import loginStylePath from "../../../../public/dashboard/login.css" with {
  type: "file",
};
import stylesPath from "../../../../public/dashboard/styles.css" with {
  type: "file",
};
import stylesEnhancedPath from "../../../../public/dashboard/styles-enhanced.css" with {
  type: "file",
};

export interface DashboardAsset {
  path: string;
  contentType: string;
  immutable: boolean;
}

const DASHBOARD_ASSETS = {
  "client.js": {
    path: clientScriptPath,
    contentType: "text/javascript; charset=utf-8",
    immutable: true,
  },
  "styles.css": {
    path: stylesPath,
    contentType: "text/css; charset=utf-8",
    immutable: true,
  },
  "styles-enhanced.css": {
    path: stylesEnhancedPath,
    contentType: "text/css; charset=utf-8",
    immutable: true,
  },
  "login.css": {
    path: loginStylePath,
    contentType: "text/css; charset=utf-8",
    immutable: true,
  },
  "login.js": {
    path: loginScriptPath,
    contentType: "text/javascript; charset=utf-8",
    immutable: true,
  },
} as const satisfies Record<string, DashboardAsset>;

export type DashboardAssetName = keyof typeof DASHBOARD_ASSETS;

const DASHBOARD_ASSET_NAMES = new Set<string>(Object.keys(DASHBOARD_ASSETS));
let dashboardAssetVersion: string | null = null;

function isDashboardAssetName(name: string): name is DashboardAssetName {
  return DASHBOARD_ASSET_NAMES.has(name);
}

export function getDashboardAsset(name: string): DashboardAsset | null {
  if (!isDashboardAssetName(name)) {
    return null;
  }
  return DASHBOARD_ASSETS[name];
}

export function getDashboardAssetVersion(): string {
  if (dashboardAssetVersion) {
    return dashboardAssetVersion;
  }

  const hash = createHash("sha256");
  let hasContent = false;
  for (const asset of Object.values(DASHBOARD_ASSETS)) {
    try {
      hash.update(readFileSync(asset.path));
      hasContent = true;
    } catch {
      try {
        hash.update(String(statSync(asset.path).mtimeMs));
        hasContent = true;
      } catch {
        // Keep scanning; missing assets produce the dev version below.
      }
    }
  }

  dashboardAssetVersion = hasContent ? hash.digest("hex").slice(0, 12) : "dev";
  return dashboardAssetVersion;
}

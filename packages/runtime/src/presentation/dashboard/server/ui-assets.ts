import { DASHBOARD_ASSET_PATH } from "#runtime/transport/http/constants";
import { getDashboardAssetVersion } from "./dashboard-assets";

export interface UiAssets {
  stylesHref: string;
  stylesEnhancedHref: string;
  clientEntry?: string;
}

export function getUiAssets(): UiAssets {
  const assetVersion = getDashboardAssetVersion();
  return {
    stylesHref: `${DASHBOARD_ASSET_PATH}/styles.css?v=${assetVersion}`,
    stylesEnhancedHref: `${DASHBOARD_ASSET_PATH}/styles-enhanced.css?v=${assetVersion}`,
    clientEntry: `${DASHBOARD_ASSET_PATH}/client.js?v=${assetVersion}`,
  };
}

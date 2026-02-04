import { DASHBOARD_ASSET_PATH } from "@/transport/http/constants";

export interface UiAssets {
  stylesHref: string;
  clientEntry?: string;
}

export function getUiAssets(): UiAssets {
  return {
    stylesHref: `${DASHBOARD_ASSET_PATH}/styles.css`,
    clientEntry: `${DASHBOARD_ASSET_PATH}/client.js`,
  };
}

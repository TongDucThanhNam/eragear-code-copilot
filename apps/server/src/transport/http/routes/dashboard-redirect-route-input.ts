import { DASHBOARD_UI_PATH } from "../constants";

export function createDashboardLegacyRedirectLocation(
  requestUrl: string | undefined
): string {
  const query = extractRawQuery(requestUrl);
  return query ? `${DASHBOARD_UI_PATH}?${query}` : DASHBOARD_UI_PATH;
}

function extractRawQuery(requestUrl: string | undefined): string {
  const url = requestUrl ?? "";
  const queryIndex = url.indexOf("?");
  if (queryIndex === -1) {
    return "";
  }
  return url.slice(queryIndex + 1).trim();
}

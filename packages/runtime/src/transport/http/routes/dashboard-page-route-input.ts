import type { TabKey } from "#runtime/presentation/dashboard/dashboard-data";
import type { DashboardErrors } from "#runtime/presentation/dashboard/dashboard-types";
import { normalizeTab } from "#runtime/presentation/dashboard/utils";

export type DashboardPageRouteQuery = Record<string, string | undefined>;

export interface DashboardPageRouteState {
  activeTab: TabKey;
  success: boolean;
  notice?: string;
  errors?: DashboardErrors;
  requiresRestart?: string[];
}

export function parseDashboardPageRouteState(
  query: DashboardPageRouteQuery
): DashboardPageRouteState {
  return {
    activeTab: normalizeTab(query.tab),
    success: query.success === "1",
    notice: query.notice || undefined,
    errors: query.error ? { general: query.error } : undefined,
    requiresRestart: parseRestartKeys(query.restart),
  };
}

function parseRestartKeys(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

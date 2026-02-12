import type { SessionServiceFactory } from "@/modules/service-factories";
import type { AuthRuntime } from "../platform/auth/auth";
import {
  type AuthBootstrapPolicy,
  ensureAuthSetup,
} from "../platform/auth/bootstrap";
import { ensureTenantOwnershipBackfill } from "../platform/storage/tenant-ownership";

export interface ServerStartupPolicy extends AuthBootstrapPolicy {}

export interface ServerStartupDependencies {
  authRuntime: AuthRuntime;
  sessionServices: SessionServiceFactory;
  policy: ServerStartupPolicy;
}

function resolvePrimaryAuthUserId(runtime: AuthRuntime): string | null {
  try {
    const row = runtime.authDb
      .prepare('SELECT id FROM "user" ORDER BY createdAt ASC LIMIT 1')
      .get() as { id?: string } | undefined;
    if (typeof row?.id !== "string") {
      return null;
    }
    const normalized = row.id.trim();
    return normalized.length > 0 ? normalized : null;
  } catch {
    return null;
  }
}

export async function prepareServerStartup(
  deps: ServerStartupDependencies
): Promise<void> {
  await ensureAuthSetup(deps.authRuntime, deps.policy);
  const primaryUserId = resolvePrimaryAuthUserId(deps.authRuntime);
  if (!primaryUserId) {
    throw new Error("Cannot start server: no auth user available");
  }
  await ensureTenantOwnershipBackfill(primaryUserId);
  await deps.sessionServices.reconcileSessionStatus().execute();
}

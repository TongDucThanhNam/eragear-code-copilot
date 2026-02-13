import { inArray, isNull } from "drizzle-orm";
import { createLogger } from "@/platform/logging/structured-logger";
import { getSqliteOrm, sqliteSchema } from "./sqlite-db";
import { SQLITE_SETTING_KEYS } from "./sqlite-store";
import { enqueueSqliteWrite } from "./sqlite-write-queue";

const logger = createLogger("Storage");

const USER_SCOPED_ACTIVE_KEYS = [
  SQLITE_SETTING_KEYS.activeProjectId,
  SQLITE_SETTING_KEYS.activeAgentId,
] as const;

export async function ensureTenantOwnershipBackfill(
  ownerUserId: string
): Promise<void> {
  const normalizedOwner = ownerUserId.trim();
  if (!normalizedOwner) {
    throw new Error(
      "Cannot backfill tenant ownership without a valid owner user id"
    );
  }

  await enqueueSqliteWrite("storage.tenant_ownership_backfill", async () => {
    const db = await getSqliteOrm();

    const legacyProjectCount = db
      .select({ id: sqliteSchema.projects.id })
      .from(sqliteSchema.projects)
      .where(isNull(sqliteSchema.projects.userId))
      .all().length;
    if (legacyProjectCount > 0) {
      db.update(sqliteSchema.projects)
        .set({ userId: normalizedOwner })
        .where(isNull(sqliteSchema.projects.userId))
        .run();
    }

    const legacyAgentCount = db
      .select({ id: sqliteSchema.agents.id })
      .from(sqliteSchema.agents)
      .where(isNull(sqliteSchema.agents.userId))
      .all().length;
    if (legacyAgentCount > 0) {
      db.update(sqliteSchema.agents)
        .set({ userId: normalizedOwner })
        .where(isNull(sqliteSchema.agents.userId))
        .run();
    }

    const legacySessionCount = db
      .select({ id: sqliteSchema.sessions.id })
      .from(sqliteSchema.sessions)
      .where(isNull(sqliteSchema.sessions.userId))
      .all().length;
    if (legacySessionCount > 0) {
      db.update(sqliteSchema.sessions)
        .set({ userId: normalizedOwner })
        .where(isNull(sqliteSchema.sessions.userId))
        .run();
    }

    const legacyActiveRows = db
      .select({
        key: sqliteSchema.appSettings.key,
        valueJson: sqliteSchema.appSettings.valueJson,
      })
      .from(sqliteSchema.appSettings)
      .where(
        inArray(sqliteSchema.appSettings.key, [...USER_SCOPED_ACTIVE_KEYS])
      )
      .all();

    for (const row of legacyActiveRows) {
      db.insert(sqliteSchema.userSettings)
        .values({
          userId: normalizedOwner,
          key: row.key,
          valueJson: row.valueJson,
        })
        .onConflictDoNothing()
        .run();
    }

    if (
      legacyProjectCount > 0 ||
      legacyAgentCount > 0 ||
      legacySessionCount > 0
    ) {
      logger.warn("Backfilled tenant ownership for legacy records", {
        ownerUserId: normalizedOwner,
        projects: legacyProjectCount,
        agents: legacyAgentCount,
        sessions: legacySessionCount,
      });
    }
  });
}

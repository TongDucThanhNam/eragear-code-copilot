import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import {
  agents,
  appMeta,
  appSettings,
  projects,
  sessionMessages,
  sessions,
  userSettings,
} from "./sqlite-schema";
import { closeSqliteDb, getSqliteDb } from "./sqlite-store";
import { stopSqliteWorker } from "./sqlite-worker-client";

const sqliteSchema = {
  appMeta,
  appSettings,
  userSettings,
  projects,
  agents,
  sessions,
  sessionMessages,
};

type SqliteOrmDb = BunSQLiteDatabase<typeof sqliteSchema>;

export async function getSqliteOrm(): Promise<SqliteOrmDb> {
  const db = await getSqliteDb();
  return drizzle({ client: db, schema: sqliteSchema });
}

export function resetSqliteOrmCache(): void {
  // No-op: ORM instances are no longer cached globally.
}

export async function closeSqliteStorage(): Promise<void> {
  await stopSqliteWorker();
  await closeSqliteDb();
}

export { sqliteSchema };

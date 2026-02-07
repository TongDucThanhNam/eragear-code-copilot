import type { Database } from "bun:sqlite";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import {
  agents,
  appMeta,
  appSettings,
  projects,
  sessionMessages,
  sessions,
} from "./sqlite-schema";
import { closeSqliteDb, getSqliteDb } from "./sqlite-store";
import { stopSqliteWorker } from "./sqlite-worker-client";

const sqliteSchema = {
  appMeta,
  appSettings,
  projects,
  agents,
  sessions,
  sessionMessages,
};

type SqliteOrmDb = BunSQLiteDatabase<typeof sqliteSchema>;

let sqliteClient: Database | null = null;
let sqliteOrm: SqliteOrmDb | null = null;

export async function getSqliteOrm(): Promise<SqliteOrmDb> {
  const db = await getSqliteDb();
  if (sqliteOrm && sqliteClient === db) {
    return sqliteOrm;
  }
  sqliteClient = db;
  sqliteOrm = drizzle({ client: db, schema: sqliteSchema });
  return sqliteOrm;
}

export function resetSqliteOrmCache(): void {
  sqliteClient = null;
  sqliteOrm = null;
}

export async function closeSqliteStorage(): Promise<void> {
  await stopSqliteWorker();
  await closeSqliteDb();
  resetSqliteOrmCache();
}

export { sqliteSchema };

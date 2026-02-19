import type { Database } from "bun:sqlite";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import {
  agents,
  appMeta,
  appSettings,
  projects,
  sessionEventOutbox,
  sessionMessages,
  sessions,
  userSettings,
} from "./sqlite-schema";
import {
  closeSqliteDb,
  getSqliteDb,
  runInSqliteTransaction,
} from "./sqlite-store";
import { stopSqliteWorker } from "./sqlite-worker-client";

const sqliteSchema = {
  appMeta,
  appSettings,
  userSettings,
  projects,
  agents,
  sessions,
  sessionMessages,
  sessionEventOutbox,
};

type SqliteOrmDb = BunSQLiteDatabase<typeof sqliteSchema>;

let sqliteOrmDb: SqliteOrmDb | null = null;
let sqliteOrmClient: Database | null = null;

function assertSingleSqliteClient(db: Database): void {
  if (!sqliteOrmClient || sqliteOrmClient === db) {
    return;
  }
  throw new Error(
    "[Storage] SQLite ORM client changed without resetting ORM cache. Multiple concurrent SQLite clients are not supported."
  );
}

function getOrCreateSqliteOrm(db: Database): SqliteOrmDb {
  if (!sqliteOrmDb) {
    sqliteOrmDb = drizzle({ client: db, schema: sqliteSchema });
    sqliteOrmClient = db;
    return sqliteOrmDb;
  }
  assertSingleSqliteClient(db);
  return sqliteOrmDb;
}

export async function getSqliteOrm(): Promise<SqliteOrmDb> {
  const db = await getSqliteDb();
  return getOrCreateSqliteOrm(db);
}

export async function withSqliteTransaction<T>(
  fn: (context: { orm: SqliteOrmDb; db: Database }) => T
): Promise<T> {
  const db = await getSqliteDb();
  const orm = getOrCreateSqliteOrm(db);
  return runInSqliteTransaction(db, () => fn({ orm, db }));
}

export function resetSqliteOrmCache(): void {
  sqliteOrmDb = null;
  sqliteOrmClient = null;
}

export async function closeSqliteStorage(): Promise<void> {
  await stopSqliteWorker();
  await closeSqliteDb();
  resetSqliteOrmCache();
}

export { sqliteSchema };

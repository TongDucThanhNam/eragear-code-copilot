import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  fromSqliteJsonWithSchema,
  runInSqliteTransaction,
  StorageTransactionError,
} from "./sqlite-store";

describe("sqlite-store helpers", () => {
  test("runInSqliteTransaction supports nested calls via savepoints", () => {
    const db = new Database(":memory:");
    try {
      db.exec("CREATE TABLE tx_test (id INTEGER PRIMARY KEY, value TEXT)");

      runInSqliteTransaction(db, () => {
        db.query("INSERT INTO tx_test (id, value) VALUES (?, ?)").run(1, "one");
        runInSqliteTransaction(db, () => {
          db.query("INSERT INTO tx_test (id, value) VALUES (?, ?)").run(
            2,
            "two"
          );
        });
      });

      const row = db.query("SELECT COUNT(*) AS count FROM tx_test").get() as {
        count: number;
      } | null;
      expect(Number(row?.count ?? 0)).toBe(2);
    } finally {
      db.close();
    }
  });

  test("runInSqliteTransaction rolls back only failed nested scope", () => {
    const db = new Database(":memory:");
    try {
      db.exec("CREATE TABLE tx_test (id INTEGER PRIMARY KEY, value TEXT)");

      runInSqliteTransaction(db, () => {
        db.query("INSERT INTO tx_test (id, value) VALUES (?, ?)").run(1, "one");

        let transactionError: unknown;
        try {
          runInSqliteTransaction(db, () => {
            db.query("INSERT INTO tx_test (id, value) VALUES (?, ?)").run(
              2,
              "two"
            );
            throw new Error("boom");
          });
        } catch (error) {
          transactionError = error;
        }
        expect(transactionError).toBeInstanceOf(StorageTransactionError);
        expect((transactionError as Error).cause).toBeInstanceOf(Error);
        expect(((transactionError as Error).cause as Error).message).toContain(
          "boom"
        );

        db.query("INSERT INTO tx_test (id, value) VALUES (?, ?)").run(
          3,
          "three"
        );
      });

      const rows = db
        .query("SELECT id FROM tx_test ORDER BY id ASC")
        .all() as Array<{ id: number }>;
      expect(rows.map((row) => row.id)).toEqual([1, 3]);
    } finally {
      db.close();
    }
  });

  test("fromSqliteJsonWithSchema falls back on malformed or invalid shape", () => {
    const schema = z.array(z.string());

    expect(
      fromSqliteJsonWithSchema(JSON.stringify(["a", "b"]), [], schema)
    ).toEqual(["a", "b"]);

    expect(
      fromSqliteJsonWithSchema(JSON.stringify({ value: "oops" }), [], schema)
    ).toEqual([]);

    expect(fromSqliteJsonWithSchema("not json", [], schema)).toEqual([]);
  });
});

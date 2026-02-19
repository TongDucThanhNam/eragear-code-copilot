import { describe, expect, test } from "bun:test";
import {
  isSqliteBusyError,
  isSqliteForeignKeyConstraint,
  unwrapSqliteError,
} from "./sqlite-errors";

describe("sqlite-errors helpers", () => {
  test("detects foreign key constraint by SQLite code", () => {
    const error = new Error("FOREIGN KEY constraint failed") as Error & {
      code?: string;
    };
    error.code = "SQLITE_CONSTRAINT_FOREIGNKEY";

    expect(isSqliteForeignKeyConstraint(error)).toBe(true);
    expect(unwrapSqliteError(error)).toEqual({
      code: "SQLITE_CONSTRAINT_FOREIGNKEY",
      errno: undefined,
    });
  });

  test("detects foreign key constraint by SQLite errno through nested cause", () => {
    const nested = new Error("foreign key failed") as Error & {
      errno?: number;
    };
    nested.errno = 787;
    const outer = new Error("outer");
    Object.assign(outer, { cause: nested });

    expect(isSqliteForeignKeyConstraint(outer)).toBe(true);
  });

  test("returns false for non-foreign-key constraint errors", () => {
    const error = new Error("UNIQUE constraint failed") as Error & {
      code?: string;
      errno?: number;
    };
    error.code = "SQLITE_CONSTRAINT_UNIQUE";
    error.errno = 2067;

    expect(isSqliteForeignKeyConstraint(error)).toBe(false);
  });

  test("detects SQLite busy errors by code and errno", () => {
    const error = new Error("database is locked") as Error & {
      code?: string;
      errno?: number;
    };
    error.code = "SQLITE_BUSY_TIMEOUT";
    error.errno = 5;

    expect(isSqliteBusyError(error)).toBe(true);
  });

  test("detects SQLite busy errors through nested causes", () => {
    const nested = new Error("database is locked");
    const outer = new Error("write failed");
    Object.assign(outer, { cause: nested });

    expect(isSqliteBusyError(outer)).toBe(true);
  });
});

const SQLITE_FOREIGN_KEY_CONSTRAINT_CODE = "SQLITE_CONSTRAINT_FOREIGNKEY";
const SQLITE_FOREIGN_KEY_CONSTRAINT_ERRNO = 787;
const SQLITE_UNIQUE_CONSTRAINT_CODE = "SQLITE_CONSTRAINT_UNIQUE";
const SQLITE_PRIMARY_KEY_CONSTRAINT_CODE = "SQLITE_CONSTRAINT_PRIMARYKEY";
const SQLITE_UNIQUE_CONSTRAINT_ERRNO = 2067;
const SQLITE_PRIMARY_KEY_CONSTRAINT_ERRNO = 1555;

interface ErrorLikeRecord {
  code?: unknown;
  errno?: unknown;
  cause?: unknown;
}

function toSqliteCode(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toSqliteErrno(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function collectErrorCandidates(error: unknown): Error[] {
  const out: Error[] = [];
  const queue: unknown[] = [error];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!(current instanceof Error)) {
      continue;
    }
    out.push(current);

    if (current instanceof AggregateError) {
      queue.push(...current.errors);
    }

    const maybeRecord = current as ErrorLikeRecord;
    if (maybeRecord.cause !== undefined) {
      queue.push(maybeRecord.cause);
    }
  }

  return out;
}

export function unwrapSqliteError(
  error: unknown
): { code?: string; errno?: number } | null {
  const errors = collectErrorCandidates(error);
  for (const candidate of errors) {
    const record = candidate as ErrorLikeRecord;
    const code = toSqliteCode(record.code);
    const errno = toSqliteErrno(record.errno);
    if (code || errno !== undefined) {
      return { code, errno };
    }
  }
  return null;
}

export function isSqliteForeignKeyConstraint(error: unknown): boolean {
  const sqliteError = unwrapSqliteError(error);
  if (sqliteError?.code === SQLITE_FOREIGN_KEY_CONSTRAINT_CODE) {
    return true;
  }
  if (sqliteError?.errno === SQLITE_FOREIGN_KEY_CONSTRAINT_ERRNO) {
    return true;
  }

  // Compatibility fallback in case some wrappers strip sqlite code/errno.
  for (const candidate of collectErrorCandidates(error)) {
    const text = `${candidate.name} ${candidate.message}`.toUpperCase();
    if (
      text.includes("SQLITE_CONSTRAINT_FOREIGNKEY") ||
      text.includes("FOREIGN KEY CONSTRAINT FAILED")
    ) {
      return true;
    }
  }

  return false;
}

export function isSqliteUniqueConstraint(error: unknown): boolean {
  const sqliteError = unwrapSqliteError(error);
  if (
    sqliteError?.code === SQLITE_UNIQUE_CONSTRAINT_CODE ||
    sqliteError?.code === SQLITE_PRIMARY_KEY_CONSTRAINT_CODE
  ) {
    return true;
  }
  if (
    sqliteError?.errno === SQLITE_UNIQUE_CONSTRAINT_ERRNO ||
    sqliteError?.errno === SQLITE_PRIMARY_KEY_CONSTRAINT_ERRNO
  ) {
    return true;
  }

  for (const candidate of collectErrorCandidates(error)) {
    const text = `${candidate.name} ${candidate.message}`.toUpperCase();
    if (
      text.includes("SQLITE_CONSTRAINT_UNIQUE") ||
      text.includes("SQLITE_CONSTRAINT_PRIMARYKEY") ||
      text.includes("UNIQUE CONSTRAINT FAILED")
    ) {
      return true;
    }
  }

  return false;
}

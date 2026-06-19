const MAX_CAUSE_DEPTH = 8;

function getErrorCause(error: unknown): unknown {
  if (typeof error !== "object" || error === null || !("cause" in error)) {
    return undefined;
  }
  return (error as { cause?: unknown }).cause;
}

export function getNodeErrnoCode(
  error: unknown
): NodeJS.ErrnoException["code"] | undefined {
  let cursor: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (
      typeof cursor === "object" &&
      cursor !== null &&
      "code" in cursor &&
      typeof (cursor as { code?: unknown }).code === "string"
    ) {
      return (cursor as NodeJS.ErrnoException).code;
    }
    cursor = getErrorCause(cursor);
    if (cursor === undefined) {
      return undefined;
    }
  }
  return undefined;
}

export function isNodeErrno(
  error: unknown,
  code: NodeJS.ErrnoException["code"]
): boolean {
  return getNodeErrnoCode(error) === code;
}

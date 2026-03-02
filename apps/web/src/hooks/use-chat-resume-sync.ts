import type {
  SessionConfigOption,
  SessionModelState,
  SessionModeState,
} from "@repo/shared";

/**
 * Canonical session load methods where runtime replay is expected to be the
 * authoritative source after resume.
 */
const RUNTIME_AUTHORITATIVE_LOAD_METHODS = new Set([
  "session_load",
  "unstable_resume",
]);

export interface ResumeSessionSyncPlan {
  alreadyRunning: boolean;
  sessionLoadMethod?: string | null;
  modes?: SessionModeState | null;
  models?: SessionModelState | null;
  configOptions?: SessionConfigOption[] | null;
  supportsModelSwitching?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function readOwnField<T>(
  value: Record<string, unknown>,
  key: string
): T | undefined {
  if (!Object.prototype.hasOwnProperty.call(value, key)) {
    return undefined;
  }
  return value[key] as T;
}

/**
 * Parse resume payload into a normalized shape that the client can apply
 * without depending on transport-specific implementation details.
 */
export function deriveResumeSessionSyncPlan(
  resumeResult: unknown
): ResumeSessionSyncPlan {
  const parsed = asRecord(resumeResult);
  if (!parsed) {
    return {
      alreadyRunning: false,
    };
  }

  const rawConfigOptions = readOwnField<unknown>(parsed, "configOptions");
  const configOptions = Array.isArray(rawConfigOptions)
    ? (rawConfigOptions as SessionConfigOption[])
    : rawConfigOptions === null
      ? null
      : undefined;

  const rawSupportsModelSwitching = readOwnField<unknown>(
    parsed,
    "supportsModelSwitching"
  );
  const supportsModelSwitching =
    typeof rawSupportsModelSwitching === "boolean"
      ? rawSupportsModelSwitching
      : undefined;
  const rawSessionLoadMethod = readOwnField<unknown>(
    parsed,
    "sessionLoadMethod"
  );
  const sessionLoadMethod =
    typeof rawSessionLoadMethod === "string"
      ? rawSessionLoadMethod
      : rawSessionLoadMethod === null
        ? null
        : undefined;

  return {
    alreadyRunning: readOwnField<boolean>(parsed, "alreadyRunning") === true,
    ...(sessionLoadMethod !== undefined ? { sessionLoadMethod } : {}),
    modes: readOwnField<SessionModeState | null>(parsed, "modes"),
    models: readOwnField<SessionModelState | null>(parsed, "models"),
    configOptions,
    supportsModelSwitching,
  };
}

/**
 * Determine whether message history should be treated as runtime-authoritative
 * after resume (running session replay or explicit ACP session load path).
 */
export function isRuntimeAuthoritativeHistory(
  plan: Pick<ResumeSessionSyncPlan, "alreadyRunning" | "sessionLoadMethod">
): boolean {
  if (plan.alreadyRunning) {
    return true;
  }
  if (!plan.sessionLoadMethod) {
    return false;
  }
  return RUNTIME_AUTHORITATIVE_LOAD_METHODS.has(plan.sessionLoadMethod);
}

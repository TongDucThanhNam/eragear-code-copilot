import type {
  SessionConfigOption,
  SessionModelState,
  SessionModeState,
} from "@repo/shared";

export interface ResumeSessionSyncPlan {
  alreadyRunning: boolean;
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

  return {
    alreadyRunning: readOwnField<boolean>(parsed, "alreadyRunning") === true,
    modes: readOwnField<SessionModeState | null>(parsed, "modes"),
    models: readOwnField<SessionModelState | null>(parsed, "models"),
    configOptions,
    supportsModelSwitching,
  };
}

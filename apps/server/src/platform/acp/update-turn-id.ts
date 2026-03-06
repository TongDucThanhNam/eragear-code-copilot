import type { SessionUpdate } from "./update-types";

const TURN_ID_MAX_LENGTH = 128;
const WHITESPACE_PATTERN = /\s/u;

function hasSafeTurnIdCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f || WHITESPACE_PATTERN.test(character)) {
      return false;
    }
  }
  return true;
}

export type TurnIdResolutionSource = "native" | "meta" | "missing";

export interface TurnIdResolution {
  source: TurnIdResolutionSource;
  turnId?: string;
}

export function sanitizeTurnId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > TURN_ID_MAX_LENGTH ||
    !hasSafeTurnIdCharacters(trimmed)
  ) {
    return undefined;
  }
  return trimmed;
}

export function readTurnIdFromMeta(meta: unknown): string | undefined {
  if (!meta || typeof meta !== "object") {
    return undefined;
  }
  const record = meta as Record<string, unknown>;
  const direct =
    sanitizeTurnId(record.turnId) ??
    sanitizeTurnId(record.turn_id) ??
    sanitizeTurnId(record["turn-id"]);
  if (direct) {
    return direct;
  }
  if (record.turn && typeof record.turn === "object") {
    const turnRecord = record.turn as Record<string, unknown>;
    return sanitizeTurnId(turnRecord.id);
  }
  return undefined;
}

function resolveTurnIdFromRecord(
  record: Record<string, unknown>
): TurnIdResolution {
  const nativeTurnId = sanitizeTurnId(record.turnId);
  if (nativeTurnId) {
    return {
      source: "native",
      turnId: nativeTurnId,
    };
  }

  const metaTurnId = readTurnIdFromMeta(record._meta);
  if (metaTurnId) {
    return {
      source: "meta",
      turnId: metaTurnId,
    };
  }

  return {
    source: "missing",
  };
}

export function resolveSessionUpdateTurnId(
  update: SessionUpdate
): TurnIdResolution {
  return resolveTurnIdFromRecord(update as unknown as Record<string, unknown>);
}

export function resolveToolCallTurnId(value: unknown): TurnIdResolution {
  if (!value || typeof value !== "object") {
    return {
      source: "missing",
    };
  }

  return resolveTurnIdFromRecord(value as Record<string, unknown>);
}

export function readSessionUpdateTurnId(
  update: SessionUpdate
): string | undefined {
  return resolveSessionUpdateTurnId(update).turnId;
}

export function readToolCallTurnId(value: unknown): string | undefined {
  return resolveToolCallTurnId(value).turnId;
}

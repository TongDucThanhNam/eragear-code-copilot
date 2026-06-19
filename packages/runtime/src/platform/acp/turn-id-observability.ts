import type { TurnIdResolutionSource } from "./update-turn-id";

export type TurnIdIngressChannel = "sessionUpdate" | "permissionRequest";
export type TurnIdDropReason =
  | "requireNativePolicy"
  | "staleTurnMismatch"
  | "lateAfterTurnCleared";

interface TurnIdResolutionCounters {
  native: number;
  metaFallback: number;
  missing: number;
}

export interface TurnIdMigrationSnapshot {
  sessionUpdates: TurnIdResolutionCounters;
  permissionRequests: TurnIdResolutionCounters;
  drops: Record<TurnIdDropReason, number>;
}

const zeroResolutionCounters = (): TurnIdResolutionCounters => ({
  native: 0,
  metaFallback: 0,
  missing: 0,
});

const zeroDropCounters = (): Record<TurnIdDropReason, number> => ({
  requireNativePolicy: 0,
  staleTurnMismatch: 0,
  lateAfterTurnCleared: 0,
});

const state: TurnIdMigrationSnapshot = {
  sessionUpdates: zeroResolutionCounters(),
  permissionRequests: zeroResolutionCounters(),
  drops: zeroDropCounters(),
};

function getResolutionCounters(
  channel: TurnIdIngressChannel
): TurnIdResolutionCounters {
  return channel === "sessionUpdate"
    ? state.sessionUpdates
    : state.permissionRequests;
}

export function recordTurnIdResolution(
  channel: TurnIdIngressChannel,
  source: TurnIdResolutionSource
): void {
  const counters = getResolutionCounters(channel);
  switch (source) {
    case "native":
      counters.native += 1;
      return;
    case "meta":
      counters.metaFallback += 1;
      return;
    case "missing":
      counters.missing += 1;
      return;
    default:
      return;
  }
}

export function recordTurnIdDrop(reason: TurnIdDropReason): void {
  state.drops[reason] += 1;
}

export function getTurnIdMigrationSnapshot(): TurnIdMigrationSnapshot {
  return {
    sessionUpdates: { ...state.sessionUpdates },
    permissionRequests: { ...state.permissionRequests },
    drops: { ...state.drops },
  };
}

export function resetTurnIdMigrationSnapshotForTests(): void {
  state.sessionUpdates = zeroResolutionCounters();
  state.permissionRequests = zeroResolutionCounters();
  state.drops = zeroDropCounters();
}

import type { SessionConfigOption } from "@/shared/types/session.types";

export interface SetConfigOptionResult {
  ok: true;
  configOptions: SessionConfigOption[];
}

export interface SetConfigOptionSessionState {
  configOptions?: SessionConfigOption[] | null;
}

export interface SetConfigOptionResponse {
  ok: true;
  configOptions: SessionConfigOption[];
}

export function createSetConfigOptionResponse(
  result: SetConfigOptionResult,
  sessionState: SetConfigOptionSessionState
): SetConfigOptionResponse {
  return {
    ...result,
    configOptions: sessionState.configOptions ?? [],
  };
}

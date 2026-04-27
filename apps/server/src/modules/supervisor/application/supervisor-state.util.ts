import type {
  SupervisorMode,
  SupervisorSessionState,
  SupervisorStatus,
} from "@/shared/types/supervisor.types";

export const DEFAULT_SUPERVISOR_STATE: SupervisorSessionState = {
  mode: "off",
  status: "idle",
};

const SUPERVISOR_MODES = new Set<SupervisorMode>(["off", "full_autopilot"]);
const SUPERVISOR_STATUSES = new Set<SupervisorStatus>([
  "idle",
  "queued",
  "reviewing",
  "continuing",
  "done",
  "needs_user",
  "aborted",
  "error",
  "disabled",
]);

export function normalizeSupervisorState(
  state: SupervisorSessionState | undefined
): SupervisorSessionState {
  if (!state) {
    return { ...DEFAULT_SUPERVISOR_STATE };
  }
  const mode = SUPERVISOR_MODES.has(state.mode) ? state.mode : "off";
  const status = SUPERVISOR_STATUSES.has(state.status) ? state.status : "idle";
  return {
    ...state,
    mode,
    status: mode === "off" ? "idle" : status,
  };
}

export function createSupervisorStatePatch(params: {
  current: SupervisorSessionState | undefined;
  mode?: SupervisorMode;
  status?: SupervisorStatus;
  now: number;
  reason?: string;
}): SupervisorSessionState {
  const current = normalizeSupervisorState(params.current);
  const mode = params.mode ?? current.mode;
  return {
    ...current,
    mode,
    status: mode === "off" ? "idle" : (params.status ?? current.status),
    reason: params.reason ?? current.reason,
    updatedAt: params.now,
  };
}

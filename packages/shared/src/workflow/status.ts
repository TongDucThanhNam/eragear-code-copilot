/**
 * Supervisos workflow display vocabulary.
 *
 * These are presentation semantics only. Canonical run facts stay in the
 * runtime; this module never adds states, schedules, or authority. UI
 * surfaces (Run Center, workspace, Mission Control summaries, chat rail,
 * future native/notification consumers) share one mapping so the same fact
 * never carries a different label, tone, or hint per surface.
 *
 * Kept UI-framework-independent: no React, no DOM, no timers.
 */

import type { SupervisorRunClientUpdate } from "../chat/types.js";

export type SupervisosRunClientStatus = SupervisorRunClientUpdate["status"];
export type SupervisosTaskClientStatus =
  SupervisorRunClientUpdate["tasks"][number]["status"];
export type SupervisosAttemptClientStatus =
  SupervisorRunClientUpdate["tasks"][number]["attempts"][number]["status"];
export type SupervisosCapacityWaitKind =
  SupervisorRunClientUpdate["capacityWaits"][number]["kind"];
export type SupervisosGateKind =
  SupervisorRunClientUpdate["gates"][number]["kind"];

/**
 * Display tone. Surfaces map a tone to their own visual tokens; the shared
 * package only fixes the semantics.
 *
 * - `progress`: work is actively moving.
 * - `attention`: a human decision or authority is genuinely required.
 *   Waiting for a human is not a runtime failure.
 * - `waiting`: durable wait that will resolve without the user (capacity,
 *   dependency, scheduled retry). Waiting quota is not scheduled automation.
 * - `paused`: desired state, never an automatic retry source.
 * - `recovering`: uncertainty after an interrupted effect; runtime is
 *   reconciling with evidence.
 */
export type SupervisosStatusTone =
  | "neutral"
  | "planned"
  | "progress"
  | "attention"
  | "waiting"
  | "paused"
  | "recovering"
  | "success"
  | "failed";

export interface SupervisosStatusPresentation {
  /** Stable display kind, safe for `data-*` attributes and analytics-free tests. */
  kind: string;
  /** Short human label; surfaces may prefix context but must not rename the fact. */
  label: string;
  tone: SupervisosStatusTone;
  /** One sentence explaining what the state means for the user. */
  hint?: string;
}

const RUN_PRESENTATIONS: Record<
  SupervisosRunClientStatus,
  SupervisosStatusPresentation
> = {
  draft: {
    kind: "draft",
    label: "Draft",
    tone: "planned",
    hint: "The run exists but planning has not started.",
  },
  planning: {
    kind: "planning",
    label: "Planning",
    tone: "progress",
    hint: "The manager is drafting an exact plan for approval.",
  },
  awaiting_approval: {
    kind: "awaiting_approval",
    label: "Needs your approval",
    tone: "attention",
    hint: "A plan is ready. Nothing runs until you approve this exact plan.",
  },
  queued: {
    kind: "queued",
    label: "Queued",
    tone: "planned",
    hint: "Approved work is waiting for its turn to dispatch.",
  },
  running: {
    kind: "running",
    label: "Running",
    tone: "progress",
    hint: "Workers are executing the approved plan.",
  },
  waiting_capacity: {
    kind: "waiting_capacity",
    label: "Waiting for capacity",
    tone: "waiting",
    hint: "A provider or agent identity is unavailable. The run resumes when capacity returns.",
  },
  paused: {
    kind: "paused",
    label: "Paused",
    tone: "paused",
    hint: "You paused this run. It stays exactly where it is until you resume it.",
  },
  needs_user: {
    kind: "needs_user",
    label: "Needs you",
    tone: "attention",
    hint: "A decision, permission, or gate requires your authority before work continues.",
  },
  completing: {
    kind: "completing",
    label: "Verifying",
    tone: "progress",
    hint: "Tasks are done; final verification and integration are running.",
  },
  completed: {
    kind: "completed",
    label: "Completed",
    tone: "success",
    hint: "The run finished with trusted evidence or your explicit acceptance.",
  },
  failed: {
    kind: "failed",
    label: "Failed",
    tone: "failed",
    hint: "The run stopped with a failure on record. History keeps the evidence.",
  },
  cancelled: {
    kind: "cancelled",
    label: "Cancelled",
    tone: "neutral",
    hint: "The run was cancelled. History keeps the evidence.",
  },
};

export function describeSupervisosRunStatus(
  status: SupervisosRunClientStatus
): SupervisosStatusPresentation {
  return RUN_PRESENTATIONS[status];
}

const TASK_PRESENTATIONS: Record<
  SupervisosTaskClientStatus,
  SupervisosStatusPresentation
> = {
  blocked: {
    kind: "waiting_dependency",
    label: "Waiting on dependency",
    tone: "waiting",
    hint: "An upstream task must finish first.",
  },
  ready: {
    kind: "ready",
    label: "Ready",
    tone: "planned",
    hint: "Dependencies are met; the task is eligible to dispatch.",
  },
  queued: {
    kind: "queued",
    label: "Queued",
    tone: "planned",
    hint: "The task is waiting for a worker slot.",
  },
  running: {
    kind: "running",
    label: "Running",
    tone: "progress",
    hint: "A worker session is executing this task.",
  },
  waiting_capacity: {
    kind: "waiting_quota",
    label: "Waiting for capacity",
    tone: "waiting",
    hint: "The assigned agent identity is waiting for provider capacity.",
  },
  reviewing: {
    kind: "reviewing",
    label: "Reviewing",
    tone: "progress",
    hint: "Worker output is being checked against the task evidence.",
  },
  integrating: {
    kind: "integrating",
    label: "Integrating",
    tone: "progress",
    hint: "Accepted worker changes are being integrated.",
  },
  completed: {
    kind: "completed",
    label: "Completed",
    tone: "success",
    hint: "The task succeeded with evidence or explicit acceptance.",
  },
  needs_user: {
    kind: "waiting_decision",
    label: "Needs you",
    tone: "attention",
    hint: "This task is blocked on a decision, permission, or gate.",
  },
  failed: {
    kind: "failed",
    label: "Failed",
    tone: "failed",
    hint: "The task failed; its attempt evidence is preserved.",
  },
  cancelled: {
    kind: "cancelled",
    label: "Cancelled",
    tone: "neutral",
    hint: "The task was cancelled before completion.",
  },
};

export function describeSupervisosTaskStatus(
  status: SupervisosTaskClientStatus
): SupervisosStatusPresentation {
  return TASK_PRESENTATIONS[status];
}

/**
 * Attempt display status. `superseded` is derived by callers when a later
 * attempt exists on a completed task: a superseded/failed attempt can
 * coexist with a later accepted attempt, and both stay visible.
 */
export type SupervisosAttemptDisplayKind =
  | "starting"
  | "running"
  | "waiting_quota"
  | "recovering"
  | "accepted"
  | "failed"
  | "needs_user"
  | "cancelled"
  | "interrupted"
  | "ended"
  | "superseded"
  | "not_started"
  | "unknown";

const ATTEMPT_PRESENTATIONS: Record<
  SupervisosAttemptDisplayKind,
  SupervisosStatusPresentation
> = {
  starting: { kind: "starting", label: "Starting", tone: "progress" },
  running: { kind: "running", label: "Running", tone: "progress" },
  waiting_quota: {
    kind: "waiting_quota",
    label: "Waiting for capacity",
    tone: "waiting",
    hint: "The provider identity is cooling down or exhausted.",
  },
  recovering: {
    kind: "recovering",
    label: "Recovering",
    tone: "recovering",
    hint: "The last delivery is uncertain; the runtime is reconciling from evidence before any resend.",
  },
  accepted: {
    kind: "accepted",
    label: "Accepted",
    tone: "success",
    hint: "This attempt produced the accepted result.",
  },
  failed: {
    kind: "failed",
    label: "Failed",
    tone: "failed",
    hint: "This attempt failed; its evidence is preserved.",
  },
  needs_user: {
    kind: "needs_user",
    label: "Needs you",
    tone: "attention",
    hint: "This attempt stopped for a decision or permission.",
  },
  cancelled: { kind: "cancelled", label: "Cancelled", tone: "neutral" },
  interrupted: {
    kind: "interrupted",
    label: "Interrupted",
    tone: "failed",
    hint: "The attempt was interrupted before a result was recorded.",
  },
  ended: {
    kind: "ended",
    label: "Ended",
    tone: "neutral",
    hint: "This attempt finished; its outcome was not recorded.",
  },
  superseded: {
    kind: "superseded",
    label: "Superseded",
    tone: "neutral",
    hint: "A later attempt replaced this one.",
  },
  not_started: {
    kind: "not_started",
    label: "Not started",
    tone: "planned",
    hint: "No worker session exists yet for this task.",
  },
  unknown: {
    kind: "unknown",
    label: "Unknown",
    tone: "neutral",
    hint: "No attempt evidence is available yet.",
  },
};

export function describeSupervisosAttemptStatus(
  kind: SupervisosAttemptDisplayKind
): SupervisosStatusPresentation {
  return ATTEMPT_PRESENTATIONS[kind];
}

export interface SupervisosAttemptContext {
  /** Client-safe attempt status. */
  status: SupervisosAttemptClientStatus;
  /** Whether a later attempt exists on the same task. */
  hasLaterAttempt: boolean;
  /** Outcome of the task this attempt belongs to, when terminal. */
  taskOutcome?: "succeeded" | "failed" | "cancelled";
  /** Recorded semantic result of the attempt itself, when known. */
  semanticStatus?: "succeeded" | "needs_user" | "failed" | "cancelled";
}

/**
 * One truthful mapping from attempt facts to display. Without a recorded
 * result the mapping stays conservative: a terminal attempt on a succeeded
 * task is superseded when replaced, accepted only as the final one, and
 * otherwise honestly `ended` — never silently green.
 */
export function describeSupervisosAttemptInContext(
  context: SupervisosAttemptContext
): SupervisosStatusPresentation {
  if (context.hasLaterAttempt && context.taskOutcome === "succeeded") {
    return describeSupervisosAttemptStatus("superseded");
  }
  switch (context.status) {
    case "starting":
      return describeSupervisosAttemptStatus("starting");
    case "running":
      return describeSupervisosAttemptStatus("running");
    case "waiting_capacity":
      return describeSupervisosAttemptStatus("waiting_quota");
    case "interrupted":
      return describeSupervisosAttemptStatus("interrupted");
    case "terminal":
      if (context.semanticStatus === "succeeded") {
        return describeSupervisosAttemptStatus("accepted");
      }
      if (context.semanticStatus === "failed") {
        return describeSupervisosAttemptStatus("failed");
      }
      if (context.semanticStatus === "needs_user") {
        return describeSupervisosAttemptStatus("needs_user");
      }
      if (context.semanticStatus === "cancelled") {
        return describeSupervisosAttemptStatus("cancelled");
      }
      if (context.taskOutcome === "succeeded") {
        return describeSupervisosAttemptStatus("accepted");
      }
      if (context.taskOutcome === "failed") {
        return describeSupervisosAttemptStatus("failed");
      }
      return describeSupervisosAttemptStatus("ended");
    default:
      return describeSupervisosAttemptStatus("unknown");
  }
}

/**
 * Interaction vocabulary: the single shared label for "waiting on a human".
 * Waiting for a human is not a runtime failure; waiting for quota is not
 * scheduled automation; a paused run never retries by itself.
 */
export const SUPERVISOS_INTERACTION_WAITING_HUMAN =
  "interaction.waiting-human" as const;

/** Gate kinds a user can approve. Machine gates are excluded on purpose. */
const USER_APPROVABLE_GATE_KINDS: ReadonlySet<SupervisosGateKind> = new Set([
  "scope",
  "deletion",
  "destructive_action",
]);

export function isUserApprovableSupervisosGate(
  kind: SupervisosGateKind
): boolean {
  return USER_APPROVABLE_GATE_KINDS.has(kind);
}

export interface SupervisosWaitCausePresentation {
  kind: string;
  label: string;
  tone: SupervisosStatusTone;
  /** True when provider resetAt evidence may exist (quota-family waits). */
  tracksProviderReset: boolean;
  /** True when the wait needs human authority instead of elapsed time. */
  waitingOnHuman: boolean;
}

const WAIT_CAUSE_PRESENTATIONS: Record<
  SupervisosCapacityWaitKind,
  SupervisosWaitCausePresentation
> = {
  quota_exhausted: {
    kind: "quota",
    label: "Provider quota exhausted",
    tone: "waiting",
    tracksProviderReset: true,
    waitingOnHuman: false,
  },
  transient_rate_limit: {
    kind: "rate_limit",
    label: "Burst rate limited",
    tone: "waiting",
    tracksProviderReset: false,
    waitingOnHuman: false,
  },
  auth_required: {
    kind: "auth",
    label: "Authentication required",
    tone: "attention",
    tracksProviderReset: false,
    waitingOnHuman: true,
  },
  transport: {
    kind: "transport",
    label: "Connection to the agent was lost",
    tone: "waiting",
    tracksProviderReset: false,
    waitingOnHuman: false,
  },
  session_fatal: {
    kind: "session_fatal",
    label: "Agent session ended unrecoverably",
    tone: "failed",
    tracksProviderReset: false,
    waitingOnHuman: false,
  },
  unknown: {
    kind: "unknown",
    label: "Unknown provider issue",
    tone: "waiting",
    tracksProviderReset: false,
    waitingOnHuman: false,
  },
};

export function describeSupervisosWaitCause(
  kind: SupervisosCapacityWaitKind
): SupervisosWaitCausePresentation {
  return WAIT_CAUSE_PRESENTATIONS[kind];
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export interface SupervisosWaitTimeText {
  /** Renderable approximate text, e.g. `in ~3m`. Empty when unusable. */
  text: string;
  /** False for missing/invalid input; surfaces must stay honest and omit the clock. */
  valid: boolean;
  /** True when the timestamp exists but is already in the past. */
  overdue: boolean;
}

/**
 * Approximate, display-only wait text. Never fabricates precision: minutes
 * below an hour, hours below a day, days beyond. Past timestamps are
 * reported as overdue rather than silently hidden.
 */
export function formatSupervisosWaitTime(
  targetIso: string | undefined,
  nowMs: number
): SupervisosWaitTimeText {
  if (!targetIso) {
    return { text: "", valid: false, overdue: false };
  }
  const target = Date.parse(targetIso);
  if (!Number.isFinite(target)) {
    return { text: "", valid: false, overdue: false };
  }
  const delta = target - nowMs;
  if (delta <= 0) {
    return { text: "due", valid: true, overdue: true };
  }
  if (delta < MINUTE_MS) {
    return { text: "in <1m", valid: true, overdue: false };
  }
  if (delta < HOUR_MS) {
    return {
      text: `in ~${Math.round(delta / MINUTE_MS)}m`,
      valid: true,
      overdue: false,
    };
  }
  if (delta < DAY_MS) {
    return {
      text: `in ~${Math.round(delta / HOUR_MS)}h`,
      valid: true,
      overdue: false,
    };
  }
  return {
    text: `in ~${Math.round(delta / DAY_MS)}d`,
    valid: true,
    overdue: false,
  };
}

/**
 * Stable agent identity index for identity color assignment. Identity is a
 * property of the agent, never of run state; the same agent keeps one hue
 * across stations, attempts, and statuses.
 */
export function supervisosAgentIdentityIndex(
  seed: string,
  paletteSize: number
): number {
  if (paletteSize <= 0) {
    return 0;
  }
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    // biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a mixing requires bitwise ops
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return Math.abs(hash) % paletteSize;
}

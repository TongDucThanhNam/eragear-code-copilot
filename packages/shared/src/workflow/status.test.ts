import { describe, expect, test } from "bun:test";
import {
  describeSupervisosAttemptInContext,
  describeSupervisosRunStatus,
  describeSupervisosTaskStatus,
  describeSupervisosWaitCause,
  formatSupervisosWaitTime,
  isUserApprovableSupervisosGate,
  SUPERVISOS_INTERACTION_WAITING_HUMAN,
  supervisosAgentIdentityIndex,
} from "./status.js";

describe("Supervisos status vocabulary", () => {
  test("never presents waiting-for-human as a runtime failure", () => {
    const awaiting = describeSupervisosRunStatus("awaiting_approval");
    const needsUser = describeSupervisosRunStatus("needs_user");
    expect(awaiting.tone).toBe("attention");
    expect(needsUser.tone).toBe("attention");
    expect(awaiting.tone).not.toBe("failed");
    expect(needsUser.tone).not.toBe("failed");
    expect(needsUser.hint).toContain("authority");
  });

  test("keeps waiting capacity, paused, and recovery distinct from automation and failure", () => {
    expect(describeSupervisosRunStatus("waiting_capacity").tone).toBe(
      "waiting"
    );
    expect(describeSupervisosRunStatus("paused").tone).toBe("paused");
    expect(describeSupervisosRunStatus("paused").hint).toContain("resume");
    expect(describeSupervisosTaskStatus("waiting_capacity").tone).toBe(
      "waiting"
    );
    expect(describeSupervisosTaskStatus("blocked").tone).toBe("waiting");
    expect(describeSupervisosTaskStatus("needs_user").tone).toBe("attention");
  });

  test("does not color normal running or completed states as warnings", () => {
    expect(describeSupervisosRunStatus("running").tone).toBe("progress");
    expect(describeSupervisosRunStatus("completing").tone).toBe("progress");
    expect(describeSupervisosTaskStatus("reviewing").tone).toBe("progress");
    expect(describeSupervisosRunStatus("completed").tone).toBe("success");
  });

  test("maps every client run and task status exactly once", () => {
    const runStatuses = [
      "draft",
      "planning",
      "awaiting_approval",
      "queued",
      "running",
      "waiting_capacity",
      "paused",
      "needs_user",
      "completing",
      "completed",
      "failed",
      "cancelled",
    ] as const;
    for (const status of runStatuses) {
      expect(describeSupervisosRunStatus(status).kind.length).toBeGreaterThan(
        0
      );
    }
    const taskStatuses = [
      "blocked",
      "ready",
      "queued",
      "running",
      "waiting_capacity",
      "reviewing",
      "integrating",
      "completed",
      "needs_user",
      "failed",
      "cancelled",
    ] as const;
    for (const status of taskStatuses) {
      expect(describeSupervisosTaskStatus(status).kind.length).toBeGreaterThan(
        0
      );
    }
  });

  test("derives truthful attempt display from attempt context", () => {
    expect(
      describeSupervisosAttemptInContext({
        status: "terminal",
        hasLaterAttempt: true,
        taskOutcome: "succeeded",
        semanticStatus: "failed",
      }).kind
    ).toBe("superseded");
    expect(
      describeSupervisosAttemptInContext({
        status: "terminal",
        hasLaterAttempt: false,
        taskOutcome: "succeeded",
      }).kind
    ).toBe("accepted");
    expect(
      describeSupervisosAttemptInContext({
        status: "terminal",
        hasLaterAttempt: false,
        semanticStatus: "failed",
      }).kind
    ).toBe("failed");
    // A terminal attempt with no recorded result is honestly "ended", not green.
    expect(
      describeSupervisosAttemptInContext({
        status: "terminal",
        hasLaterAttempt: false,
      }).kind
    ).toBe("ended");
    expect(
      describeSupervisosAttemptInContext({
        status: "running",
        hasLaterAttempt: false,
      }).kind
    ).toBe("running");
    // Uncertainty is a first-class display state, not running and not failure.
    expect(
      describeSupervisosAttemptInContext({
        status: "interrupted",
        hasLaterAttempt: false,
      }).kind
    ).toBe("interrupted");
  });

  test("restricts user-approvable gates to authority-carrying kinds", () => {
    expect(isUserApprovableSupervisosGate("scope")).toBe(true);
    expect(isUserApprovableSupervisosGate("deletion")).toBe(true);
    expect(isUserApprovableSupervisosGate("destructive_action")).toBe(true);
    for (const machine of [
      "baseline_drift",
      "conflict",
      "verification",
      "dirty_overlap",
      "non_git_write",
    ] as const) {
      expect(isUserApprovableSupervisosGate(machine)).toBe(false);
    }
  });

  test("classifies wait causes with reset evidence and human-authority flags", () => {
    const quota = describeSupervisosWaitCause("quota_exhausted");
    expect(quota.tracksProviderReset).toBe(true);
    expect(quota.waitingOnHuman).toBe(false);
    const auth = describeSupervisosWaitCause("auth_required");
    expect(auth.waitingOnHuman).toBe(true);
    expect(auth.tone).toBe("attention");
    expect(
      describeSupervisosWaitCause("transient_rate_limit").tracksProviderReset
    ).toBe(false);
    expect(describeSupervisosWaitCause("session_fatal").tone).toBe("failed");
  });

  test("formats approximate wait times without faking precision or hiding the past", () => {
    const now = Date.parse("2026-09-22T12:00:00.000Z");
    expect(formatSupervisosWaitTime(undefined, now)).toEqual({
      text: "",
      valid: false,
      overdue: false,
    });
    expect(formatSupervisosWaitTime("not-a-date", now).valid).toBe(false);
    expect(formatSupervisosWaitTime("2026-09-22T12:02:30.000Z", now)).toEqual({
      text: "in ~3m",
      valid: true,
      overdue: false,
    });
    expect(formatSupervisosWaitTime("2026-09-22T14:00:00.000Z", now).text).toBe(
      "in ~2h"
    );
    expect(formatSupervisosWaitTime("2026-09-24T12:00:00.000Z", now).text).toBe(
      "in ~2d"
    );
    const overdue = formatSupervisosWaitTime("2026-09-22T11:00:00.000Z", now);
    expect(overdue).toEqual({ text: "due", valid: true, overdue: true });
  });

  test("assigns stable agent identity indexes independent of status", () => {
    expect(supervisosAgentIdentityIndex("agent-a", 8)).toBe(
      supervisosAgentIdentityIndex("agent-a", 8)
    );
    expect(supervisosAgentIdentityIndex("agent-b", 8)).toBe(
      supervisosAgentIdentityIndex("agent-b", 8)
    );
    const indexes = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((seed) =>
        supervisosAgentIdentityIndex(seed, 8)
      )
    );
    expect(indexes.size).toBeGreaterThan(1);
    expect(supervisosAgentIdentityIndex("anything", 0)).toBe(0);
  });

  test("exposes the shared waiting-for-human interaction token", () => {
    expect(SUPERVISOS_INTERACTION_WAITING_HUMAN).toBe(
      "interaction.waiting-human"
    );
  });
});

import { describe, expect, test } from "bun:test";
import {
  normalizeInteractionConnStatus,
  resolveDisplayConnStatus,
} from "./chat-connection-display";

describe("resolveDisplayConnStatus", () => {
  test("shows inactive when local chat status is inactive", () => {
    expect(
      resolveDisplayConnStatus({
        status: "inactive",
        connStatus: "connected",
        sessionIsActive: true,
      })
    ).toBe("inactive");
  });

  test("shows inactive when authoritative session snapshot is inactive", () => {
    expect(
      resolveDisplayConnStatus({
        status: "ready",
        connStatus: "connected",
        sessionIsActive: false,
      })
    ).toBe("inactive");
  });

  test("keeps connected when runtime and snapshot are both active", () => {
    expect(
      resolveDisplayConnStatus({
        status: "ready",
        connStatus: "connected",
        sessionIsActive: true,
      })
    ).toBe("connected");
  });
});

describe("normalizeInteractionConnStatus", () => {
  test("maps inactive display status to idle interaction status", () => {
    expect(normalizeInteractionConnStatus("inactive")).toBe("idle");
  });

  test("keeps connected interaction status unchanged", () => {
    expect(normalizeInteractionConnStatus("connected")).toBe("connected");
  });
});

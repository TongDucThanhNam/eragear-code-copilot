import { describe, expect, test } from "bun:test";
import { resolveSessionBootstrapPhase } from "./chat-bootstrap-phase";

describe("resolveSessionBootstrapPhase", () => {
  test("moves to restoring_history while connecting from idle", () => {
    expect(
      resolveSessionBootstrapPhase({
        phase: "idle",
        connStatus: "connecting",
        hasMessages: false,
      })
    ).toBe("restoring_history");
  });

  test("resolves initializing_agent to idle once connected", () => {
    expect(
      resolveSessionBootstrapPhase({
        phase: "initializing_agent",
        connStatus: "connected",
        hasMessages: false,
      })
    ).toBe("idle");
  });

  test("keeps idle on connected", () => {
    expect(
      resolveSessionBootstrapPhase({
        phase: "idle",
        connStatus: "connected",
        hasMessages: false,
      })
    ).toBe("idle");
  });

  test("resolves stuck restoring_history to idle when connection is idle", () => {
    expect(
      resolveSessionBootstrapPhase({
        phase: "restoring_history",
        connStatus: "idle",
        hasMessages: false,
      })
    ).toBe("idle");
  });

  test("forces idle when chat already has messages while connecting", () => {
    expect(
      resolveSessionBootstrapPhase({
        phase: "restoring_history",
        connStatus: "connecting",
        hasMessages: true,
      })
    ).toBe("idle");
  });
});

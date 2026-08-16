import { describe, expect, test } from "bun:test";
import { resolveSafeSessionModeId } from "./safe-session-mode";

const modes = {
  currentModeId: "builder",
  availableModes: [
    { id: "builder", name: "Builder" },
    { id: "manager", name: "Manager" },
  ],
};

describe("resolveSafeSessionModeId", () => {
  test("selects the dedicated manager role", () => {
    expect(resolveSafeSessionModeId("read_only", modes, "manager")).toBe(
      "manager"
    );
  });

  test("keeps workers on builder even for read-only tasks", () => {
    expect(
      resolveSafeSessionModeId(
        "read_only",
        { ...modes, currentModeId: "manager" },
        "worker"
      )
    ).toBe("builder");
  });

  test("fails closed when the required configured role is missing", () => {
    expect(() =>
      resolveSafeSessionModeId(
        "read_only",
        {
          currentModeId: "plan",
          availableModes: [{ id: "plan", name: "Plan" }],
        },
        "manager"
      )
    ).toThrow("No configured manager role is available");
  });

  test("fails closed when a manager session does not advertise modes", () => {
    expect(() =>
      resolveSafeSessionModeId("read_only", undefined, "manager")
    ).toThrow("did not advertise session modes");
  });
});

import { describe, expect, test } from "bun:test";
import type { SessionItem } from "./types";
import { selectVisibleProjectSessions } from "./utils";

function session(
  id: string,
  status: SessionItem["status"],
  pinned = false
): SessionItem {
  return {
    id,
    projectId: "project-1",
    name: id,
    isActive: status !== "inactive",
    status,
    pinned,
    lastActiveAt: 0,
  };
}

describe("project session visibility", () => {
  test("keeps live and pinned sessions while capping inactive history", () => {
    const sessions = [
      session("live", "streaming"),
      session("old-1", "inactive"),
      session("old-2", "inactive"),
      session("pinned", "inactive", true),
      session("old-3", "inactive"),
    ];
    expect(
      selectVisibleProjectSessions(sessions, false, 2).map((item) => item.id)
    ).toEqual(["live", "old-1", "old-2", "pinned"]);
    expect(
      selectVisibleProjectSessions(sessions, true, 2).map((item) => item.id)
    ).toEqual(sessions.map((item) => item.id));
  });
});

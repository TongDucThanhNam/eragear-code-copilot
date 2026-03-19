import { describe, expect, test } from "bun:test";
import type { SessionStateData } from "@repo/shared";
import { shouldBackfillConnectedSessionState } from "./use-chat-session-state-sync";

describe("shouldBackfillConnectedSessionState", () => {
  test("backfills richer mode snapshot over sparse early selection event state", () => {
    const normalizedSessionState: SessionStateData = {
      status: "running",
      modes: {
        currentModeId: "default",
        availableModes: [
          { id: "default", name: "Default" },
          { id: "autoEdit", name: "Auto Edit" },
          { id: "yolo", name: "YOLO" },
        ],
      },
    };

    expect(
      shouldBackfillConnectedSessionState({
        normalizedSessionState,
        currentModes: {
          currentModeId: "default",
          availableModes: [],
        },
        currentModels: null,
      })
    ).toBe(true);
  });

  test("does not backfill when current state is already equally rich", () => {
    const normalizedSessionState: SessionStateData = {
      status: "running",
      modes: {
        currentModeId: "default",
        availableModes: [
          { id: "default", name: "Default" },
          { id: "autoEdit", name: "Auto Edit" },
          { id: "yolo", name: "YOLO" },
        ],
      },
    };

    expect(
      shouldBackfillConnectedSessionState({
        normalizedSessionState,
        currentModes: {
          currentModeId: "default",
          availableModes: [
            { id: "default", name: "Default" },
            { id: "autoEdit", name: "Auto Edit" },
            { id: "yolo", name: "YOLO" },
          ],
        },
        currentModels: null,
      })
    ).toBe(false);
  });
});

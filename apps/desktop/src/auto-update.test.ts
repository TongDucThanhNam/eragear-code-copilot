import { describe, expect, it } from "bun:test";
import type { DesktopAutoUpdateStatus } from "@repo/shared";
import {
  compareVersions,
  DesktopAutoUpdateController,
  parseDesktopUpdateManifest,
} from "./auto-update.js";

describe("desktop auto update", () => {
  it("compares semantic versions", () => {
    expect(compareVersions("1.2.0", "1.1.9")).toBe(1);
    expect(compareVersions("1.2.0", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.0-beta.1", "1.2.0")).toBe(-1);
  });

  it("parses update manifests", () => {
    expect(
      parseDesktopUpdateManifest({
        version: " v1.2.3 ",
        url: " https://example.com/app.exe ",
        notes: " Fixed ",
      })
    ).toEqual({
      version: "v1.2.3",
      url: "https://example.com/app.exe",
      notes: "Fixed",
    });
  });

  it("checks manifest and sends one notification per version", async () => {
    const notifications: string[] = [];
    const controller = new DesktopAutoUpdateController({
      currentVersion: "1.0.0",
      manifestUrl: "https://updates.example.com/latest.json",
      now: () => new Date("2026-06-12T00:00:00.000Z"),
      fetchManifest: async () => ({
        version: "1.1.0",
        url: "https://updates.example.com/download",
      }),
      notifyUpdate: (status: DesktopAutoUpdateStatus) => {
        notifications.push(status.latestVersion ?? "");
      },
    });

    const first = await controller.checkForUpdates();
    const second = await controller.checkForUpdates();

    expect(first.updateAvailable).toBe(true);
    expect(first.state).toBe("available");
    expect(first.downloadUrl).toBe("https://updates.example.com/download");
    expect(second.notificationShown).toBe(true);
    expect(notifications).toEqual(["1.1.0"]);
  });
});

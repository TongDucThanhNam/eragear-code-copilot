import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CrashReportingService } from "../application/crash-reporting.service";
import { CrashReportingFileRepository } from "./crash-reporting-file.repository";

let tempDir = "";

beforeEach(async () => {
  tempDir = path.join(
    os.tmpdir(),
    `eragear-crash-reporting-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`
  );
  await mkdir(tempDir, { recursive: true });
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("CrashReportingFileRepository", () => {
  test("persists config and reports behind the crash-reporting use-case interface", async () => {
    const filePath = path.join(tempDir, "crash-reports.json");
    const service = new CrashReportingService({
      repository: new CrashReportingFileRepository({
        filePath,
      }),
      now: () => 1000,
      createId: () => "crash-file-1",
      sentryTransport: () => Promise.resolve({ ok: true, status: 200 }),
    });

    await service.updateConfig({
      sentryDsn: " https://public@sentry.example.com/123 ",
      archiveLimit: 10,
    });
    const report = await service.capture("user-1", {
      source: "web",
      level: "error",
      message: "Render failed",
      metadata: { route: "/" },
    });
    const status = await service.getStatus("user-1");
    const raw = await readFile(filePath, "utf8");

    expect(report.id).toBe("crashfile1");
    expect(status.config.sentryDsn).toBe(
      "https://public@sentry.example.com/123"
    );
    expect(status.reports).toEqual([report]);
    expect(raw).toContain('"version": 1');
    expect(raw).toContain("crashfile1");
  });
});

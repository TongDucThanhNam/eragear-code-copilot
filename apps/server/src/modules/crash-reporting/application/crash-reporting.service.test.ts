import { describe, expect, it } from "bun:test";
import type { CrashReport } from "./contracts/crash-reporting.contract";
import {
  buildSentryEnvelope,
  CrashReportingService,
  type SentryEnvelopeTransportInput,
  sentryEnvelopeEndpoint,
} from "./crash-reporting.service";
import type {
  CrashReportingRepositoryPort,
  CrashReportingStoreSnapshot,
  MutableCrashReportingStoreSnapshot,
} from "./ports/crash-reporting-repository.port";

class MemoryCrashReportingRepository implements CrashReportingRepositoryPort {
  readonly snapshot: MutableCrashReportingStoreSnapshot = {
    config: null,
    reports: [],
  };

  async read<T>(
    reader: (snapshot: CrashReportingStoreSnapshot) => T | Promise<T>
  ): Promise<T> {
    return await reader(cloneSnapshot(this.snapshot));
  }

  async mutate<T>(
    mutator: (snapshot: MutableCrashReportingStoreSnapshot) => T | Promise<T>
  ): Promise<T> {
    return await mutator(this.snapshot);
  }
}

describe("CrashReportingService", () => {
  it("archives captured crash reports locally", async () => {
    let ids = 0;
    const repository = new MemoryCrashReportingRepository();
    const service = new CrashReportingService({
      repository,
      now: () => 1000,
      createId: () => `id-${++ids}`,
    });

    const report = await service.capture("user-1", {
      source: "web",
      level: "error",
      message: "Render failed",
      stack: "stack",
      metadata: { route: "/" },
    });
    const status = await service.getStatus("user-1");

    expect(report.userId).toBe("user-1");
    expect(report.stack).toBe("stack");
    expect(report.sentry.attempted).toBe(false);
    expect(status.reports).toHaveLength(1);
  });

  it("lists visible reports in newest-first order and prunes the archive", async () => {
    let now = 1000;
    let ids = 0;
    const repository = new MemoryCrashReportingRepository();
    const service = new CrashReportingService({
      repository,
      now: () => now,
      createId: () => `id-${++ids}`,
    });

    await service.updateConfig({ archiveLimit: 10 });
    for (let index = 0; index < 10; index++) {
      now += 100;
      await service.capture("user-1", {
        source: "server",
        level: "error",
        message: `Crash ${index}`,
      });
    }
    now += 100;
    await service.capture("user-2", {
      source: "server",
      level: "error",
      message: "Other user crash",
    });
    now += 100;
    const systemReport = await service.captureSystem({
      source: "server",
      level: "fatal",
      message: "System crash",
    });

    const status = await service.getStatus("user-1");

    expect(repository.snapshot.reports).toHaveLength(10);
    expect(status.reports[0]?.id).toBe(systemReport.id);
    expect(status.reports.some((report) => report.userId === "user-2")).toBe(
      false
    );
    expect(status.reports.map((report) => report.createdAt)).toEqual(
      [...status.reports.map((report) => report.createdAt)].sort(
        (left, right) => right - left
      )
    );
  });

  it("sends a Sentry envelope when DSN is configured", async () => {
    const sentEnvelopes: SentryEnvelopeTransportInput[] = [];
    const service = new CrashReportingService({
      repository: new MemoryCrashReportingRepository(),
      now: () => 2000,
      createId: () => "event-1",
      sentryTransport: (input) => {
        sentEnvelopes.push(input);
        return Promise.resolve({ ok: true, status: 200 });
      },
    });
    await service.updateConfig({
      sentryDsn: "https://public@sentry.example.com/123",
    });

    const report = await service.capture("user-1", {
      source: "web",
      level: "fatal",
      message: "Boundary failed",
    });

    expect(report.sentry).toMatchObject({
      attempted: true,
      ok: true,
      status: 200,
    });
    expect(sentEnvelopes[0]?.endpoint).toBe(
      "https://sentry.example.com/api/123/envelope/"
    );
    expect(sentEnvelopes[0]?.envelope).toContain("Boundary failed");
  });

  it("builds Sentry envelope endpoint and payload", () => {
    expect(sentryEnvelopeEndpoint("https://key@example.com/sentry/42")).toBe(
      "https://example.com/sentry/api/42/envelope/"
    );
    const envelope = buildSentryEnvelope("https://key@example.com/42", {
      id: "abc",
      userId: null,
      source: "server",
      level: "fatal",
      message: "Crash",
      metadata: {},
      createdAt: 3000,
    });
    expect(envelope.split("\n")).toHaveLength(3);
    expect(envelope).toContain('"type":"event"');
  });
});

function cloneSnapshot(
  snapshot: MutableCrashReportingStoreSnapshot
): CrashReportingStoreSnapshot {
  return {
    config: snapshot.config ? { ...snapshot.config } : null,
    reports: snapshot.reports.map(cloneReport),
  };
}

function cloneReport(report: CrashReport): CrashReport {
  return {
    ...report,
    metadata: { ...report.metadata },
    sentry: { ...report.sentry },
  };
}

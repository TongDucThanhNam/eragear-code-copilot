import { describe, expect, it } from "bun:test";
import type {
  CrashReport,
  CrashReportingConfig,
} from "./contracts/crash-reporting.contract";
import type { CrashReportingRepositoryPort } from "./ports/crash-reporting-repository.port";
import {
  buildSentryEnvelope,
  CrashReportingService,
  sentryEnvelopeEndpoint,
  type SentryEnvelopeTransportInput,
} from "./crash-reporting.service";

class MemoryCrashReportingRepository implements CrashReportingRepositoryPort {
  config: CrashReportingConfig | null = null;
  reports: CrashReport[] = [];

  async getConfig(): Promise<CrashReportingConfig | null> {
    return this.config;
  }

  async saveConfig(
    config: CrashReportingConfig
  ): Promise<CrashReportingConfig> {
    this.config = config;
    return config;
  }

  async listReports(userId: string): Promise<CrashReport[]> {
    return this.reports.filter(
      (report) => report.userId === userId || report.userId === null
    );
  }

  async saveReport(
    report: CrashReport,
    archiveLimit: number
  ): Promise<CrashReport> {
    this.reports.unshift(report);
    this.reports = this.reports.slice(0, archiveLimit);
    return report;
  }
}

describe("CrashReportingService", () => {
  it("archives captured crash reports locally", async () => {
    let ids = 0;
    const repository = new MemoryCrashReportingRepository();
    const service = new CrashReportingService({
      repository,
      now: () => 1_000,
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

  it("sends a Sentry envelope when DSN is configured", async () => {
    const sentEnvelopes: SentryEnvelopeTransportInput[] = [];
    const service = new CrashReportingService({
      repository: new MemoryCrashReportingRepository(),
      now: () => 2_000,
      createId: () => "event-1",
      sentryTransport: async (input) => {
        sentEnvelopes.push(input);
        return { ok: true, status: 200 };
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
      createdAt: 3_000,
    });
    expect(envelope.split("\n")).toHaveLength(3);
    expect(envelope).toContain("\"type\":\"event\"");
  });
});

import { randomUUID } from "node:crypto";
import type {
  CaptureCrashReportInput,
  CrashReport,
  CrashReportingConfig,
  CrashReportingStatus,
  SentryDelivery,
  UpdateCrashReportingConfigInput,
} from "./contracts/crash-reporting.contract";
import type {
  CrashReportingRepositoryPort,
  MutableCrashReportingStoreSnapshot,
} from "./ports/crash-reporting-repository.port";

const DEFAULT_CONFIG: CrashReportingConfig = {
  enabled: true,
  sentryDsn: "",
  captureUnhandled: true,
  includeStack: true,
  archiveLimit: 100,
  updatedAt: 0,
};

export interface SentryEnvelopeTransportInput {
  dsn: string;
  endpoint: string;
  envelope: string;
}

export interface SentryEnvelopeTransportResult {
  ok: boolean;
  status: number | null;
  error?: string;
}

export type SentryEnvelopeTransport = (
  input: SentryEnvelopeTransportInput
) => Promise<SentryEnvelopeTransportResult>;

interface CrashReportingServiceDeps {
  repository: CrashReportingRepositoryPort;
  now?: () => number;
  createId?: () => string;
  sentryTransport?: SentryEnvelopeTransport;
}

export class CrashReportingService {
  private readonly repository: CrashReportingRepositoryPort;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly sentryTransport: SentryEnvelopeTransport;

  constructor(deps: CrashReportingServiceDeps) {
    this.repository = deps.repository;
    this.now = deps.now ?? Date.now;
    this.createId = deps.createId ?? randomUUID;
    this.sentryTransport = deps.sentryTransport ?? sendSentryEnvelope;
  }

  async getStatus(userId: string): Promise<CrashReportingStatus> {
    return await this.repository.read((snapshot) => ({
      config: this.resolveConfig(snapshot.config),
      reports: listVisibleReports(snapshot.reports, userId),
    }));
  }

  async updateConfig(
    input: UpdateCrashReportingConfigInput
  ): Promise<CrashReportingStatus> {
    return await this.repository.mutate((snapshot) => {
      const existing = this.resolveConfig(snapshot.config);
      const next: CrashReportingConfig = {
        ...existing,
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.sentryDsn !== undefined
          ? { sentryDsn: input.sentryDsn.trim() }
          : {}),
        ...(input.captureUnhandled !== undefined
          ? { captureUnhandled: input.captureUnhandled }
          : {}),
        ...(input.includeStack !== undefined
          ? { includeStack: input.includeStack }
          : {}),
        ...(input.archiveLimit !== undefined
          ? { archiveLimit: input.archiveLimit }
          : {}),
        updatedAt: this.now(),
      };
      snapshot.config = next;
      return { config: next, reports: [] };
    });
  }

  async capture(
    userId: string,
    input: CaptureCrashReportInput
  ): Promise<CrashReport> {
    return await this.captureForUser(userId, input);
  }

  async captureSystem(input: CaptureCrashReportInput): Promise<CrashReport> {
    return await this.captureForUser(null, input);
  }

  private async captureForUser(
    userId: string | null,
    input: CaptureCrashReportInput
  ): Promise<CrashReport> {
    const config = await this.getConfig();
    const now = this.now();
    const reportBase: Omit<CrashReport, "sentry"> = {
      id: this.createId().replaceAll("-", ""),
      userId,
      source: input.source,
      level: input.level,
      message: input.message,
      ...(config.includeStack && input.stack ? { stack: input.stack } : {}),
      ...(config.includeStack && input.componentStack
        ? { componentStack: input.componentStack }
        : {}),
      metadata: input.metadata ?? {},
      createdAt: now,
    };
    const sentry = await this.deliverToSentry(config, reportBase);
    const report: CrashReport = { ...reportBase, sentry };
    if (!config.enabled) {
      return report;
    }
    return await this.repository.mutate((snapshot) => {
      snapshot.reports.push(report);
      pruneArchive(snapshot, config.archiveLimit);
      return report;
    });
  }

  private async deliverToSentry(
    config: CrashReportingConfig,
    report: Omit<CrashReport, "sentry">
  ): Promise<SentryDelivery> {
    if (!(config.enabled && config.sentryDsn)) {
      return { attempted: false, ok: false, status: null };
    }
    try {
      const endpoint = sentryEnvelopeEndpoint(config.sentryDsn);
      const envelope = buildSentryEnvelope(config.sentryDsn, report);
      const result = await this.sentryTransport({
        dsn: config.sentryDsn,
        endpoint,
        envelope,
      });
      return {
        attempted: true,
        ok: result.ok,
        status: result.status,
        ...(result.error ? { error: result.error } : {}),
      };
    } catch (error) {
      return {
        attempted: true,
        ok: false,
        status: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async getConfig(): Promise<CrashReportingConfig> {
    return await this.repository.read((snapshot) =>
      this.resolveConfig(snapshot.config)
    );
  }

  private resolveConfig(
    config: CrashReportingConfig | null
  ): CrashReportingConfig {
    return config ?? { ...DEFAULT_CONFIG, updatedAt: this.now() };
  }
}

function listVisibleReports(
  reports: readonly CrashReport[],
  userId: string
): CrashReport[] {
  return [...reports]
    .filter((report) => report.userId === userId || report.userId === null)
    .sort((left, right) => right.createdAt - left.createdAt);
}

function pruneArchive(
  snapshot: MutableCrashReportingStoreSnapshot,
  archiveLimit: number
): void {
  snapshot.reports = snapshot.reports
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, archiveLimit);
}

export function buildSentryEnvelope(
  dsn: string,
  report: Omit<CrashReport, "sentry">
): string {
  const event = {
    event_id: report.id,
    timestamp: new Date(report.createdAt).toISOString(),
    platform: report.source === "server" ? "node" : "javascript",
    level: report.level,
    message: report.message,
    tags: {
      source: report.source,
      userId: report.userId ?? "system",
    },
    extra: {
      ...report.metadata,
      componentStack: report.componentStack,
    },
    exception: report.stack
      ? {
          values: [
            {
              type: report.message,
              value: report.message,
              stacktrace: {
                frames: [],
              },
            },
          ],
        }
      : undefined,
  };
  return [
    JSON.stringify({ dsn, sent_at: new Date(report.createdAt).toISOString() }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
}

export function sentryEnvelopeEndpoint(dsn: string): string {
  const url = new URL(dsn);
  const parts = url.pathname.split("/").filter(Boolean);
  const projectId = parts.pop();
  if (!projectId) {
    throw new Error("Sentry DSN is missing project id");
  }
  const basePath = parts.length > 0 ? `/${parts.join("/")}` : "";
  return `${url.protocol}//${url.host}${basePath}/api/${projectId}/envelope/`;
}

async function sendSentryEnvelope(
  input: SentryEnvelopeTransportInput
): Promise<SentryEnvelopeTransportResult> {
  const response = await fetch(input.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-sentry-envelope",
    },
    body: input.envelope,
  });
  return {
    ok: response.ok,
    status: response.status,
    ...(response.ok ? {} : { error: await response.text() }),
  };
}

import { createId } from "#runtime/shared/utils/id.util";
import type {
  GetUsageStatsSummaryInput,
  RecordLifecycleUsageInput,
  RecordQuotaRefreshInput,
  UpdateUsageTelemetryInput,
  UsageStatsBucket,
  UsageStatsRange,
  UsageStatsRecord,
  UsageStatsSummary,
  UsageTelemetrySettings,
} from "./contracts/usage-stats.contract";
import type {
  UsageStatsRepositoryPort,
  UsageTelemetrySettingsSnapshot,
} from "./ports/usage-stats-repository.port";
import type { UsageStatsScannerPort } from "./ports/usage-stats-scanner.port";

const RECENT_LIMIT = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

export class UsageStatsService {
  private readonly repository: UsageStatsRepositoryPort;
  private readonly scanner?: UsageStatsScannerPort;
  private readonly nowMs: () => number;

  constructor(deps: {
    repository: UsageStatsRepositoryPort;
    scanner?: UsageStatsScannerPort;
    nowMs?: () => number;
  }) {
    this.repository = deps.repository;
    this.scanner = deps.scanner;
    this.nowMs = deps.nowMs ?? Date.now;
  }

  async getSummary(
    userId: string,
    input?: GetUsageStatsSummaryInput
  ): Promise<UsageStatsSummary> {
    const range = input?.range ?? "7d";
    const checkedAt = this.nowMs();
    const sinceMs = getRangeStartMs(range, checkedAt);
    const records = await this.repository.listRecords(userId, { sinceMs });
    const telemetry = await this.getTelemetrySettings(userId);
    const cliUsage =
      input?.includeCliUsage === false || !this.scanner
        ? undefined
        : await this.scanner.scan({
            range,
            startMs: sinceMs,
            endMs: checkedAt,
            providers: input?.cliProviders,
          });

    return buildSummary({
      telemetry,
      range,
      records,
      cliUsage,
      checkedAt,
    });
  }

  async updateTelemetry(
    userId: string,
    input: UpdateUsageTelemetryInput
  ): Promise<UsageTelemetrySettings> {
    return await this.repository.mutateTelemetrySettings(userId, (snapshot) => {
      const next = {
        ...this.resolveTelemetrySettings(snapshot),
        enabled: input.enabled,
        updatedAt: this.nowMs(),
      };
      snapshot.set(next);
      return next;
    });
  }

  async getTelemetrySettings(userId: string): Promise<UsageTelemetrySettings> {
    return await this.repository.readTelemetrySettings(userId, (snapshot) =>
      this.resolveTelemetrySettings(snapshot)
    );
  }

  async recordLifecycleUsage(
    input: RecordLifecycleUsageInput
  ): Promise<UsageStatsRecord> {
    return await this.repository.appendRecord({
      id: createId("usage"),
      userId: input.userId,
      kind: input.kind,
      projectRoot: input.projectRoot,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.chatId ? { chatId: input.chatId } : {}),
      ...(input.agentSessionId ? { agentSessionId: input.agentSessionId } : {}),
      ...(input.turnId ? { turnId: input.turnId } : {}),
      createdAt: this.nowMs(),
    });
  }

  async recordQuotaRefresh(
    input: RecordQuotaRefreshInput
  ): Promise<UsageStatsRecord> {
    return await this.repository.appendRecord({
      id: createId("usage"),
      userId: input.userId,
      kind: "quota_refreshed",
      providerId: input.providerId,
      providerDisplayName: input.providerDisplayName,
      status: input.status,
      createdAt: this.nowMs(),
    });
  }

  private resolveTelemetrySettings(
    snapshot: UsageTelemetrySettingsSnapshot
  ): UsageTelemetrySettings {
    const existing = snapshot.get();
    if (existing) {
      return existing;
    }
    return {
      enabled: false,
      updatedAt: this.nowMs(),
    };
  }
}

function getRangeStartMs(
  range: UsageStatsRange,
  nowMs: number
): number | undefined {
  switch (range) {
    case "24h":
      return nowMs - DAY_MS;
    case "7d":
      return nowMs - 7 * DAY_MS;
    case "30d":
      return nowMs - 30 * DAY_MS;
    case "all":
      return undefined;
    default:
      return undefined;
  }
}

function buildSummary(params: {
  telemetry: UsageTelemetrySettings;
  range: UsageStatsRange;
  records: UsageStatsRecord[];
  cliUsage?: UsageStatsSummary["cliUsage"];
  checkedAt: number;
}): UsageStatsSummary {
  const projectKeys = new Set<string>();
  const chatIds = new Set<string>();
  const totals = {
    promptCount: 0,
    turnCount: 0,
    quotaRefreshCount: 0,
    activeProjects: 0,
    activeChats: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
  const byDay = new Map<string, UsageStatsBucket>();
  const byProject = new Map<string, UsageStatsBucket>();

  for (const record of params.records) {
    applyRecordToTotals(record, totals);
    if (record.projectId || record.projectRoot) {
      projectKeys.add(record.projectId ?? record.projectRoot ?? "");
    }
    if (record.chatId) {
      chatIds.add(record.chatId);
    }
    applyRecordToBucket(byDay, formatDay(record.createdAt), record);
    if (record.projectId || record.projectRoot) {
      applyRecordToBucket(
        byProject,
        record.projectId ?? record.projectRoot ?? "unknown",
        record
      );
    }
  }

  totals.activeProjects = projectKeys.size;
  totals.activeChats = chatIds.size;

  return {
    telemetry: params.telemetry,
    range: params.range,
    totals,
    byDay: [...byDay.values()].sort((a, b) => a.key.localeCompare(b.key)),
    byProject: [...byProject.values()].sort(
      (a, b) =>
        b.promptCount +
        b.turnCount +
        b.quotaRefreshCount -
        (a.promptCount + a.turnCount + a.quotaRefreshCount)
    ),
    recent: [...params.records]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, RECENT_LIMIT),
    cliUsage: params.cliUsage,
    checkedAt: params.checkedAt,
  };
}

function applyRecordToTotals(
  record: UsageStatsRecord,
  totals: UsageStatsSummary["totals"]
): void {
  if (record.kind === "prompt_sent") {
    totals.promptCount += 1;
  }
  if (record.kind === "turn_completed") {
    totals.turnCount += 1;
  }
  if (record.kind === "quota_refreshed") {
    totals.quotaRefreshCount += 1;
  }
  totals.inputTokens += record.inputTokens ?? 0;
  totals.outputTokens += record.outputTokens ?? 0;
}

function applyRecordToBucket(
  buckets: Map<string, UsageStatsBucket>,
  key: string,
  record: UsageStatsRecord
): void {
  const bucket =
    buckets.get(key) ??
    ({
      key,
      promptCount: 0,
      turnCount: 0,
      quotaRefreshCount: 0,
    } satisfies UsageStatsBucket);
  if (record.kind === "prompt_sent") {
    bucket.promptCount += 1;
  }
  if (record.kind === "turn_completed") {
    bucket.turnCount += 1;
  }
  if (record.kind === "quota_refreshed") {
    bucket.quotaRefreshCount += 1;
  }
  buckets.set(key, bucket);
}

function formatDay(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

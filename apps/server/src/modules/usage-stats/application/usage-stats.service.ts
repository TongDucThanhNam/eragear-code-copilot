import type {
  LocalAdeLifecycleEvent,
  ProviderQuotaRefreshedEvent,
} from "@/shared/types/domain-events.types";
import { createId } from "@/shared/utils/id.util";
import type {
  GetUsageStatsSummaryInput,
  UpdateUsageTelemetryInput,
  UsageStatsBucket,
  UsageStatsRecord,
  UsageStatsSummary,
  UsageTelemetrySettings,
} from "./contracts/usage-stats.contract";
import type { UsageStatsRepositoryPort } from "./ports/usage-stats-repository.port";

const RECENT_LIMIT = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

export class UsageStatsService {
  private readonly repository: UsageStatsRepositoryPort;
  private readonly nowMs: () => number;

  constructor(deps: {
    repository: UsageStatsRepositoryPort;
    nowMs?: () => number;
  }) {
    this.repository = deps.repository;
    this.nowMs = deps.nowMs ?? Date.now;
  }

  async getSummary(
    userId: string,
    input?: GetUsageStatsSummaryInput
  ): Promise<UsageStatsSummary> {
    const range = input?.range ?? "7d";
    const sinceMs = getRangeStartMs(range, this.nowMs());
    const records = await this.repository.listRecords(userId, { sinceMs });
    const telemetry = await this.getTelemetrySettings(userId);
    return buildSummary({
      telemetry,
      range,
      records,
      checkedAt: this.nowMs(),
    });
  }

  async updateTelemetry(
    userId: string,
    input: UpdateUsageTelemetryInput
  ): Promise<UsageTelemetrySettings> {
    return await this.repository.saveTelemetrySettings(userId, {
      enabled: input.enabled,
      updatedAt: this.nowMs(),
    });
  }

  async getTelemetrySettings(userId: string): Promise<UsageTelemetrySettings> {
    return (
      (await this.repository.getTelemetrySettings(userId)) ?? {
        enabled: false,
        updatedAt: this.nowMs(),
      }
    );
  }

  async recordLifecycleEvent(
    event: LocalAdeLifecycleEvent
  ): Promise<UsageStatsRecord | null> {
    if (
      event.event !== "after-agent-message-send" &&
      event.event !== "after-agent-turn-complete"
    ) {
      return null;
    }
    return await this.repository.appendRecord({
      id: createId("usage"),
      userId: event.userId,
      kind:
        event.event === "after-agent-message-send"
          ? "prompt_sent"
          : "turn_completed",
      projectRoot: event.projectRoot,
      ...(event.projectId ? { projectId: event.projectId } : {}),
      ...(event.chatId ? { chatId: event.chatId } : {}),
      ...(event.agentSessionId ? { agentSessionId: event.agentSessionId } : {}),
      ...(event.turnId ? { turnId: event.turnId } : {}),
      createdAt: this.nowMs(),
    });
  }

  async recordQuotaRefreshedEvent(
    event: ProviderQuotaRefreshedEvent
  ): Promise<UsageStatsRecord> {
    return await this.repository.appendRecord({
      id: createId("usage"),
      userId: event.userId,
      kind: "quota_refreshed",
      providerId: event.providerId,
      providerDisplayName: event.providerDisplayName,
      status: event.status,
      createdAt: this.nowMs(),
    });
  }
}

function getRangeStartMs(
  range: NonNullable<GetUsageStatsSummaryInput>["range"],
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
  range: NonNullable<GetUsageStatsSummaryInput>["range"];
  records: UsageStatsRecord[];
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

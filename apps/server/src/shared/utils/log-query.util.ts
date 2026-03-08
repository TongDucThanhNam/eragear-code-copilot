import type { LogEntry, LogQuery } from "@/shared/types/log.types";
import { isAcpLogMessage } from "./acp-log.util";

function normalizeSource(source?: string): string {
  return source?.trim().toLowerCase() ?? "";
}

export function getLogSearchText(entry: LogEntry): string {
  const metaText = entry.meta
    ? Object.entries(entry.meta)
        .map(([key, value]) => `${key} ${String(value ?? "")}`)
        .join(" ")
    : "";

  return [
    entry.message,
    entry.userId ?? "",
    entry.source ?? "",
    entry.request?.method ?? "",
    entry.request?.path ?? "",
    entry.request?.host ?? "",
    entry.request?.status?.toString() ?? "",
    entry.error?.message ?? "",
    entry.requestId ?? "",
    entry.traceId ?? "",
    entry.chatId ?? "",
    entry.taskName ?? "",
    entry.taskRunId ?? "",
    entry.id,
    metaText,
  ]
    .join(" ")
    .toLowerCase();
}

export function isAcpRelatedLogEntry(entry: LogEntry): boolean {
  const source = normalizeSource(entry.source);
  if (source === "acp" || source.startsWith("acp:")) {
    return true;
  }
  return isAcpLogMessage(entry.message);
}

export function matchesLogQuery(
  entry: LogEntry,
  query: LogQuery = {}
): boolean {
  if (query.userId !== undefined && entry.userId !== query.userId) {
    return false;
  }
  if (query.from !== undefined && entry.timestamp < query.from) {
    return false;
  }
  if (query.to !== undefined && entry.timestamp > query.to) {
    return false;
  }

  if (query.levels?.length && !query.levels.includes(entry.level)) {
    return false;
  }

  if (query.sources?.length) {
    const source = normalizeSource(entry.source);
    if (!query.sources.some((allowed) => normalizeSource(allowed) === source)) {
      return false;
    }
  }

  if (query.acpOnly && !isAcpRelatedLogEntry(entry)) {
    return false;
  }

  const normalizedSearch = query.search?.trim().toLowerCase();
  if (normalizedSearch && !getLogSearchText(entry).includes(normalizedSearch)) {
    return false;
  }

  return true;
}

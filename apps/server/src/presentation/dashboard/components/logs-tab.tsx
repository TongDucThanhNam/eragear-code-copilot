import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDashboardState } from "@/presentation/dashboard/dashboard-view.context";
import type { LogEntry, LogLevel, LogQuery } from "@/shared/types/log.types";
import {
  getLogSearchText,
  matchesLogQuery,
} from "@/shared/utils/log-query.util";
import { LogDetail } from "./log-detail";
import { formatLogText, formatTimestamp, statusClass } from "./logs-utils";
import { TabPanel } from "./tab-panel";

const LOG_LIMIT = 200;
const LOGS_ENDPOINT = "/api/logs";
const LOGS_STREAM_ENDPOINT = "/api/logs/stream";

const DEFAULT_RANGE = "all";
const DEFAULT_ACP_ONLY = true;
const DEFAULT_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];
const DEFAULT_STATUSES = ["1xx", "2xx", "3xx", "4xx", "5xx", "system"] as const;

type StatusBucket = (typeof DEFAULT_STATUSES)[number];

function rangeToWindowMs(range: string): number | undefined {
  switch (range) {
    case "30m":
      return 30 * 60 * 1000;
    case "2h":
      return 2 * 60 * 60 * 1000;
    case "24h":
      return 24 * 60 * 60 * 1000;
    case "7d":
      return 7 * 24 * 60 * 60 * 1000;
    default:
      return undefined;
  }
}

function compareEntriesDescending(left: LogEntry, right: LogEntry): number {
  if (left.timestamp !== right.timestamp) {
    return right.timestamp - left.timestamp;
  }
  return right.id.localeCompare(left.id);
}

function buildScopedQuery(params: {
  acpOnly: boolean;
  range: string;
  nowMs: number;
}): LogQuery {
  const windowMs = rangeToWindowMs(params.range);
  return {
    acpOnly: params.acpOnly || undefined,
    from:
      typeof windowMs === "number"
        ? Math.max(0, params.nowMs - windowMs)
        : undefined,
    order: "desc",
    limit: LOG_LIMIT,
  };
}

function pruneEntries(
  entries: LogEntry[],
  params: { acpOnly: boolean; range: string; nowMs: number }
): LogEntry[] {
  const query = buildScopedQuery(params);
  return entries
    .filter((entry) => matchesLogQuery(entry, query))
    .sort(compareEntriesDescending)
    .slice(0, LOG_LIMIT);
}

function mergeEntries(
  currentEntries: LogEntry[],
  incomingEntries: LogEntry[],
  params: { acpOnly: boolean; range: string; nowMs: number }
): LogEntry[] {
  const deduped = new Map<string, LogEntry>();
  for (const entry of currentEntries) {
    deduped.set(entry.id, entry);
  }
  for (const entry of incomingEntries) {
    deduped.set(entry.id, entry);
  }
  return pruneEntries([...deduped.values()], params);
}

function resolveServerNow(
  fallbackNowMs: number,
  payloadNowMs: unknown,
  entries: LogEntry[]
): number {
  if (typeof payloadNowMs === "number" && Number.isFinite(payloadNowMs)) {
    return payloadNowMs;
  }
  let maxTimestamp = fallbackNowMs;
  for (const entry of entries) {
    if (typeof entry.timestamp === "number" && entry.timestamp > maxTimestamp) {
      maxTimestamp = entry.timestamp;
    }
  }
  return maxTimestamp;
}

function statusBucket(status?: number): StatusBucket {
  if (!status) {
    return "system";
  }
  const bucket = `${Math.floor(status / 100)}xx` as StatusBucket;
  return DEFAULT_STATUSES.includes(bucket) ? bucket : "system";
}

function statusBucketLabel(bucket: StatusBucket): string {
  if (bucket === "system") {
    return "System";
  }
  if (bucket === "1xx") {
    return `${bucket} Informational`;
  }
  if (bucket === "2xx") {
    return `${bucket} Success`;
  }
  if (bucket === "3xx") {
    return `${bucket} Redirect`;
  }
  if (bucket === "4xx") {
    return `${bucket} Client`;
  }
  return `${bucket} Server`;
}

export function LogsTab() {
  const { activeTab } = useDashboardState();
  const [rawEntries, setRawEntries] = useState<LogEntry[]>([]);
  const [search, setSearch] = useState("");
  const [range, setRange] = useState(DEFAULT_RANGE);
  const [acpOnly, setAcpOnly] = useState(DEFAULT_ACP_ONLY);
  const [levels, setLevels] = useState<Set<LogLevel>>(
    () => new Set(DEFAULT_LEVELS)
  );
  const [statuses, setStatuses] = useState<Set<StatusBucket>>(
    () => new Set(DEFAULT_STATUSES)
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rangeRef = useRef(range);
  const acpOnlyRef = useRef(acpOnly);
  const serverNowRef = useRef(Date.now());
  const fetchRequestIdRef = useRef(0);
  const fetchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    rangeRef.current = range;
  }, [range]);

  useEffect(() => {
    acpOnlyRef.current = acpOnly;
  }, [acpOnly]);

  const updateServerNow = useCallback((nextNowMs: number): number => {
    if (Number.isFinite(nextNowMs) && nextNowMs > serverNowRef.current) {
      serverNowRef.current = nextNowMs;
    }
    return serverNowRef.current;
  }, []);

  const fetchLogs = useCallback(
    async (paramsInput?: { acpOnly?: boolean; range?: string }) => {
      const nextAcpOnly = paramsInput?.acpOnly ?? acpOnlyRef.current;
      const nextRange = paramsInput?.range ?? rangeRef.current;
      const requestId = fetchRequestIdRef.current + 1;
      fetchRequestIdRef.current = requestId;
      fetchAbortRef.current?.abort();

      const abortController = new AbortController();
      fetchAbortRef.current = abortController;

      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      params.set("limit", String(LOG_LIMIT));
      params.set("order", "desc");
      if (nextAcpOnly) {
        params.set("acpOnly", "1");
      }
      if (nextRange !== DEFAULT_RANGE) {
        params.set("range", nextRange);
      }

      try {
        const response = await fetch(`${LOGS_ENDPOINT}?${params.toString()}`, {
          signal: abortController.signal,
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = (await response.json()) as {
          entries?: LogEntry[];
          now?: number;
        };
        if (
          abortController.signal.aborted ||
          requestId !== fetchRequestIdRef.current
        ) {
          return;
        }

        const nextEntries = Array.isArray(data.entries) ? data.entries : [];
        const nowMs = updateServerNow(
          resolveServerNow(serverNowRef.current, data.now, nextEntries)
        );
        setRawEntries((prev) =>
          mergeEntries(prev, nextEntries, {
            acpOnly: nextAcpOnly,
            range: nextRange,
            nowMs,
          })
        );
      } catch (fetchError) {
        if (
          abortController.signal.aborted ||
          requestId !== fetchRequestIdRef.current
        ) {
          return;
        }

        setError("Failed to load logs.");
        if (console?.error) {
          console.error("Failed to fetch logs:", fetchError);
        }
      } finally {
        if (requestId === fetchRequestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [updateServerNow]
  );

  useEffect(() => {
    return () => {
      fetchAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (activeTab === "logs") {
      fetchLogs({ acpOnly, range });
    }
  }, [activeTab, acpOnly, range, fetchLogs]);

  useEffect(() => {
    setRawEntries((prev) =>
      pruneEntries(prev, {
        acpOnly,
        range,
        nowMs: serverNowRef.current,
      })
    );
  }, [acpOnly, range]);

  useEffect(() => {
    if (activeTab !== "logs" || !live) {
      return;
    }

    const streamParams = new URLSearchParams();
    if (acpOnly) {
      streamParams.set("acpOnly", "1");
    }
    const streamUrl =
      streamParams.size > 0
        ? `${LOGS_STREAM_ENDPOINT}?${streamParams.toString()}`
        : LOGS_STREAM_ENDPOINT;
    const source = new EventSource(streamUrl);

    const handleConnected = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data as string) as { ts?: number };
        if (typeof parsed.ts === "number") {
          updateServerNow(parsed.ts);
        }
      } catch (parseError) {
        if (console?.error) {
          console.error("Failed to parse log stream metadata:", parseError);
        }
      }
    };

    source.addEventListener("connected", handleConnected);
    source.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as LogEntry;
        const nowMs = updateServerNow(
          typeof parsed.timestamp === "number"
            ? parsed.timestamp
            : serverNowRef.current
        );
        setRawEntries((prev) =>
          mergeEntries(prev, [parsed], {
            acpOnly: acpOnlyRef.current,
            range: rangeRef.current,
            nowMs,
          })
        );
      } catch (parseError) {
        if (console?.error) {
          console.error("Failed to parse log entry:", parseError);
        }
      }
    };

    return () => {
      source.removeEventListener("connected", handleConnected);
      source.close();
    };
  }, [acpOnly, activeTab, live, updateServerNow]);

  const handleLevelToggle = (level: LogLevel) => {
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  };

  const handleStatusToggle = (bucket: StatusBucket) => {
    setStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(bucket)) {
        next.delete(bucket);
      } else {
        next.add(bucket);
      }
      return next;
    });
  };

  const handleReset = () => {
    setSearch("");
    setRange(DEFAULT_RANGE);
    setAcpOnly(DEFAULT_ACP_ONLY);
    setLevels(new Set(DEFAULT_LEVELS));
    setStatuses(new Set(DEFAULT_STATUSES));
    if (range === DEFAULT_RANGE) {
      fetchLogs({
        acpOnly: DEFAULT_ACP_ONLY,
        range: DEFAULT_RANGE,
      });
    }
  };

  const handleLiveToggle = () => {
    const nextLive = !live;
    setLive(nextLive);
    if (nextLive) {
      fetchLogs({ acpOnly, range });
    }
  };

  const filteredEntries = useMemo(() => {
    if (levels.size === 0 || statuses.size === 0) {
      return [];
    }

    const searchText = search.trim().toLowerCase();
    const hasSearch = searchText.length > 0;

    return rawEntries.filter((entry) => {
      if (!levels.has(entry.level)) {
        return false;
      }
      const bucket = statusBucket(entry.request?.status);
      if (!statuses.has(bucket)) {
        return false;
      }
      if (hasSearch && !getLogSearchText(entry).includes(searchText)) {
        return false;
      }
      return true;
    });
  }, [levels, rawEntries, search, statuses]);

  const counts = useMemo(() => {
    const levelCounts: Record<LogLevel, number> = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
    };
    const statusCounts: Record<StatusBucket, number> = {
      "1xx": 0,
      "2xx": 0,
      "3xx": 0,
      "4xx": 0,
      "5xx": 0,
      system: 0,
    };

    for (const entry of rawEntries) {
      levelCounts[entry.level] += 1;
      statusCounts[statusBucket(entry.request?.status)] += 1;
    }

    return { levelCounts, statusCounts };
  }, [rawEntries]);

  const selectedEntry = useMemo(() => {
    if (!selectedId) {
      return null;
    }
    return (
      filteredEntries.find((entry) => entry.id === selectedId) ??
      rawEntries.find((entry) => entry.id === selectedId) ??
      null
    );
  }, [filteredEntries, rawEntries, selectedId]);

  const handleRowSelect = (entryId: string) => {
    setSelectedId(entryId);
  };

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    const stillVisible = filteredEntries.some(
      (entry) => entry.id === selectedId
    );
    if (!stillVisible) {
      setSelectedId(null);
    }
  }, [filteredEntries, selectedId]);

  return (
    <TabPanel activeTab={activeTab} className="flex-1" tab="logs">
      <section className="border-2 border-ink bg-paper shadow-news">
        <div className="border-ink border-b-4 p-6">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <div className="mb-2 font-mono text-[10px] text-ink-muted uppercase tracking-[0.3em]">
                Edition Vol. I • Record of Events
              </div>
              <h2 className="font-black font-display text-4xl leading-none tracking-tight">
                Logs
              </h2>
              <div className="mt-4 max-w-lg text-justify font-body text-ink-muted text-sm leading-relaxed">
                <span className="float-left mt-1 mr-2 font-black font-display text-5xl text-ink leading-[0.8]">
                  R
                </span>
                eal-time request and system logs with live tailing and filtering
                capabilities. This ledger serves as the definitive chronicle of
                server activity, capturing every interaction and system event
                for meticulous audit and debugging. Monitor the pulse of your
                infrastructure as it happens.
              </div>
            </div>
            <div className="flex flex-col items-end gap-3">
              <span className="log-status-pill font-mono text-xs uppercase tracking-widest">
                Saved Log Format
              </span>
              <span className="border border-ink px-3 py-1 font-mono text-xs tracking-widest">
                Showing {filteredEntries.length}/{rawEntries.length} buffered
                {acpOnly ? " • ACP only" : ""}
              </span>
            </div>
          </div>
        </div>

        <div className="p-4">
          <div className="log-shell newsprint-texture">
            <div className="log-toolbar">
              <div className="log-toolbar-group log-toolbar-primary">
                <div className="log-control log-range">
                  <label className="log-label" htmlFor="log-range-select">
                    Timeline
                  </label>
                  <select
                    id="log-range-select"
                    onChange={(event) => setRange(event.target.value)}
                    value={range}
                  >
                    <option value={DEFAULT_RANGE}>All time</option>
                    <option value="30m">Last 30 minutes</option>
                    <option value="2h">Last 2 hours</option>
                    <option value="24h">Last 24 hours</option>
                    <option value="7d">Last 7 days</option>
                  </select>
                </div>
                <div className="log-control log-search">
                  <label className="log-label" htmlFor="log-search-input">
                    Search
                  </label>
                  <input
                    id="log-search-input"
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search message, route, request ID..."
                    type="search"
                    value={search}
                  />
                </div>
              </div>
              <div className="log-toolbar-group log-toolbar-actions">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={handleReset}
                  type="button"
                >
                  Reset
                </button>
                <button
                  aria-pressed={acpOnly}
                  className={`log-btn btn-newsprint-primary ${
                    acpOnly ? "is-live" : ""
                  }`}
                  onClick={() => setAcpOnly((prev) => !prev)}
                  type="button"
                >
                  ACP Focus
                </button>
                <button
                  aria-pressed={live}
                  className={`log-btn log-live btn-newsprint-primary ${
                    live ? "is-live" : ""
                  }`}
                  onClick={handleLiveToggle}
                  type="button"
                >
                  Live
                  <span aria-hidden="true" className="log-live-dot" />
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    fetchLogs({ acpOnly, range });
                  }}
                  type="button"
                >
                  Refresh
                </button>
              </div>
            </div>

            <div className="log-body">
              <aside className="log-filters">
                <div className="log-filter-group">
                  <div className="log-filter-title">Contains level</div>
                  {DEFAULT_LEVELS.map((level) => (
                    <label className="log-filter-item" key={level}>
                      <input
                        checked={levels.has(level)}
                        onChange={() => handleLevelToggle(level)}
                        type="checkbox"
                      />
                      <span>{level === "warn" ? "Warning" : level}</span>
                      <span className="log-count">
                        {counts.levelCounts[level]}
                      </span>
                    </label>
                  ))}
                </div>

                <div className="log-filter-group">
                  <div className="log-filter-title">Status code</div>
                  {DEFAULT_STATUSES.map((bucket) => (
                    <label className="log-filter-item" key={bucket}>
                      <input
                        checked={statuses.has(bucket)}
                        onChange={() => handleStatusToggle(bucket)}
                        type="checkbox"
                      />
                      <span>{statusBucketLabel(bucket)}</span>
                      <span className="log-count">
                        {counts.statusCounts[bucket]}
                      </span>
                    </label>
                  ))}
                </div>
              </aside>

              <div className="log-stream">
                <div className="log-table">
                  <div className="log-table-head">
                    <span>Time</span>
                    <span>Status</span>
                    <span>Host</span>
                    <span>Request</span>
                    <span>Message</span>
                  </div>
                  <div className="log-list">
                    {loading && <div className="log-empty">Loading logs...</div>}
                    {!loading && error && (
                      <div className="log-empty">{error}</div>
                    )}
                    {!(loading || error) && filteredEntries.length === 0 && (
                      <div className="log-empty">
                        No logs found for the selected filters.
                      </div>
                    )}
                    {!(loading || error) &&
                      filteredEntries.map((entry) => {
                        const isSelected = entry.id === selectedId;
                        return (
                          <button
                            aria-pressed={isSelected}
                            className={`log-entry log-entry--${entry.level} ${
                              isSelected ? "is-selected" : ""
                            }`}
                            key={entry.id}
                            onClick={() => handleRowSelect(entry.id)}
                            type="button"
                          >
                            <div className="log-cell">
                              {formatTimestamp(entry.timestamp)}
                            </div>
                            <div
                              className={`log-cell ${statusClass(
                                entry.request?.status
                              )}`}
                            >
                              {entry.request?.status?.toString() ?? "--"}
                            </div>
                            <div className="log-cell">
                              {entry.request?.host ?? "--"}
                            </div>
                            <div className="log-cell log-request">
                              {entry.request
                                ? `${entry.request.method} ${entry.request.path}${
                                    entry.request.durationMs
                                      ? ` (${entry.request.durationMs}ms)`
                                      : ""
                                  }`
                                : (entry.source ?? "--")}
                            </div>
                            <div className="log-cell log-message">
                              {formatLogText(
                                entry.error?.message ?? entry.message
                              )}
                            </div>
                          </button>
                        );
                      })}
                  </div>
                </div>
                <LogDetail
                  entry={selectedEntry}
                  onClose={() => setSelectedId(null)}
                />
              </div>
            </div>
          </div>
        </div>
      </section>
    </TabPanel>
  );
}

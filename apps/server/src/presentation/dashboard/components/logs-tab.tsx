import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LogEntry, LogLevel } from "@/shared/types/log.types";
import { LogDetail } from "./log-detail";
import { formatTimestamp, statusClass } from "./logs-utils";
import { TabPanel } from "./tab-panel";

interface LogsTabProps {
  activeTab: string;
}

const LOG_LIMIT = 200;
const LOGS_ENDPOINT = "/api/logs";
const LOGS_STREAM_ENDPOINT = "/api/logs/stream";

const DEFAULT_LEVELS: LogLevel[] = ["info", "warn", "error"];
const DEFAULT_STATUSES = ["2xx", "3xx", "4xx", "5xx", "system"] as const;

type StatusBucket = (typeof DEFAULT_STATUSES)[number];

function rangeToFrom(range: string): number | undefined {
  const now = Date.now();
  switch (range) {
    case "30m":
      return now - 30 * 60 * 1000;
    case "2h":
      return now - 2 * 60 * 60 * 1000;
    case "24h":
      return now - 24 * 60 * 60 * 1000;
    case "7d":
      return now - 7 * 24 * 60 * 60 * 1000;
    default:
      return undefined;
  }
}

function entrySearchText(entry: LogEntry): string {
  return [
    entry.message,
    entry.source ?? "",
    entry.request?.method ?? "",
    entry.request?.path ?? "",
    entry.request?.host ?? "",
    entry.request?.status?.toString() ?? "",
    entry.error?.message ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

function statusBucket(status?: number): StatusBucket {
  if (!status) {
    return "system";
  }
  const bucket = `${Math.floor(status / 100)}xx` as StatusBucket;
  return DEFAULT_STATUSES.includes(bucket) ? bucket : "system";
}

export function LogsTab({ activeTab }: LogsTabProps) {
  const [rawEntries, setRawEntries] = useState<LogEntry[]>([]);
  const [search, setSearch] = useState("");
  const [range, setRange] = useState("30m");
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
  useEffect(() => {
    rangeRef.current = range;
  }, [range]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    params.set("limit", String(LOG_LIMIT));
    params.set("order", "desc");
    const from = rangeToFrom(range);
    if (from) {
      params.set("from", String(from));
    }

    try {
      const response = await fetch(`${LOGS_ENDPOINT}?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as { entries?: LogEntry[] };
      setRawEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch (fetchError) {
      setRawEntries([]);
      setError("Failed to load logs.");
      if (console?.error) {
        console.error("Failed to fetch logs:", fetchError);
      }
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    if (activeTab === "logs") {
      void fetchLogs();
    }
  }, [activeTab, fetchLogs]);

  useEffect(() => {
    if (activeTab !== "logs" || !live) {
      return;
    }

    const source = new EventSource(LOGS_STREAM_ENDPOINT);
    source.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as LogEntry;
        const from = rangeToFrom(rangeRef.current);
        if (from && parsed.timestamp < from) {
          return;
        }
        setRawEntries((prev) => {
          const next = [parsed, ...prev];
          if (next.length > LOG_LIMIT) {
            next.pop();
          }
          return next;
        });
      } catch (parseError) {
        if (console?.error) {
          console.error("Failed to parse log entry:", parseError);
        }
      }
    };

    return () => {
      source.close();
    };
  }, [activeTab, live]);

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
    setRange("30m");
    setLevels(new Set(DEFAULT_LEVELS));
    setStatuses(new Set(DEFAULT_STATUSES));
    void fetchLogs();
  };

  const handleLiveToggle = () => {
    setLive((prev) => !prev);
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
      if (hasSearch && !entrySearchText(entry).includes(searchText)) {
        return false;
      }
      return true;
    });
  }, [levels, statuses, rawEntries, search]);

  const counts = useMemo(() => {
    const levelCounts: Record<LogLevel, number> = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
    };
    const statusCounts: Record<StatusBucket, number> = {
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

  return (
    <TabPanel activeTab={activeTab} className="flex-1" tab="logs">
      <section className="border-2 border-ink bg-paper shadow-news">
        {/* Header Section */}
        <div className="border-ink border-b-4 p-6">
          <div className="items-starts flex flex-wrap justify-between gap-6">
            <div>
              <div className="mb-2 font-mono text-ink-muted text-xs uppercase tracking-[0.2em]">
                Edition Vol. 1
              </div>
              <h2 className="font-black font-display text-4xl leading-none tracking-tight">
                Logs
              </h2>
              <p className="mt-3 max-w-lg font-body text-ink-muted text-sm leading-relaxed">
                Real-time request and system logs with live tailing and filtering
                capabilities.
              </p>
            </div>
            <div className="flex flex-col items-end gap-3">
              <span className="log-status-pill font-mono text-xs uppercase tracking-widest">
                Log Stream
              </span>
              <span className="border border-ink px-3 py-1 font-mono text-xs tracking-widest">
                Filtered Stream
              </span>
            </div>
          </div>
        </div>

        <div className="p-4">
          <div className="log-shell newsprint-texture">
            {/* Toolbar */}
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
                    <option value="30m">Last 30 minutes</option>
                    <option value="2h">Last 2 hours</option>
                    <option value="24h">Last 24 hours</option>
                    <option value="7d">Last 7 days</option>
                    <option value="all">All time</option>
                  </select>
                </div>
                <div className="log-control log-search">
                  <label className="log-label" htmlFor="log-search-input">
                    Search
                  </label>
                  <input
                    id="log-search-input"
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search logs..."
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
                  onClick={() => void fetchLogs()}
                  type="button"
                >
                  Refresh
                </button>
              </div>
            </div>

            <div className="log-body">
              {/* Filters Sidebar */}
              <aside className="log-filters">
                <div className="log-filter-group">
                  <div className="log-filter-title">Contains level</div>
                  {(["info", "warn", "error", "debug"] as LogLevel[]).map(
                    (level) => (
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
                    )
                  )}
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
                      <span>
                        {bucket === "system" ? "System" : `${bucket} ${bucket === "2xx" ? "Success" : bucket === "3xx" ? "Redirect" : bucket === "4xx" ? "Client" : "Server"}`}
                      </span>
                      <span className="log-count">
                        {counts.statusCounts[bucket]}
                      </span>
                    </label>
                  ))}
                </div>
              </aside>

              {/* Log Stream */}
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
                    {loading && (
                      <div className="log-empty">Loading logs...</div>
                    )}
                    {!loading && error && (
                      <div className="log-empty">{error}</div>
                    )}
                    {!loading && !error && filteredEntries.length === 0 && (
                      <div className="log-empty">
                        No logs found for the selected filters.
                      </div>
                    )}
                    {!loading &&
                      !error &&
                      filteredEntries.map((entry) => {
                        const isSelected = entry.id === selectedId;
                        return (
                          <div
                            className={`log-entry log-entry--${entry.level} ${
                              isSelected ? "is-selected" : ""
                            }`}
                            key={entry.id}
                            onClick={() => handleRowSelect(entry.id)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                handleRowSelect(entry.id);
                              }
                            }}
                            role="button"
                            tabIndex={0}
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
                                ? `${entry.request.method} ${entry.request.path}`
                                : entry.source ?? "--"}
                            </div>
                            <div className="log-cell log-message">
                              {entry.error?.message ??
                                (entry.request?.durationMs
                                  ? `${entry.request.durationMs}ms`
                                  : entry.message)}
                            </div>
                          </div>
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

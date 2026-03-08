import type { LogEntry } from "@/shared/types/log.types";
import { formatLogText, formatTimestamp, statusClass } from "./logs-utils";

interface LogDetailProps {
  entry: LogEntry | null;
  onClose: () => void;
}

export function LogDetail({ entry, onClose }: LogDetailProps) {
  const meta = entry?.meta ? JSON.stringify(entry.meta) : "";

  return (
    <aside
      aria-live="polite"
      className={`log-detail ${entry ? "" : "is-empty"}`}
    >
      <div className="log-detail-header">
        <div className="log-detail-title">
          <span>{entry?.request?.method ?? "--"}</span>
          <span>
            {formatLogText(
              entry?.request?.path ??
                entry?.source ??
                entry?.message ??
                "Pick a log entry"
            )}
          </span>
        </div>
        <div className="log-detail-actions">
          <span className={statusClass(entry?.request?.status)}>
            {entry?.request?.status
              ? String(entry.request.status)
              : (entry?.level?.toUpperCase() ?? "--")}
          </span>
          <button
            aria-label="Close details"
            className="log-detail-close"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
      </div>
      <div className="log-detail-body">
        <div className="log-detail-row">
          <span className="log-detail-label">Timestamp</span>
          <span className="log-detail-value">
            {entry ? formatTimestamp(entry.timestamp) : "--"}
          </span>
        </div>
        <div className="log-detail-row">
          <span className="log-detail-label">Log ID</span>
          <span className="log-detail-value">{entry?.id ?? "--"}</span>
        </div>
        <div className="log-detail-row">
          <span className="log-detail-label">Request ID</span>
          <span className="log-detail-value">{entry?.requestId ?? "--"}</span>
        </div>
        <div className="log-detail-row">
          <span className="log-detail-label">Trace ID</span>
          <span className="log-detail-value">{entry?.traceId ?? "--"}</span>
        </div>
        <div className="log-detail-row">
          <span className="log-detail-label">Host</span>
          <span className="log-detail-value">
            {entry?.request?.host ?? "--"}
          </span>
        </div>
        <div className="log-detail-row">
          <span className="log-detail-label">Duration</span>
          <span className="log-detail-value">
            {entry?.request?.durationMs
              ? `${entry.request.durationMs}ms`
              : "--"}
          </span>
        </div>
        <div className="log-detail-row">
          <span className="log-detail-label">Source</span>
          <span className="log-detail-value">{entry?.source ?? "--"}</span>
        </div>
        <div className="log-detail-row">
          <span className="log-detail-label">Message</span>
          <span className="log-detail-value">
            {formatLogText(entry?.error?.message ?? entry?.message ?? "--")}
          </span>
        </div>
        <div className="log-detail-row">
          <span className="log-detail-label">Metadata</span>
          <span className="log-detail-value">{meta || "--"}</span>
        </div>
        <div className="log-detail-stack">{entry?.error?.stack ?? ""}</div>
      </div>
    </aside>
  );
}

import { TabPanel } from "./tab-panel";

interface LogsTabProps {
  activeTab: string;
}

export function LogsTab({ activeTab }: LogsTabProps) {
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
                Real-time request and system logs with live tailing and
                filtering capabilities.
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
          <div className="log-shell newsprint-texture" data-log-root>
            {/* Toolbar */}
            <div className="log-toolbar">
              <div className="log-toolbar-group log-toolbar-primary">
                <div className="log-control log-range">
                  <label className="log-label" htmlFor="log-range-select">
                    Timeline
                  </label>
                  <select data-log-range id="log-range-select">
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
                    data-log-search
                    id="log-search-input"
                    placeholder="Search logs..."
                    type="search"
                  />
                </div>
              </div>
              <div className="log-toolbar-group log-toolbar-actions">
                <button
                  className="btn btn-secondary btn-sm"
                  data-log-reset
                  type="button"
                >
                  Reset
                </button>
                <button
                  aria-pressed="true"
                  className="log-btn log-live is-live btn-newsprint-primary"
                  data-log-live
                  type="button"
                >
                  Live
                  <span aria-hidden="true" className="log-live-dot" />
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  data-log-refresh
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
                  <label className="log-filter-item">
                    <input checked data-log-level="info" type="checkbox" />
                    <span>Info</span>
                    <span className="log-count" data-log-count="info">
                      0
                    </span>
                  </label>
                  <label className="log-filter-item">
                    <input checked data-log-level="warn" type="checkbox" />
                    <span>Warning</span>
                    <span className="log-count" data-log-count="warn">
                      0
                    </span>
                  </label>
                  <label className="log-filter-item">
                    <input checked data-log-level="error" type="checkbox" />
                    <span>Error</span>
                    <span className="log-count" data-log-count="error">
                      0
                    </span>
                  </label>
                  <label className="log-filter-item">
                    <input data-log-level="debug" type="checkbox" />
                    <span>Debug</span>
                    <span className="log-count" data-log-count="debug">
                      0
                    </span>
                  </label>
                </div>

                <div className="log-filter-group">
                  <div className="log-filter-title">Status code</div>
                  <label className="log-filter-item">
                    <input checked data-log-status="2xx" type="checkbox" />
                    <span>2xx Success</span>
                    <span className="log-count" data-log-status-count="2xx">
                      0
                    </span>
                  </label>
                  <label className="log-filter-item">
                    <input checked data-log-status="3xx" type="checkbox" />
                    <span>3xx Redirect</span>
                    <span className="log-count" data-log-status-count="3xx">
                      0
                    </span>
                  </label>
                  <label className="log-filter-item">
                    <input checked data-log-status="4xx" type="checkbox" />
                    <span>4xx Client</span>
                    <span className="log-count" data-log-status-count="4xx">
                      0
                    </span>
                  </label>
                  <label className="log-filter-item">
                    <input checked data-log-status="5xx" type="checkbox" />
                    <span>5xx Server</span>
                    <span className="log-count" data-log-status-count="5xx">
                      0
                    </span>
                  </label>
                  <label className="log-filter-item">
                    <input checked data-log-status="system" type="checkbox" />
                    <span>System</span>
                    <span className="log-count" data-log-status-count="system">
                      0
                    </span>
                  </label>
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
                  <div className="log-list" data-log-list>
                    <div className="log-empty" data-log-empty>
                      Loading logs...
                    </div>
                  </div>
                </div>
                <aside
                  aria-live="polite"
                  className="log-detail is-empty"
                  data-log-detail
                >
                  <div className="log-detail-header">
                    <div className="log-detail-title">
                      <span data-log-detail-method>--</span>
                      <span data-log-detail-path>Pick a request</span>
                    </div>
                    <div className="log-detail-actions">
                      <span className="log-status" data-log-detail-status>
                        --
                      </span>
                      <button
                        aria-label="Close details"
                        className="log-detail-close"
                        data-log-detail-close
                        type="button"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <div className="log-detail-body">
                    <div className="log-detail-row">
                      <span className="log-detail-label">Timestamp</span>
                      <span data-log-detail-time>--</span>
                    </div>
                    <div className="log-detail-row">
                      <span className="log-detail-label">Request ID</span>
                      <span data-log-detail-id>--</span>
                    </div>
                    <div className="log-detail-row">
                      <span className="log-detail-label">Host</span>
                      <span data-log-detail-host>--</span>
                    </div>
                    <div className="log-detail-row">
                      <span className="log-detail-label">Duration</span>
                      <span data-log-detail-duration>--</span>
                    </div>
                    <div className="log-detail-row">
                      <span className="log-detail-label">Source</span>
                      <span data-log-detail-source>--</span>
                    </div>
                    <div className="log-detail-row log-detail-message">
                      <span className="log-detail-label">Message</span>
                      <span data-log-detail-message>--</span>
                    </div>
                    <pre className="log-detail-stack" data-log-detail-stack />
                  </div>
                </aside>
              </div>
            </div>
          </div>
        </div>

        {/* Footer with metadata */}
        <div className="border-ink border-t-2 bg-paper-dark p-4">
          <div className="flex flex-wrap items-center justify-between gap-4 font-mono text-ink-muted text-xs uppercase tracking-widest">
            <span>System Logs v1.0</span>
            <div className="flex items-center gap-6">
              <span>Auto-scroll: ON</span>
              <span>Buffer: 1000 entries</span>
            </div>
          </div>
        </div>
      </section>
    </TabPanel>
  );
}

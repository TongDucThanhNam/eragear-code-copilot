import { useEffect } from "react";
import { createRoot } from "react-dom/client";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  message: string;
  source?: string;
  request?: {
    method: string;
    path: string;
    status: number;
    host?: string;
    durationMs?: number;
  };
  error?: {
    message?: string;
    stack?: string;
  };
}

interface LogListResponse {
  entries: LogEntry[];
}

const LOG_LIMIT = 200;
const LOGS_ENDPOINT = "/api/logs";
const LOGS_STREAM_ENDPOINT = "/api/logs/stream";

function setupTabs(): () => void {
  const buttons = Array.from(
    document.querySelectorAll<HTMLElement>("[data-tab]")
  );
  const panels = Array.from(
    document.querySelectorAll<HTMLElement>("[data-tab-panel]")
  );

  const activate = (tab: string) => {
    for (const btn of buttons) {
      const isActive = btn.getAttribute("data-tab") === tab;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", String(isActive));
    }
    for (const panel of panels) {
      const isActive = panel.getAttribute("data-tab-panel") === tab;
      panel.classList.toggle("hidden", !isActive);
    }

    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState({}, "", url.toString());
    document.body.dataset.activeTab = tab;
    document.documentElement.dataset.activeTab = tab;
    window.dispatchEvent(new CustomEvent("tab-change", { detail: { tab } }));
  };

  const handlers = new Map<HTMLElement, () => void>();
  for (const btn of buttons) {
    const handler = () => {
      const tab = btn.getAttribute("data-tab");
      if (tab) {
        activate(tab);
      }
    };
    handlers.set(btn, handler);
    btn.addEventListener("click", handler);
  }

  const root = document.getElementById("client-root");
  const initialTab =
    root?.getAttribute("data-active-tab") ||
    new URLSearchParams(window.location.search).get("tab");
  if (initialTab) {
    activate(initialTab);
  }

  return () => {
    for (const [btn, handler] of handlers.entries()) {
      btn.removeEventListener("click", handler);
    }
  };
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
}

function statusClass(status?: number): string {
  if (!status) {
    return "log-status";
  }
  if (status >= 500) {
    return "log-status log-status--error";
  }
  if (status >= 400) {
    return "log-status log-status--warn";
  }
  return "log-status log-status--ok";
}

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

function setupLogs(): () => void {
  const root = document.querySelector<HTMLElement>("[data-log-root]");
  if (!root) {
    return () => {};
  }

  const list = root.querySelector<HTMLElement>("[data-log-list]");
  const empty = root.querySelector<HTMLElement>("[data-log-empty]");
  const searchInput = root.querySelector<HTMLInputElement>("[data-log-search]");
  const rangeSelect = root.querySelector<HTMLSelectElement>("[data-log-range]");
  const resetButton = root.querySelector<HTMLButtonElement>("[data-log-reset]");
  const liveButton = root.querySelector<HTMLButtonElement>("[data-log-live]");
  const refreshButton =
    root.querySelector<HTMLButtonElement>("[data-log-refresh]");
  const detailPanel = root.querySelector<HTMLElement>("[data-log-detail]");
  const detailClose = root.querySelector<HTMLButtonElement>(
    "[data-log-detail-close]"
  );
  const levelInputs = Array.from(
    root.querySelectorAll<HTMLInputElement>("[data-log-level]")
  );
  const statusInputs = Array.from(
    root.querySelectorAll<HTMLInputElement>("[data-log-status]")
  );
  const countNodes = new Map<string, HTMLElement>();
  for (const node of root.querySelectorAll<HTMLElement>("[data-log-count]")) {
    const key = node.getAttribute("data-log-count");
    if (key) {
      countNodes.set(key, node);
    }
  }
  const statusCountNodes = new Map<string, HTMLElement>();
  for (const node of root.querySelectorAll<HTMLElement>(
    "[data-log-status-count]"
  )) {
    const key = node.getAttribute("data-log-status-count");
    if (key) {
      statusCountNodes.set(key, node);
    }
  }

  if (!(list && empty && searchInput && rangeSelect && liveButton)) {
    return () => {};
  }

  const state = {
    levels: new Set<string>(),
    statuses: new Set<string>(),
    search: "",
    range: rangeSelect.value || "30m",
    rawEntries: [] as LogEntry[],
    live: liveButton.classList.contains("is-live"),
    selectedId: null as string | null,
  };

  for (const input of levelInputs) {
    if (input.checked) {
      const level = input.getAttribute("data-log-level");
      if (level) {
        state.levels.add(level);
      }
    }
  }

  for (const input of statusInputs) {
    if (input.checked) {
      const status = input.getAttribute("data-log-status");
      if (status) {
        state.statuses.add(status);
      }
    }
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let eventSource: EventSource | null = null;
  const levelHandlers = new Map<HTMLInputElement, () => void>();
  const statusHandlers = new Map<HTMLInputElement, () => void>();
  const listClickHandler = (event: Event) =>
    handleRowSelect(event.target as HTMLElement);
  const detailCloseHandler = () => selectEntry(null);

  const detailElements = {
    method: root.querySelector<HTMLElement>("[data-log-detail-method]"),
    path: root.querySelector<HTMLElement>("[data-log-detail-path]"),
    status: root.querySelector<HTMLElement>("[data-log-detail-status]"),
    time: root.querySelector<HTMLElement>("[data-log-detail-time]"),
    id: root.querySelector<HTMLElement>("[data-log-detail-id]"),
    host: root.querySelector<HTMLElement>("[data-log-detail-host]"),
    duration: root.querySelector<HTMLElement>("[data-log-detail-duration]"),
    source: root.querySelector<HTMLElement>("[data-log-detail-source]"),
    message: root.querySelector<HTMLElement>("[data-log-detail-message]"),
    stack: root.querySelector<HTMLElement>("[data-log-detail-stack]"),
  };

  const updateCounts = () => {
    const counts: Record<LogLevel, number> = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
    };
    const statusCounts: Record<string, number> = {
      "2xx": 0,
      "3xx": 0,
      "4xx": 0,
      "5xx": 0,
      system: 0,
    };
    for (const entry of state.rawEntries) {
      counts[entry.level] += 1;
      const status = entry.request?.status;
      if (status) {
        const bucket = `${Math.floor(status / 100)}xx`;
        if (statusCounts[bucket] !== undefined) {
          statusCounts[bucket] += 1;
        }
      } else {
        statusCounts.system += 1;
      }
    }
    for (const [key, node] of countNodes.entries()) {
      const level = key as LogLevel;
      node.textContent = String(counts[level] ?? 0);
    }
    for (const [key, node] of statusCountNodes.entries()) {
      node.textContent = String(statusCounts[key] ?? 0);
    }
  };

  const renderEntries = (entries: LogEntry[]) => {
    list.innerHTML = "";
    if (!entries.length) {
      empty.textContent = "No logs found for the selected filters.";
      list.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      const row = document.createElement("div");
      row.className = `log-entry log-entry--${entry.level}`;
      row.dataset.logId = entry.id;
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      if (entry.id === state.selectedId) {
        row.classList.add("is-selected");
      }

      const timeCell = document.createElement("div");
      timeCell.className = "log-cell";
      timeCell.textContent = formatTimestamp(entry.timestamp);

      const statusCell = document.createElement("div");
      statusCell.className = `log-cell ${statusClass(entry.request?.status)}`;
      statusCell.textContent = entry.request?.status?.toString() ?? "--";

      const hostCell = document.createElement("div");
      hostCell.className = "log-cell";
      hostCell.textContent = entry.request?.host ?? "--";

      const requestCell = document.createElement("div");
      requestCell.className = "log-cell log-request";
      if (entry.request) {
        requestCell.textContent = `${entry.request.method} ${entry.request.path}`;
      } else {
        requestCell.textContent = entry.source ?? "--";
      }

      const messageCell = document.createElement("div");
      messageCell.className = "log-cell log-message";
      const durationText = entry.request?.durationMs
        ? `${entry.request.durationMs}ms`
        : undefined;
      messageCell.textContent =
        entry.error?.message ?? durationText ?? entry.message;
      messageCell.title = messageCell.textContent;

      row.append(timeCell, statusCell, hostCell, requestCell, messageCell);
      fragment.appendChild(row);
    }
    list.appendChild(fragment);
  };

  const renderDetail = (entry: LogEntry | null) => {
    if (!detailPanel) {
      return;
    }
    if (!entry) {
      detailPanel.classList.add("is-empty");
      if (detailElements.method) {
        detailElements.method.textContent = "--";
      }
      if (detailElements.path) {
        detailElements.path.textContent = "Pick a request";
      }
      if (detailElements.status) {
        detailElements.status.textContent = "--";
        detailElements.status.className = "log-status";
      }
      if (detailElements.time) {
        detailElements.time.textContent = "--";
      }
      if (detailElements.id) {
        detailElements.id.textContent = "--";
      }
      if (detailElements.host) {
        detailElements.host.textContent = "--";
      }
      if (detailElements.duration) {
        detailElements.duration.textContent = "--";
      }
      if (detailElements.source) {
        detailElements.source.textContent = "--";
      }
      if (detailElements.message) {
        detailElements.message.textContent = "--";
      }
      if (detailElements.stack) {
        detailElements.stack.textContent = "";
      }
      return;
    }

    detailPanel.classList.remove("is-empty");
    const statusValue = entry.request?.status;
    if (detailElements.method) {
      detailElements.method.textContent = entry.request?.method ?? entry.level;
    }
    if (detailElements.path) {
      detailElements.path.textContent = entry.request?.path ?? entry.message;
    }
    if (detailElements.status) {
      detailElements.status.textContent = statusValue
        ? String(statusValue)
        : entry.level.toUpperCase();
      detailElements.status.className = statusClass(statusValue);
    }
    if (detailElements.time) {
      detailElements.time.textContent = formatTimestamp(entry.timestamp);
    }
    if (detailElements.id) {
      detailElements.id.textContent = entry.id;
    }
    if (detailElements.host) {
      detailElements.host.textContent = entry.request?.host ?? "--";
    }
    if (detailElements.duration) {
      detailElements.duration.textContent = entry.request?.durationMs
        ? `${entry.request.durationMs}ms`
        : "--";
    }
    if (detailElements.source) {
      detailElements.source.textContent = entry.source ?? "--";
    }
    if (detailElements.message) {
      detailElements.message.textContent =
        entry.error?.message ?? entry.message;
    }
    if (detailElements.stack) {
      detailElements.stack.textContent = entry.error?.stack ?? "";
    }
  };

  const applyFilters = () => {
    const searchText = state.search.toLowerCase();
    const hasSearch = searchText.length > 0;

    if (state.levels.size === 0 || state.statuses.size === 0) {
      renderEntries([]);
      return;
    }

    const filtered = state.rawEntries.filter((entry) => {
      if (state.levels.size > 0 && !state.levels.has(entry.level)) {
        return false;
      }
      const status = entry.request?.status;
      const bucket = status ? `${Math.floor(status / 100)}xx` : "system";
      if (state.statuses.size > 0 && !state.statuses.has(bucket)) {
        return false;
      }
      if (hasSearch && !entrySearchText(entry).includes(searchText)) {
        return false;
      }
      return true;
    });

    renderEntries(filtered);
    if (state.selectedId) {
      const selected =
        filtered.find((entry) => entry.id === state.selectedId) ??
        state.rawEntries.find((entry) => entry.id === state.selectedId) ??
        null;
      if (!selected) {
        state.selectedId = null;
      }
      renderDetail(selected);
    } else {
      renderDetail(null);
    }
  };

  const fetchLogs = async () => {
    const params = new URLSearchParams();
    params.set("limit", String(LOG_LIMIT));
    params.set("order", "desc");
    const from = rangeToFrom(state.range);
    if (from) {
      params.set("from", String(from));
    }

    try {
      empty.textContent = "Loading logs...";
      const response = await fetch(`${LOGS_ENDPOINT}?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as LogListResponse;
      state.rawEntries = Array.isArray(data.entries) ? data.entries : [];
      updateCounts();
      applyFilters();
    } catch (error) {
      list.innerHTML = "";
      empty.textContent = "Failed to load logs.";
      list.appendChild(empty);
      if (console?.error) {
        console.error("Failed to fetch logs:", error);
      }
    }
  };

  const handleLiveEntry = (entry: LogEntry) => {
    const from = rangeToFrom(state.range);
    if (from && entry.timestamp < from) {
      return;
    }
    state.rawEntries.unshift(entry);
    if (state.rawEntries.length > LOG_LIMIT) {
      state.rawEntries.pop();
    }
    updateCounts();
    applyFilters();
  };

  const openLive = () => {
    if (eventSource) {
      return;
    }
    eventSource = new EventSource(LOGS_STREAM_ENDPOINT);
    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as LogEntry;
        handleLiveEntry(parsed);
      } catch (error) {
        if (console?.error) {
          console.error("Failed to parse log entry:", error);
        }
      }
    };
    eventSource.onerror = () => {
      // EventSource retries automatically; keep the handle open.
    };
  };

  const closeLive = () => {
    if (!eventSource) {
      return;
    }
    eventSource.close();
    eventSource = null;
  };

  const setLive = (enabled: boolean) => {
    state.live = enabled;
    liveButton.classList.toggle("is-live", enabled);
    liveButton.setAttribute("aria-pressed", String(enabled));
    if (enabled && isLogsActive()) {
      openLive();
    } else {
      closeLive();
    }
  };

  const isLogsActive = () => {
    const panel = document.querySelector('[data-tab-panel="logs"]');
    return panel ? !panel.classList.contains("hidden") : false;
  };

  const handleTabChange = (event: Event) => {
    const detail = (event as CustomEvent).detail as { tab?: string };
    if (detail?.tab === "logs") {
      fetchLogs();
      if (state.live) {
        openLive();
      }
    } else {
      closeLive();
    }
  };

  const handleSearch = () => {
    state.search = searchInput.value.trim();
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      applyFilters();
    }, 200);
  };

  const handleRangeChange = () => {
    state.range = rangeSelect.value;
    fetchLogs();
  };

  const handleLevelToggle = (input: HTMLInputElement) => {
    const level = input.getAttribute("data-log-level");
    if (!level) {
      return;
    }
    if (input.checked) {
      state.levels.add(level);
    } else {
      state.levels.delete(level);
    }
    applyFilters();
  };

  const handleStatusToggle = (input: HTMLInputElement) => {
    const status = input.getAttribute("data-log-status");
    if (!status) {
      return;
    }
    if (input.checked) {
      state.statuses.add(status);
    } else {
      state.statuses.delete(status);
    }
    applyFilters();
  };

  const handleReset = () => {
    searchInput.value = "";
    state.search = "";
    rangeSelect.value = "30m";
    state.range = "30m";
    state.levels.clear();
    state.statuses.clear();
    for (const input of levelInputs) {
      input.checked = input.getAttribute("data-log-level") !== "debug";
      const level = input.getAttribute("data-log-level");
      if (level) {
        if (input.checked) {
          state.levels.add(level);
        } else {
          state.levels.delete(level);
        }
      }
    }
    for (const input of statusInputs) {
      input.checked = true;
      const status = input.getAttribute("data-log-status");
      if (status) {
        state.statuses.add(status);
      }
    }
    fetchLogs();
  };

  const selectEntry = (entry: LogEntry | null) => {
    state.selectedId = entry?.id ?? null;
    renderDetail(entry);
    for (const row of list.querySelectorAll(".log-entry")) {
      const id = row.getAttribute("data-log-id");
      row.classList.toggle("is-selected", id === state.selectedId);
    }
  };

  const handleRowSelect = (target: HTMLElement | null) => {
    if (!target) {
      return;
    }
    const row = target.closest<HTMLElement>(".log-entry");
    if (!row) {
      return;
    }
    const id = row.getAttribute("data-log-id");
    if (!id) {
      return;
    }
    const entry = state.rawEntries.find((item) => item.id === id) ?? null;
    selectEntry(entry);
  };

  const handleRowKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    handleRowSelect(event.target as HTMLElement);
  };

  const handleRefresh = () => {
    fetchLogs();
  };

  const handleLiveToggle = () => {
    setLive(!state.live);
  };

  searchInput.addEventListener("input", handleSearch);
  rangeSelect.addEventListener("change", handleRangeChange);
  resetButton?.addEventListener("click", handleReset);
  refreshButton?.addEventListener("click", handleRefresh);
  liveButton.addEventListener("click", handleLiveToggle);
  detailClose?.addEventListener("click", detailCloseHandler);
  list.addEventListener("click", listClickHandler);
  list.addEventListener("keydown", handleRowKeydown);
  for (const input of levelInputs) {
    const handler = () => handleLevelToggle(input);
    levelHandlers.set(input, handler);
    input.addEventListener("change", handler);
  }
  for (const input of statusInputs) {
    const handler = () => handleStatusToggle(input);
    statusHandlers.set(input, handler);
    input.addEventListener("change", handler);
  }
  window.addEventListener("tab-change", handleTabChange);

  fetchLogs();
  if (state.live && isLogsActive()) {
    openLive();
  }

  return () => {
    searchInput.removeEventListener("input", handleSearch);
    rangeSelect.removeEventListener("change", handleRangeChange);
    resetButton?.removeEventListener("click", handleReset);
    refreshButton?.removeEventListener("click", handleRefresh);
    liveButton.removeEventListener("click", handleLiveToggle);
    detailClose?.removeEventListener("click", detailCloseHandler);
    list.removeEventListener("click", listClickHandler);
    list.removeEventListener("keydown", handleRowKeydown);
    for (const [input, handler] of levelHandlers.entries()) {
      input.removeEventListener("change", handler);
    }
    for (const [input, handler] of statusHandlers.entries()) {
      input.removeEventListener("change", handler);
    }
    window.removeEventListener("tab-change", handleTabChange);
    closeLive();
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
  };
}

function ClientApp() {
  useEffect(() => {
    const cleanupTabs = setupTabs();
    const cleanupLogs = setupLogs();
    return () => {
      cleanupTabs();
      cleanupLogs();
    };
  }, []);

  return null;
}

const root = document.getElementById("client-root");
if (root) {
  createRoot(root).render(<ClientApp />);
}

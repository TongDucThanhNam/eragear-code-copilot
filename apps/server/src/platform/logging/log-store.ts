import { existsSync, mkdirSync } from "node:fs";
import { appendFile, readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { ENV } from "@/config/environment";
import {
  ensureStorageDirSync,
  getStorageDirPathSync,
} from "@/platform/storage/storage-path";
import type {
  LogListResult,
  LogStorePort,
} from "@/shared/ports/log-store.port";
import {
  LOG_LEVELS,
  type LogEntry,
  type LogLevel,
  type LogQuery,
} from "@/shared/types/log.types";
import { matchesLogQuery } from "@/shared/utils/log-query.util";

const LOG_DIR_NAME = "logs";
const LOG_FILE_PREFIX = "logs-";
const LOG_FILE_SUFFIX = ".ndjson";
const LOG_FILE_DATE_PATTERN = new RegExp(
  `^${LOG_FILE_PREFIX}(\\d{4}-\\d{2}-\\d{2})${LOG_FILE_SUFFIX}$`
);
const VALID_LOG_LEVELS = new Set<LogLevel>(LOG_LEVELS);

interface BufferedLogLine {
  datePart: string;
  line: string;
}

function createLevelCounts(): Record<LogLevel, number> {
  return {
    debug: 0,
    info: 0,
    warn: 0,
    error: 0,
  };
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function ensureLogDir(): string {
  ensureStorageDirSync();
  const logDir = path.join(getStorageDirPathSync(), LOG_DIR_NAME);
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  return logDir;
}

function parseLogFileDate(file: string): string | null {
  const match = file.match(LOG_FILE_DATE_PATTERN);
  return match?.[1] ?? null;
}

function getUtcDayEndTimestamp(datePart: string): number {
  return Date.parse(`${datePart}T23:59:59.999Z`);
}

function compareEntriesAscending(left: LogEntry, right: LogEntry): number {
  if (left.timestamp !== right.timestamp) {
    return left.timestamp - right.timestamp;
  }
  return left.id.localeCompare(right.id);
}

function buildLogListResult(
  entries: LogEntry[],
  query?: LogQuery
): LogListResult {
  const resolvedQuery = query ?? {};
  const ordered = [...entries];
  ordered.sort(compareEntriesAscending);

  const filtered: LogEntry[] = [];
  const filteredCounts = createLevelCounts();

  for (const entry of ordered) {
    if (!matchesLogQuery(entry, resolvedQuery)) {
      continue;
    }
    if (!VALID_LOG_LEVELS.has(entry.level)) {
      continue;
    }
    filteredCounts[entry.level] += 1;
    filtered.push(entry);
  }

  if ((resolvedQuery.order ?? "desc") === "desc") {
    filtered.reverse();
  }

  const limit = resolvedQuery.limit;
  const limited =
    typeof limit === "number" ? filtered.slice(0, limit) : filtered;

  return {
    entries: limited,
    stats: {
      total: filtered.length,
      levels: filteredCounts,
    },
  };
}

class LogFileSink {
  private readonly flushIntervalMs: number;
  private readonly retentionDays?: number;
  private readonly buffer: BufferedLogLine[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushPromise: Promise<void> | null = null;
  private activeDate = "";
  private activePath = "";

  constructor(params: { flushIntervalMs: number; retentionDays?: number }) {
    this.flushIntervalMs = params.flushIntervalMs;
    this.retentionDays = params.retentionDays;
  }

  append(entry: LogEntry): void {
    this.buffer.push({
      datePart: formatDate(new Date(entry.timestamp)),
      line: JSON.stringify(entry),
    });
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flush().catch((error) => {
        process.stderr.write(
          `[LogStore] Failed to flush logs: ${String(error)}\n`
        );
      });
    }, this.flushIntervalMs);
    this.flushTimer.unref?.();
  }

  private resolveFilePath(datePart: string): string {
    if (datePart !== this.activeDate) {
      this.activeDate = datePart;
      const dir = ensureLogDir();
      this.activePath = path.join(
        dir,
        `${LOG_FILE_PREFIX}${datePart}${LOG_FILE_SUFFIX}`
      );
      if (this.retentionDays) {
        this.cleanupOldFiles(dir).catch((error) => {
          process.stderr.write(
            `[LogStore] Failed to cleanup logs: ${String(error)}\n`
          );
        });
      }
    }
    if (!this.activePath) {
      const dir = ensureLogDir();
      this.activeDate = datePart;
      this.activePath = path.join(
        dir,
        `${LOG_FILE_PREFIX}${datePart}${LOG_FILE_SUFFIX}`
      );
    }
    return this.activePath;
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.flushPromise) {
      await this.flushPromise;
      return;
    }

    const flushPromise = (async () => {
      while (this.buffer.length > 0) {
        const batch = this.buffer.splice(0, this.buffer.length);
        if (!batch.length) {
          return;
        }
        try {
          const batchesByDate = new Map<string, string[]>();
          for (const entry of batch) {
            const lines = batchesByDate.get(entry.datePart);
            if (lines) {
              lines.push(entry.line);
              continue;
            }
            batchesByDate.set(entry.datePart, [entry.line]);
          }
          for (const [datePart, lines] of batchesByDate) {
            const filePath = this.resolveFilePath(datePart);
            const payload = `${lines.join("\n")}\n`;
            await appendFile(filePath, payload, "utf-8");
          }
        } catch (error) {
          this.buffer.unshift(...batch);
          throw error;
        }
      }
    })();

    this.flushPromise = flushPromise;
    try {
      await flushPromise;
    } finally {
      if (this.flushPromise === flushPromise) {
        this.flushPromise = null;
      }
    }
  }

  private async cleanupOldFiles(logDir: string): Promise<void> {
    const retentionDays = this.retentionDays;
    if (!retentionDays) {
      return;
    }
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    try {
      const files = await readdir(logDir);
      for (const file of files.filter((entry) =>
        entry.startsWith(LOG_FILE_PREFIX)
      )) {
        const datePart = parseLogFileDate(file);
        if (!datePart) {
          continue;
        }
        const timestamp = getUtcDayEndTimestamp(datePart);
        if (Number.isNaN(timestamp) || timestamp >= cutoff) {
          continue;
        }
        try {
          await unlink(path.join(logDir, file));
        } catch (error) {
          process.stderr.write(
            `[LogStore] Failed to delete retained log file ${file}: ${String(
              error
            )}\n`
          );
        }
      }
    } catch (error) {
      process.stderr.write(
        `[LogStore] Failed to cleanup logs: ${String(error)}\n`
      );
    }
  }
}

export class LogStore implements LogStorePort {
  private readonly maxEntries: number;
  private readonly buffer: Array<LogEntry | undefined>;
  private start = 0;
  private size = 0;
  private readonly listeners = new Set<(entry: LogEntry) => void>();
  private readonly fileSink?: LogFileSink;

  constructor(params?: { maxEntries?: number }) {
    this.maxEntries = Math.max(1, params?.maxEntries ?? ENV.logBufferLimit);
    this.buffer = new Array(this.maxEntries);
    if (ENV.logFileEnabled) {
      this.fileSink = new LogFileSink({
        flushIntervalMs: ENV.logFlushIntervalMs,
        retentionDays: ENV.logRetentionDays,
      });
    }
  }

  append(entry: LogEntry): void {
    const isFull = this.size === this.maxEntries;
    if (isFull) {
      this.buffer[this.start] = entry;
      this.start = (this.start + 1) % this.maxEntries;
    } else {
      const index = (this.start + this.size) % this.maxEntries;
      this.buffer[index] = entry;
      this.size += 1;
    }
    this.fileSink?.append(entry);

    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch (error) {
        process.stderr.write(`[LogStore] Listener error: ${String(error)}\n`);
      }
    }
  }

  list(query?: LogQuery): LogListResult {
    return buildLogListResult(this.toArray(), query);
  }

  async query(query?: LogQuery): Promise<LogListResult> {
    await this.fileSink?.flush();
    const deduped = new Map<string, LogEntry>();

    for (const entry of await this.readPersistedEntries()) {
      deduped.set(entry.id, entry);
    }
    for (const entry of this.toArray()) {
      deduped.set(entry.id, entry);
    }

    return buildLogListResult([...deduped.values()], query);
  }

  subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async flush(): Promise<void> {
    await this.fileSink?.flush();
  }

  private async readPersistedEntries(): Promise<LogEntry[]> {
    if (!ENV.logFileEnabled) {
      return [];
    }

    const logDir = path.join(getStorageDirPathSync(), LOG_DIR_NAME);
    if (!existsSync(logDir)) {
      return [];
    }

    let files: string[];
    try {
      files = await readdir(logDir);
    } catch (error) {
      process.stderr.write(
        `[LogStore] Failed to list log files: ${String(error)}\n`
      );
      return [];
    }

    const selectedFiles = files
      .filter((file) => parseLogFileDate(file) !== null)
      .sort();

    const entries: LogEntry[] = [];
    for (const file of selectedFiles) {
      try {
        const content = await readFile(path.join(logDir, file), "utf-8");
        for (const line of content.split("\n")) {
          const normalizedLine = line.trim();
          if (!normalizedLine) {
            continue;
          }
          try {
            const parsed = JSON.parse(normalizedLine) as LogEntry;
            if (
              !parsed ||
              typeof parsed !== "object" ||
              typeof parsed.id !== "string" ||
              typeof parsed.timestamp !== "number" ||
              typeof parsed.message !== "string" ||
              typeof parsed.level !== "string" ||
              !VALID_LOG_LEVELS.has(parsed.level as LogLevel)
            ) {
              continue;
            }
            if (
              parsed.userId !== undefined &&
              typeof parsed.userId !== "string"
            ) {
              continue;
            }
            entries.push(parsed);
          } catch (error) {
            process.stderr.write(
              `[LogStore] Failed to parse log line in ${file}: ${String(
                error
              )}\n`
            );
          }
        }
      } catch (error) {
        process.stderr.write(
          `[LogStore] Failed to read log file ${file}: ${String(error)}\n`
        );
      }
    }

    return entries;
  }

  private toArray(): LogEntry[] {
    const entries: LogEntry[] = [];
    for (let i = 0; i < this.size; i += 1) {
      const index = (this.start + i) % this.maxEntries;
      const entry = this.buffer[index];
      if (entry) {
        entries.push(entry);
      }
    }
    return entries;
  }
}

let logStoreInstance: LogStore | null = null;

export function getLogStore(): LogStore {
  if (!logStoreInstance) {
    logStoreInstance = new LogStore();
  }
  return logStoreInstance;
}

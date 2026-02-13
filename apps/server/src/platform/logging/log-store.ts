import { existsSync, mkdirSync } from "node:fs";
import { appendFile, readdir, unlink } from "node:fs/promises";
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
import type {
  LogEntry,
  LogLevel,
  LogQuery,
  LogStats,
} from "@/shared/types/log.types";

const LOG_DIR_NAME = "logs";
const LOG_FILE_PREFIX = "logs-";
const LOG_FILE_SUFFIX = ".ndjson";

function createLevelCounts(): Record<LogLevel, number> {
  return {
    debug: 0,
    info: 0,
    warn: 0,
    error: 0,
  };
}

function matchesSearch(entry: LogEntry, search: string): boolean {
  const base = [
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
  return base.includes(search);
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

class LogFileSink {
  private readonly flushIntervalMs: number;
  private readonly retentionDays?: number;
  private readonly buffer: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private activeDate = "";
  private activePath = "";

  constructor(params: { flushIntervalMs: number; retentionDays?: number }) {
    this.flushIntervalMs = params.flushIntervalMs;
    this.retentionDays = params.retentionDays;
  }

  append(entry: LogEntry): void {
    this.buffer.push(JSON.stringify(entry));
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
  }

  private async waitForCurrentFlush(): Promise<void> {
    if (!this.flushing) {
      return;
    }
    await new Promise<void>((resolve) => {
      const poll = () => {
        if (!this.flushing) {
          resolve();
          return;
        }
        const timer = setTimeout(poll, 5);
        timer.unref?.();
      };
      poll();
    });
  }

  private resolveFilePath(): string {
    const date = formatDate(new Date());
    if (date !== this.activeDate) {
      this.activeDate = date;
      const dir = ensureLogDir();
      this.activePath = path.join(
        dir,
        `${LOG_FILE_PREFIX}${date}${LOG_FILE_SUFFIX}`
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
      this.activeDate = date;
      this.activePath = path.join(
        dir,
        `${LOG_FILE_PREFIX}${date}${LOG_FILE_SUFFIX}`
      );
    }
    return this.activePath;
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.flushing) {
      await this.waitForCurrentFlush();
    }

    while (this.buffer.length > 0) {
      this.flushing = true;
      const batch = this.buffer.splice(0, this.buffer.length);
      if (!batch.length) {
        this.flushing = false;
        return;
      }
      const payload = `${batch.join("\n")}\n`;
      try {
        const filePath = this.resolveFilePath();
        await appendFile(filePath, payload, "utf-8");
      } catch (error) {
        process.stderr.write(
          `[LogStore] Failed to append logs: ${String(error)}\n`
        );
      } finally {
        this.flushing = false;
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
      const deletions = files
        .filter((file) => file.startsWith(LOG_FILE_PREFIX))
        .map(async (file) => {
          const match = file.match(
            new RegExp(`^${LOG_FILE_PREFIX}(\\d{4}-\\d{2}-\\d{2})`)
          );
          if (!match) {
            return;
          }
          const datePart = match[1];
          if (!datePart) {
            return;
          }
          const timestamp = new Date(datePart).getTime();
          if (Number.isNaN(timestamp) || timestamp >= cutoff) {
            return;
          }
          await unlink(path.join(logDir, file));
        });
      await Promise.allSettled(deletions);
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
    const entries = this.toArray();
    const levels =
      query?.levels && query.levels.length > 0 ? new Set(query.levels) : null;
    const search = query?.search?.trim().toLowerCase();
    const from = query?.from;
    const to = query?.to;
    const order = query?.order ?? "desc";

    const filtered: LogEntry[] = [];
    const filteredCounts = createLevelCounts();

    for (const entry of entries) {
      if (from !== undefined && entry.timestamp < from) {
        continue;
      }
      if (to !== undefined && entry.timestamp > to) {
        continue;
      }
      if (levels && !levels.has(entry.level)) {
        continue;
      }
      if (search && !matchesSearch(entry, search)) {
        continue;
      }
      filteredCounts[entry.level] += 1;
      filtered.push(entry);
    }

    if (order === "desc") {
      filtered.reverse();
    }

    const limit = query?.limit;
    const limited =
      typeof limit === "number" ? filtered.slice(0, limit) : filtered;

    const stats: LogStats = {
      total: filtered.length,
      levels: filteredCounts,
    };

    return { entries: limited, stats };
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

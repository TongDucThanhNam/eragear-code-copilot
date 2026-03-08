import { format } from "node:util";
import type { LogStorePort } from "@/shared/ports/log-store.port";
import type { LogEntry, LogLevel } from "@/shared/types/log.types";
import { isAcpLogMessage } from "@/shared/utils/acp-log.util";
import { createId } from "@/shared/utils/id.util";
import { getObservabilityContext } from "@/shared/utils/observability-context.util";
import { getLogStore } from "./log-store";
import { shouldEmitRuntimeLog } from "./runtime-log-level";

type ConsoleMethod = "log" | "info" | "warn" | "error" | "debug" | "trace";

type NativeConsole = Record<ConsoleMethod, (...args: unknown[]) => void>;
type LogMetaValue = string | number | boolean | null;

const nativeConsole: NativeConsole = {
  log: console.log.bind(console),
  info: (console.info ?? console.log).bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: (console.debug ?? console.log).bind(console),
  trace: (console.trace ?? console.log).bind(console),
};

const LOG_LEVELS = new Set<LogLevel>(["debug", "info", "warn", "error"]);
let consoleCaptureDepth = 0;

function findError(args: unknown[]): Error | undefined {
  for (const arg of args) {
    if (arg instanceof Error) {
      return arg;
    }
  }
  return undefined;
}

function resolveMethod(level: LogLevel): ConsoleMethod {
  switch (level) {
    case "error":
      return "error";
    case "warn":
      return "warn";
    case "debug":
      return "debug";
    default:
      return "info";
  }
}

function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && LOG_LEVELS.has(value as LogLevel);
}

function normalizeMetaValue(value: unknown): LogMetaValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeMetaRecord(
  input: unknown
): Record<string, LogMetaValue> | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const result: Record<string, LogMetaValue> = {};
  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      continue;
    }
    result[normalizedKey] = normalizeMetaValue(value);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function parseStructuredConsolePayload(message: string): {
  level?: LogLevel;
  tag?: string;
  message: string;
  context?: Record<string, LogMetaValue>;
  chatId?: string;
  userId?: string;
} | null {
  try {
    const parsed = JSON.parse(message) as Record<string, unknown>;
    const payloadMessage =
      typeof parsed.message === "string" ? parsed.message : null;
    if (!payloadMessage) {
      return null;
    }
    const payloadLevel = isLogLevel(parsed.level) ? parsed.level : undefined;
    const payloadTag = typeof parsed.tag === "string" ? parsed.tag : undefined;
    const payloadContext = normalizeMetaRecord(parsed.context);
    const chatId =
      parsed.context &&
      typeof parsed.context === "object" &&
      typeof (parsed.context as { chatId?: unknown }).chatId === "string"
        ? ((parsed.context as { chatId?: string }).chatId ?? undefined)
        : undefined;
    const userId =
      parsed.context &&
      typeof parsed.context === "object" &&
      typeof (parsed.context as { userId?: unknown }).userId === "string"
        ? ((parsed.context as { userId?: string }).userId ?? undefined)
        : undefined;
    return {
      level: payloadLevel,
      tag: payloadTag,
      message: payloadMessage,
      context: payloadContext,
      chatId,
      userId,
    };
  } catch {
    return null;
  }
}

export class Logger {
  private readonly store: LogStorePort;

  constructor(store: LogStorePort) {
    this.store = store;
  }

  log(level: LogLevel, message: string, context?: Partial<LogEntry>): void {
    if (!shouldEmitRuntimeLog(level)) {
      return;
    }
    const entry = this.buildEntry(level, message, context);
    this.store.append(entry);
    const method = resolveMethod(level);
    nativeConsole[method](message);
  }

  logArgs(
    level: LogLevel,
    method: ConsoleMethod,
    args: unknown[],
    context?: Partial<LogEntry>
  ): void {
    if (!shouldEmitRuntimeLog(level)) {
      return;
    }
    const error = findError(args);
    const message = format(...args);
    const normalizedError =
      context?.error ??
      (error ? { message: error.message, stack: error.stack } : undefined);

    if (context?.source === "console") {
      this.appendConsoleEntry({
        level,
        message,
        context,
        normalizedError,
      });
      nativeConsole[method](...args);
      return;
    }

    const entry = this.buildEntry(level, message, {
      ...context,
      error: normalizedError,
    });
    this.store.append(entry);
    nativeConsole[method](...args);
  }

  private appendConsoleEntry(params: {
    level: LogLevel;
    message: string;
    context?: Partial<LogEntry>;
    normalizedError?: LogEntry["error"];
  }): void {
    const { level, message, context, normalizedError } = params;
    const acpRelated = isAcpLogMessage(message);
    const payload = parseStructuredConsolePayload(message);
    if (payload) {
      const resolvedLevel = payload.level ?? level;
      const payloadAcpRelated = isAcpLogMessage(payload.message);
      const mergedMeta = {
        ...(context?.meta ?? {}),
        ...(payload.context ?? {}),
        ...(payload.tag ? { structuredTag: payload.tag } : {}),
      };
      const entry = this.buildEntry(resolvedLevel, payload.message, {
        ...context,
        source: payloadAcpRelated ? "acp" : context?.source,
        userId: context?.userId ?? payload.userId,
        chatId: context?.chatId ?? payload.chatId,
        meta: mergedMeta,
        error: normalizedError,
      });
      this.store.append(entry);
      return;
    }

    const entry = this.buildEntry(level, message, {
      ...context,
      source: acpRelated ? "acp" : context?.source,
      error: normalizedError,
    });
    this.store.append(entry);
  }

  private buildEntry(
    level: LogLevel,
    message: string,
    context?: Partial<LogEntry>
  ): LogEntry {
    const observability = getObservabilityContext();
    const mergedMeta: Record<string, string | number | boolean | null> = {
      ...(context?.meta ?? {}),
    };
    if (observability?.route && mergedMeta.route === undefined) {
      mergedMeta.route = observability.route;
    }

    return {
      id: context?.id ?? createId("log"),
      timestamp: context?.timestamp ?? Date.now(),
      level,
      message,
      userId: context?.userId ?? observability?.userId,
      source: context?.source ?? observability?.source,
      requestId: context?.requestId ?? observability?.requestId,
      traceId: context?.traceId ?? observability?.traceId,
      chatId: context?.chatId ?? observability?.chatId,
      taskName: context?.taskName ?? observability?.taskName,
      taskRunId: context?.taskRunId ?? observability?.taskRunId,
      request: context?.request,
      error: context?.error,
      meta: Object.keys(mergedMeta).length > 0 ? mergedMeta : undefined,
    };
  }
}

let loggerInstance: Logger | null = null;
let consoleInstalled = false;

export function getLogger(): Logger {
  if (!loggerInstance) {
    loggerInstance = new Logger(getLogStore());
  }
  return loggerInstance;
}

export function installConsoleLogger(): Logger {
  if (consoleInstalled) {
    return getLogger();
  }
  const logger = getLogger();

  const bindConsoleMethod =
    (level: LogLevel, method: ConsoleMethod) =>
    (...args: unknown[]) => {
      if (consoleCaptureDepth > 0) {
        nativeConsole[method](...args);
        return;
      }
      consoleCaptureDepth += 1;
      try {
        logger.logArgs(level, method, args, { source: "console" });
      } finally {
        consoleCaptureDepth -= 1;
      }
    };

  console.log = bindConsoleMethod("info", "log");
  console.info = bindConsoleMethod("info", "info");
  console.warn = bindConsoleMethod("warn", "warn");
  console.error = bindConsoleMethod("error", "error");
  console.debug = bindConsoleMethod("debug", "debug");
  console.trace = bindConsoleMethod("debug", "trace");

  consoleInstalled = true;
  return logger;
}

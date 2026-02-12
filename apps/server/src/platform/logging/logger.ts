import { format } from "node:util";
import type { LogStorePort } from "@/shared/ports/log-store.port";
import type { LogEntry, LogLevel } from "@/shared/types/log.types";
import { createId } from "@/shared/utils/id.util";
import { getObservabilityContext } from "@/shared/utils/observability-context.util";
import { getLogStore } from "./log-store";
import { shouldEmitRuntimeLog } from "./runtime-log-level";

type ConsoleMethod = "log" | "info" | "warn" | "error" | "debug" | "trace";

type NativeConsole = Record<ConsoleMethod, (...args: unknown[]) => void>;

const nativeConsole: NativeConsole = {
  log: console.log.bind(console),
  info: (console.info ?? console.log).bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: (console.debug ?? console.log).bind(console),
  trace: (console.trace ?? console.log).bind(console),
};

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
    const entry = this.buildEntry(level, message, {
      ...context,
      error:
        context?.error ??
        (error ? { message: error.message, stack: error.stack } : undefined),
    });
    this.store.append(entry);
    nativeConsole[method](...args);
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
    if (observability?.userId && mergedMeta.userId === undefined) {
      mergedMeta.userId = observability.userId;
    }

    return {
      id: context?.id ?? createId("log"),
      timestamp: context?.timestamp ?? Date.now(),
      level,
      message,
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

  console.log = (...args: unknown[]) =>
    logger.logArgs("info", "log", args, { source: "console" });
  console.info = (...args: unknown[]) =>
    logger.logArgs("info", "info", args, { source: "console" });
  console.warn = (...args: unknown[]) =>
    logger.logArgs("warn", "warn", args, { source: "console" });
  console.error = (...args: unknown[]) =>
    logger.logArgs("error", "error", args, { source: "console" });
  console.debug = (...args: unknown[]) =>
    logger.logArgs("debug", "debug", args, { source: "console" });
  console.trace = (...args: unknown[]) =>
    logger.logArgs("debug", "trace", args, { source: "console" });

  consoleInstalled = true;
  return logger;
}

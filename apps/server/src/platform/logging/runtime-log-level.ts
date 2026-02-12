import type { LogLevel } from "@/shared/types/log.types";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let runtimeLogLevel: LogLevel = "debug";

export function setRuntimeLogLevel(level: LogLevel): void {
  runtimeLogLevel = level;
}

export function getRuntimeLogLevel(): LogLevel {
  return runtimeLogLevel;
}

export function shouldEmitRuntimeLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[runtimeLogLevel];
}

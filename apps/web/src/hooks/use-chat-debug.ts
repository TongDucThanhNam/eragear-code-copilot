const DEBUG_FLAG_STORAGE_KEY = "ERAGEAR_DEBUG_CHAT";
const DEBUG_DEDUPE_WINDOW_MS = 800;
const DEBUG_MAX_FINGERPRINTS = 400;
const recentDebugFingerprints = new Map<string, number>();

function readWindowDebugFlag(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const candidate = window as typeof window & {
    __ERAGEAR_DEBUG_CHAT__?: unknown;
  };
  if (candidate.__ERAGEAR_DEBUG_CHAT__ === true) {
    return true;
  }
  try {
    return window.localStorage.getItem(DEBUG_FLAG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function isChatDebugEnabled(): boolean {
  return readWindowDebugFlag();
}

function stableSerialize(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  const type = typeof value;
  if (type === "string") {
    return JSON.stringify(value);
  }
  if (type === "number" || type === "boolean") {
    return String(value);
  }
  if (type === "bigint") {
    return `${String(value)}n`;
  }
  if (type === "function") {
    return "[function]";
  }
  if (type === "symbol") {
    return `[symbol:${String(value)}]`;
  }
  if (type !== "object") {
    return `[${type}]`;
  }

  const objectValue = value as Record<string, unknown>;
  if (seen.has(objectValue)) {
    return "[circular]";
  }
  seen.add(objectValue);

  if (Array.isArray(objectValue)) {
    const items = objectValue.map((item) => stableSerialize(item, seen));
    return `[${items.join(",")}]`;
  }

  const keys = Object.keys(objectValue).sort();
  const pairs = keys.map((key) => {
    const nestedValue = stableSerialize(objectValue[key], seen);
    return `${JSON.stringify(key)}:${nestedValue}`;
  });
  return `{${pairs.join(",")}}`;
}

function shouldSkipDuplicateLog(
  scope: string,
  message: string,
  meta?: Record<string, unknown>
): boolean {
  const fingerprint = `${scope}|${message}|${meta ? stableSerialize(meta) : ""}`;
  const now = Date.now();
  const previousAt = recentDebugFingerprints.get(fingerprint);
  if (previousAt !== undefined && now - previousAt < DEBUG_DEDUPE_WINDOW_MS) {
    return true;
  }
  recentDebugFingerprints.set(fingerprint, now);

  if (recentDebugFingerprints.size > DEBUG_MAX_FINGERPRINTS) {
    const evictionThreshold = now - DEBUG_DEDUPE_WINDOW_MS * 3;
    for (const [key, timestamp] of recentDebugFingerprints) {
      if (timestamp < evictionThreshold) {
        recentDebugFingerprints.delete(key);
      }
    }
  }
  return false;
}

export function chatDebug(
  scope: string,
  message: string,
  meta?: Record<string, unknown>
): void {
  if (!readWindowDebugFlag()) {
    return;
  }
  if (shouldSkipDuplicateLog(scope, message, meta)) {
    return;
  }
  if (meta) {
    console.log(`[ChatDebug:${scope}] ${message}`, meta);
    return;
  }
  console.log(`[ChatDebug:${scope}] ${message}`);
}

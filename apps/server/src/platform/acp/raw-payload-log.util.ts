import {
  redactRawPayloadValue,
  shouldRedactAcpRawLogKey,
} from "@/shared/utils/redaction.util";

const RAW_PAYLOAD_STRING_LIMIT = 240;
const RAW_PAYLOAD_MAX_DEPTH = 4;
const RAW_PAYLOAD_MAX_ARRAY_ITEMS = 20;

export function serializeRawPayloadForLog(value: unknown): string {
  return JSON.stringify(normalizeRawPayloadForLog(value));
}

function normalizeRawPayloadForLog(
  value: unknown,
  depth = 0,
  active = new WeakSet<object>()
): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return truncateRawPayloadString(value);
  }
  if (typeof value !== "object") {
    return value;
  }
  if (depth >= RAW_PAYLOAD_MAX_DEPTH) {
    return "[max-depth]";
  }
  if (active.has(value)) {
    return "[circular]";
  }

  active.add(value);
  try {
    if (Array.isArray(value)) {
      const limited = value.slice(0, RAW_PAYLOAD_MAX_ARRAY_ITEMS);
      const normalized = limited.map((item) =>
        normalizeRawPayloadForLog(item, depth + 1, active)
      );
      if (value.length > RAW_PAYLOAD_MAX_ARRAY_ITEMS) {
        normalized.push(
          `[...${value.length - RAW_PAYLOAD_MAX_ARRAY_ITEMS} more items]`
        );
      }
      return normalized;
    }

    const normalized: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value)) {
      if (shouldRedactAcpRawLogKey(key)) {
        normalized[key] = redactRawPayloadValue(entryValue);
        continue;
      }
      normalized[key] = normalizeRawPayloadForLog(
        entryValue,
        depth + 1,
        active
      );
    }
    return normalized;
  } finally {
    active.delete(value);
  }
}

function truncateRawPayloadString(value: string): string {
  if (value.length <= RAW_PAYLOAD_STRING_LIMIT) {
    return value;
  }
  return `${value.slice(0, RAW_PAYLOAD_STRING_LIMIT)}...[${value.length} chars]`;
}

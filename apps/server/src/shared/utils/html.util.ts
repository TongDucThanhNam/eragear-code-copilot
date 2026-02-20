const HTML_LT_RE = /</g;
const HTML_GT_RE = />/g;

/**
 * Escapes angle brackets so untrusted text cannot be interpreted as HTML tags.
 */
export function escapeHtmlText(value: string): string {
  if (!value) {
    return value;
  }
  return value.replace(HTML_LT_RE, "&lt;").replace(HTML_GT_RE, "&gt;");
}

/**
 * Recursively escapes string values found in unknown JSON-like data.
 */
export function sanitizeStringValues<T>(value: T): T {
  return sanitizeValue(value, new WeakSet<object>()) as T;
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") {
    return escapeHtmlText(value);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return value;
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      let changed = false;
      const next = value.map((item) => {
        const sanitized = sanitizeValue(item, seen);
        if (sanitized !== item) {
          changed = true;
        }
        return sanitized;
      });
      return changed ? next : value;
    }

    let changed = false;
    const input = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(input)) {
      const sanitized = sanitizeValue(item, seen);
      next[key] = sanitized;
      if (sanitized !== item) {
        changed = true;
      }
    }
    return changed ? next : value;
  } finally {
    seen.delete(value);
  }
}

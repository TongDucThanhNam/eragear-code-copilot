import type { ServerResponse } from "node:http";

function readSetCookieHeaders(headers: Headers): string[] {
  const getSetCookie = (
    headers as unknown as {
      getSetCookie?: () => string[];
    }
  ).getSetCookie;

  if (typeof getSetCookie === "function") {
    const values = getSetCookie.call(headers);
    if (Array.isArray(values) && values.length > 0) {
      return values;
    }
  }

  const fallback = headers.get("set-cookie");
  if (!fallback) {
    return [];
  }

  // If runtime does not support getSetCookie(), keep the raw header value.
  return [fallback];
}

export function applyFetchHeadersToNodeResponse(
  res: ServerResponse,
  headers: Headers
): void {
  const setCookies = readSetCookieHeaders(headers);
  if (setCookies.length > 0) {
    res.setHeader("set-cookie", setCookies);
  }

  headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      return;
    }
    res.setHeader(key, value);
  });
}

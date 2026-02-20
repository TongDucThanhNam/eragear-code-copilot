import { describe, expect, test } from "bun:test";
import { escapeHtmlText, sanitizeStringValues } from "./html.util";

describe("escapeHtmlText", () => {
  test("escapes angle brackets", () => {
    expect(escapeHtmlText("<script>ok</script>")).toBe(
      "&lt;script&gt;ok&lt;/script&gt;"
    );
  });
});

describe("sanitizeStringValues", () => {
  test("sanitizes nested strings in objects and arrays", () => {
    const payload = {
      text: "<b>bold</b>",
      nested: {
        values: ["safe", "<img src=x onerror=alert(1)>"],
      },
    };
    const sanitized = sanitizeStringValues(payload);
    expect(sanitized).toEqual({
      text: "&lt;b&gt;bold&lt;/b&gt;",
      nested: {
        values: ["safe", "&lt;img src=x onerror=alert(1)&gt;"],
      },
    });
  });

  test("sanitizes shared object references consistently", () => {
    const shared = { text: "<i>shared</i>" };
    const payload = {
      first: shared,
      second: shared,
    };

    const sanitized = sanitizeStringValues(payload);
    expect((sanitized.first as { text: string }).text).toBe(
      "&lt;i&gt;shared&lt;/i&gt;"
    );
    expect((sanitized.second as { text: string }).text).toBe(
      "&lt;i&gt;shared&lt;/i&gt;"
    );
  });
});

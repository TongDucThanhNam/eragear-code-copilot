import { afterEach, describe, expect, test } from "bun:test";
import type { LoggerPort } from "@/shared/ports/logger.port";
import { ExaSupervisorResearchAdapter } from "./exa-supervisor-research.adapter";

class CapturingLogger implements LoggerPort {
  warnings: Array<{ message: string; context?: Record<string, unknown> }> = [];

  debug(): void {
    return;
  }
  info(): void {
    return;
  }
  error(): void {
    return;
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.warnings.push({ message, context });
  }
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ExaSupervisorResearchAdapter", () => {
  test("posts a search request and parses valid results", async () => {
    const captured: { requestBody?: unknown; requestHeaders?: Headers } = {};
    globalThis.fetch = ((
      _url: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1]
    ) => {
      captured.requestHeaders = new Headers(init?.headers);
      captured.requestBody = JSON.parse(String(init?.body));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            results: [
              {
                title: "ACP docs",
                url: "https://example.com/acp",
                publishedDate: "2026-01-01",
                author: "Docs",
                highlights: ["Prompt turns can continue."],
              },
              {
                title: "Missing URL",
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      );
    }) as unknown as typeof fetch;

    const logger = new CapturingLogger();
    const adapter = new ExaSupervisorResearchAdapter("secret-key", logger);

    const results = await adapter.search(" current ACP prompt turn docs ");

    expect(captured.requestHeaders?.get("x-api-key")).toBe("secret-key");
    expect(captured.requestBody).toMatchObject({
      query: "current ACP prompt turn docs",
      type: "auto",
      numResults: 5,
    });
    expect(results).toEqual([
      {
        title: "ACP docs",
        url: "https://example.com/acp",
        publishedDate: "2026-01-01",
        author: "Docs",
        highlights: ["Prompt turns can continue."],
      },
    ]);
  });

  test("returns an empty result and redacted metadata on HTTP failures", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response("rate limited", { status: 429 })
      )) as unknown as typeof fetch;
    const logger = new CapturingLogger();
    const adapter = new ExaSupervisorResearchAdapter("secret-key", logger);

    const results = await adapter.search("latest docs");

    expect(results).toEqual([]);
    expect(logger.warnings).toEqual([
      {
        message: "Supervisor Exa search failed",
        context: {
          status: 429,
          queryLength: "latest docs".length,
        },
      },
    ]);
  });
});

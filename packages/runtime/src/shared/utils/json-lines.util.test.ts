import { describe, expect, test } from "bun:test";
import { parseTolerantJsonLines } from "./json-lines.util";

describe("parseTolerantJsonLines", () => {
  test("parses JSONL batches with blank and CRLF-separated records", () => {
    const input = '\r\n{"id":1}\r\n\r\n{"id":2,"text":"xin chào"}\r\n';

    expect(parseTolerantJsonLines(input)).toEqual([
      { id: 1 },
      { id: 2, text: "xin chào" },
    ]);
  });

  test("skips malformed rows and resumes native parsing", () => {
    const input = [
      "not-json",
      JSON.stringify({ id: 1, text: "日本語" }),
      "{broken",
      JSON.stringify({ id: 2 }),
      '{"incomplete":',
    ].join("\n");

    expect(parseTolerantJsonLines(input)).toEqual([
      { id: 1, text: "日本語" },
      { id: 2 },
    ]);
  });
});

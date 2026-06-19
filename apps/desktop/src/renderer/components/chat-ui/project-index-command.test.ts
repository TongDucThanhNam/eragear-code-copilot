import { expect, test } from "bun:test";
import { parseProjectIndexCommand } from "./project-index-command";

test("parses /index queries", () => {
  expect(parseProjectIndexCommand("/index LocalAdeService TODO")).toEqual({
    query: "LocalAdeService TODO",
  });
  expect(parseProjectIndexCommand("/INDEX   runIndexedTask   ")).toEqual({
    query: "runIndexedTask",
  });
});

test("does not parse other slash commands as project index search", () => {
  expect(parseProjectIndexCommand("/fix LocalAdeService")).toBeNull();
  expect(parseProjectIndexCommand("search index LocalAdeService")).toBeNull();
});

test("returns an empty query for bare /index so caller can show validation", () => {
  expect(parseProjectIndexCommand("/index")).toEqual({ query: "" });
});

import { expect, test } from "bun:test";
import {
  buildProjectMemoryCommandText,
  getProjectMemoryRequestDraft,
  parseProjectMemoryCommand,
  quoteProjectMemorySourcePath,
} from "./project-memory-command";

test("parses /memory queries", () => {
  expect(parseProjectMemoryCommand("/memory checkpoint workflow")).toEqual({
    query: "checkpoint workflow",
    sourcePaths: [],
  });
  expect(parseProjectMemoryCommand("/MEMORY   provider policy   ")).toEqual({
    query: "provider policy",
    sourcePaths: [],
  });
});

test("parses selected memory source paths", () => {
  expect(
    parseProjectMemoryCommand(
      "/memory --source AGENTS.md --source=.eragear/context.md checkpoint workflow"
    )
  ).toEqual({
    query: "checkpoint workflow",
    sourcePaths: ["AGENTS.md", ".eragear/context.md"],
  });
  expect(
    parseProjectMemoryCommand(
      '/memory -s ".eragear/context.md" use selected memory'
    )
  ).toEqual({
    query: "use selected memory",
    sourcePaths: [".eragear/context.md"],
  });
});

test("does not parse other slash commands as project memory context", () => {
  expect(parseProjectMemoryCommand("/index LocalAdeService")).toBeNull();
  expect(parseProjectMemoryCommand("memory LocalAdeService")).toBeNull();
});

test("returns an empty query for bare /memory so caller can show validation", () => {
  expect(parseProjectMemoryCommand("/memory")).toEqual({
    query: "",
    sourcePaths: [],
  });
});

test("builds visible project memory picker commands", () => {
  expect(
    buildProjectMemoryCommandText({
      request: "review checkpoint flow",
      sourcePaths: ["AGENTS.md"],
    })
  ).toBe("/memory --source AGENTS.md review checkpoint flow");
  expect(
    buildProjectMemoryCommandText({
      request: "review checkpoint flow",
      sourcePaths: [".eragear/team context.md"],
    })
  ).toBe('/memory --source ".eragear/team context.md" review checkpoint flow');
  expect(
    buildProjectMemoryCommandText({
      sourcePaths: [],
    })
  ).toBe("/memory ");
});

test("quotes project memory source paths only when needed", () => {
  expect(quoteProjectMemorySourcePath("AGENTS.md")).toBe("AGENTS.md");
  expect(quoteProjectMemorySourcePath(".eragear/team context.md")).toBe(
    '".eragear/team context.md"'
  );
  expect(quoteProjectMemorySourcePath("docs/team's context.md")).toBe(
    '"docs/team\'s context.md"'
  );
});

test("extracts project memory request draft from current input", () => {
  expect(getProjectMemoryRequestDraft("review checkpoint flow")).toBe(
    "review checkpoint flow"
  );
  expect(
    getProjectMemoryRequestDraft("/memory --source AGENTS.md review checkpoint")
  ).toBe("review checkpoint");
  expect(getProjectMemoryRequestDraft("/index LocalAdeService")).toBe("");
  expect(getProjectMemoryRequestDraft("@skill review")).toBe("");
});

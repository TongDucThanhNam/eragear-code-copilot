import { describe, expect, test } from "bun:test";
import {
  parseCreateAgentRouteInput,
  parseDeleteAgentRouteInput,
  parseUpdateAgentRouteInput,
} from "./agent-route-input";

describe("agent route input", () => {
  test("parses create payload and resolves argsInput", () => {
    const result = parseCreateAgentRouteInput({
      name: "Codex",
      type: "codex",
      command: "codex",
      argsInput: String.raw`acp --flag=value two\ words`,
      projectId: "project-1",
    });

    expect(result).toEqual({
      ok: true,
      input: {
        name: "Codex",
        type: "codex",
        command: "codex",
        args: ["acp", "--flag=value", "two words"],
        projectId: "project-1",
      },
    });
  });

  test("keeps explicit args array ahead of argsInput", () => {
    const result = parseCreateAgentRouteInput({
      name: "Claude",
      type: "claude",
      command: "claude",
      args: ["mcp"],
      argsInput: "ignored",
    });

    expect(result).toEqual({
      ok: true,
      input: {
        name: "Claude",
        type: "claude",
        command: "claude",
        args: ["mcp"],
      },
    });
  });

  test("returns existing create required-field error", () => {
    const result = parseCreateAgentRouteInput({
      type: "codex",
      command: "codex",
    });

    expect(result).toEqual({
      ok: false,
      error: "name, type, and command are required",
    });
  });

  test("returns existing agent type error", () => {
    const result = parseCreateAgentRouteInput({
      name: "Unknown",
      type: "wat",
      command: "wat",
    });

    expect(result).toEqual({
      ok: false,
      error: "type must be one of: claude, codex, opencode, gemini, other",
    });
  });

  test("parses update payload and resolves argsInput", () => {
    const result = parseUpdateAgentRouteInput({
      id: "agent-1",
      type: "opencode",
      command: "opencode",
      argsInput: "acp",
    });

    expect(result).toEqual({
      ok: true,
      input: {
        id: "agent-1",
        type: "opencode",
        command: "opencode",
        args: ["acp"],
      },
    });
  });

  test("returns existing update id error", () => {
    const result = parseUpdateAgentRouteInput({
      command: "codex",
    });

    expect(result).toEqual({
      ok: false,
      error: "id is required",
    });
  });

  test("rejects malformed args arrays", () => {
    const result = parseUpdateAgentRouteInput({
      id: "agent-1",
      args: ["ok", 123],
    });

    expect(result).toEqual({
      ok: false,
      error: "args must be an array of strings",
    });
  });

  test("parses delete form payload", () => {
    const result = parseDeleteAgentRouteInput({ agentId: "agent-1" });

    expect(result).toEqual({
      ok: true,
      input: { agentId: "agent-1" },
    });
  });

  test("returns existing delete agent id error", () => {
    const result = parseDeleteAgentRouteInput({});

    expect(result).toEqual({
      ok: false,
      error: "agentId is required",
    });
  });
});

import { describe, expect, test } from "bun:test";
import { terminalRouter } from "./terminal";

describe("terminalRouter", () => {
  test("keeps extracted settings procedures on the flat terminal interface", () => {
    const procedures = terminalRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.getSettings).toBeDefined();
    expect(procedures.updateSettings).toBeDefined();
    expect(procedures.settings).toBeUndefined();
    expect(procedures.terminalSettings).toBeUndefined();
  });

  test("keeps extracted runtime procedures on the flat terminal interface", () => {
    const procedures = terminalRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.list).toBeDefined();
    expect(procedures.create).toBeDefined();
    expect(procedures.write).toBeDefined();
    expect(procedures.resize).toBeDefined();
    expect(procedures.kill).toBeDefined();
    expect(procedures.runtime).toBeUndefined();
    expect(procedures.terminalRuntime).toBeUndefined();
  });

  test("keeps extracted event procedures on the flat terminal interface", () => {
    const procedures = terminalRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.onTerminalEvents).toBeDefined();
    expect(procedures.events).toBeUndefined();
    expect(procedures.terminalEvents).toBeUndefined();
  });
});

import { describe, expect, test } from "bun:test";
import { commandsRouter } from "./commands";

describe("commandsRouter", () => {
  test("keeps extracted query procedures on the flat commands interface", () => {
    const procedures = commandsRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.list).toBeDefined();
    expect(procedures.query).toBeUndefined();
    expect(procedures.commandsQuery).toBeUndefined();
  });

  test("keeps extracted mutation procedures on the flat commands interface", () => {
    const procedures = commandsRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.create).toBeDefined();
    expect(procedures.update).toBeDefined();
    expect(procedures.delete).toBeDefined();
    expect(procedures.mutation).toBeUndefined();
    expect(procedures.commandsMutation).toBeUndefined();
  });

  test("keeps extracted state procedures on the flat commands interface", () => {
    const procedures = commandsRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.setEnabled).toBeDefined();
    expect(procedures.state).toBeUndefined();
    expect(procedures.commandsState).toBeUndefined();
  });
});

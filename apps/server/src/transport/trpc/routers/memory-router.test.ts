import { describe, expect, test } from "bun:test";
import { memoryRouter } from "./memory";

describe("memoryRouter", () => {
  test("keeps extracted query procedures on the flat memory interface", () => {
    const procedures = memoryRouter._def.procedures as Record<string, unknown>;

    expect(procedures.list).toBeDefined();
    expect(procedures.query).toBeUndefined();
    expect(procedures.memoryQuery).toBeUndefined();
  });

  test("keeps extracted source procedures on the flat memory interface", () => {
    const procedures = memoryRouter._def.procedures as Record<string, unknown>;

    expect(procedures.setSourceEnabled).toBeDefined();
    expect(procedures.source).toBeUndefined();
    expect(procedures.memorySource).toBeUndefined();
  });

  test("keeps extracted preset procedures on the flat memory interface", () => {
    const procedures = memoryRouter._def.procedures as Record<string, unknown>;

    expect(procedures.upsertPreset).toBeDefined();
    expect(procedures.deletePreset).toBeDefined();
    expect(procedures.preset).toBeUndefined();
    expect(procedures.memoryPreset).toBeUndefined();
  });

  test("keeps extracted context procedures on the flat memory interface", () => {
    const procedures = memoryRouter._def.procedures as Record<string, unknown>;

    expect(procedures.buildContext).toBeDefined();
    expect(procedures.context).toBeUndefined();
    expect(procedures.memoryContext).toBeUndefined();
  });
});

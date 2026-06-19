import { describe, expect, test } from "bun:test";
import { modelProviderRouter } from "./model-provider";

describe("modelProviderRouter", () => {
  test("keeps extracted query procedures on the flat model-provider interface", () => {
    const procedures = modelProviderRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.list).toBeDefined();
    expect(procedures.get).toBeDefined();
    expect(procedures.query).toBeUndefined();
    expect(procedures.modelProviderQuery).toBeUndefined();
  });

  test("keeps extracted mutation procedures on the flat model-provider interface", () => {
    const procedures = modelProviderRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.upsert).toBeDefined();
    expect(procedures.delete).toBeDefined();
    expect(procedures.mutation).toBeUndefined();
    expect(procedures.modelProviderMutation).toBeUndefined();
  });

  test("keeps extracted defaults procedures on the flat model-provider interface", () => {
    const procedures = modelProviderRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.restoreDefaults).toBeDefined();
    expect(procedures.defaults).toBeUndefined();
    expect(procedures.modelProviderDefaults).toBeUndefined();
  });
});

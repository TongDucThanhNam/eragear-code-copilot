import { describe, expect, test } from "bun:test";
import type { SessionConfigOption } from "#runtime/shared/types/session.types";
import { createSetConfigOptionResponse } from "./ai-router-data";

function selectOption(params: {
  id: string;
  currentValue: string;
}): SessionConfigOption {
  return {
    id: params.id,
    name: params.id,
    type: "select",
    currentValue: params.currentValue,
    options: [{ value: params.currentValue, name: params.currentValue }],
  };
}

describe("createSetConfigOptionResponse", () => {
  test("uses the post-mutation session state as the client-facing config options", () => {
    const staleOption = selectOption({
      id: "reasoning",
      currentValue: "low",
    });
    const latestOption = selectOption({
      id: "reasoning",
      currentValue: "high",
    });

    expect(
      createSetConfigOptionResponse(
        { ok: true, configOptions: [staleOption] },
        { configOptions: [latestOption] }
      )
    ).toEqual({ ok: true, configOptions: [latestOption] });
  });

  test("normalizes missing session config options to an empty array", () => {
    expect(
      createSetConfigOptionResponse(
        {
          ok: true,
          configOptions: [selectOption({ id: "model", currentValue: "gpt" })],
        },
        { configOptions: null }
      )
    ).toEqual({ ok: true, configOptions: [] });

    expect(
      createSetConfigOptionResponse(
        {
          ok: true,
          configOptions: [selectOption({ id: "model", currentValue: "gpt" })],
        },
        {}
      )
    ).toEqual({ ok: true, configOptions: [] });
  });
});

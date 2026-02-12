import { describe, expect, test } from "bun:test";
import { parseSessionPaginationParams } from "./helpers";

describe("parseSessionPaginationParams", () => {
  test("clamps limit by runtime-configured max", () => {
    const result = parseSessionPaginationParams(
      {
        limit: "999",
        offset: "2",
      },
      17
    );
    if (!result.ok) {
      throw new Error(result.error);
    }

    expect(result.pagination).toEqual({
      limit: 17,
      offset: 2,
    });
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { ENV } from "@/config/environment";
import { parseSessionPaginationParams } from "./helpers";

describe("parseSessionPaginationParams", () => {
  const originalMaxLimit = ENV.sessionListPageMaxLimit;

  afterEach(() => {
    ENV.sessionListPageMaxLimit = originalMaxLimit;
  });

  test("clamps limit by runtime-configured max", () => {
    ENV.sessionListPageMaxLimit = 17;

    const result = parseSessionPaginationParams({
      limit: "999",
      offset: "2",
    });
    if (!result.ok) {
      throw new Error(result.error);
    }

    expect(result.pagination).toEqual({
      limit: 17,
      offset: 2,
    });
  });
});

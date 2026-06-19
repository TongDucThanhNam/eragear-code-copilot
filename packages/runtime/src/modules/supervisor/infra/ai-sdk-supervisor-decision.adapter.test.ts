import { describe, expect, test } from "bun:test";
import { __aiSdkSupervisorDecisionInternals } from "./ai-sdk-supervisor-decision.adapter";

describe("AiSdkSupervisorDecisionAdapter model parsing", () => {
  test("supports DeepSeek model ids with or without provider prefix", () => {
    expect(
      __aiSdkSupervisorDecisionInternals.parseDeepSeekModelId(
        "deepseek/deepseek-chat"
      )
    ).toBe("deepseek-chat");
    expect(
      __aiSdkSupervisorDecisionInternals.parseDeepSeekModelId(
        "deepseek-reasoner"
      )
    ).toBe("deepseek-reasoner");
  });

  test("does not treat unsupported provider ids as DeepSeek", () => {
    expect(
      __aiSdkSupervisorDecisionInternals.parseDeepSeekModelId(
        "anthropic/claude-sonnet-4-20250514"
      )
    ).toBeUndefined();
  });
});

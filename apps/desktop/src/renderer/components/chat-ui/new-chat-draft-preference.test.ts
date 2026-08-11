import { expect, test } from "bun:test";
import { resolveDraftAgentId } from "./new-chat-draft-preference";

test("uses the cached ACP agent when it is still available", () => {
  expect(
    resolveDraftAgentId({
      activeAgentId: "agent-active",
      agentIds: ["agent-active", "agent-cached"],
      cachedAgentId: "agent-cached",
    })
  ).toBe("agent-cached");
});

test("falls back from a stale cached agent to the active agent", () => {
  expect(
    resolveDraftAgentId({
      activeAgentId: "agent-active",
      agentIds: ["agent-active", "agent-other"],
      cachedAgentId: "agent-removed",
    })
  ).toBe("agent-active");
});

test("uses the first configured agent when no preference is available", () => {
  expect(
    resolveDraftAgentId({
      agentIds: ["agent-first", "agent-second"],
    })
  ).toBe("agent-first");
  expect(resolveDraftAgentId({ agentIds: [] })).toBeNull();
});

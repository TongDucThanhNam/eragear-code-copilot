import { expect, test } from "bun:test";
import { parseEragearDeepLink } from "./deep-link";

test("parses chat deep links from path and query forms", () => {
  expect(parseEragearDeepLink("eragear://chat/chat-123")).toEqual({
    kind: "chat",
    chatId: "chat-123",
  });
  expect(
    parseEragearDeepLink("eragear://open?chatId=chat-456&projectId=project-1")
  ).toEqual({
    kind: "chat",
    chatId: "chat-456",
    projectId: "project-1",
  });
});

test("parses project and settings deep links", () => {
  expect(parseEragearDeepLink("eragear://project/project-1")).toEqual({
    kind: "project",
    projectId: "project-1",
  });
  expect(parseEragearDeepLink("eragear://settings/acp-auth")).toEqual({
    kind: "settings",
    section: "acp-auth",
  });
});

test("rejects invalid or non-eragear URLs", () => {
  expect(parseEragearDeepLink("https://example.com")).toBeNull();
  expect(parseEragearDeepLink("not a url")).toBeNull();
});

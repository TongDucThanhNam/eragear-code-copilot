import { expect, test } from "bun:test";
import {
  resolveRestoredWorkspaceChatId,
  trimWorkspaceTabs,
  type WorkspaceSessionTab,
} from "./workspace-session-store";

test("restores explicit last active chat when it still exists", () => {
  const restored = resolveRestoredWorkspaceChatId({
    sessions: [
      { id: "chat-a", projectId: "project-1", lastActiveAt: 10 },
      { id: "chat-b", projectId: "project-1", lastActiveAt: 20 },
    ],
    lastActiveChatId: "chat-a",
    lastActiveByProjectId: { "project-1": "chat-b" },
    activeProjectId: "project-1",
  });

  expect(restored).toBe("chat-a");
});

test("falls back to active project's last chat, then newest project session", () => {
  expect(
    resolveRestoredWorkspaceChatId({
      sessions: [
        { id: "chat-a", projectId: "project-1", lastActiveAt: 10 },
        { id: "chat-b", projectId: "project-2", lastActiveAt: 30 },
        { id: "chat-c", projectId: "project-2", lastActiveAt: 40 },
      ],
      lastActiveChatId: "missing",
      lastActiveByProjectId: { "project-2": "chat-b" },
      activeProjectId: "project-2",
    })
  ).toBe("chat-b");

  expect(
    resolveRestoredWorkspaceChatId({
      sessions: [
        { id: "chat-a", projectId: "project-1", lastActiveAt: 10 },
        { id: "chat-c", projectId: "project-2", lastActiveAt: 40 },
      ],
      lastActiveChatId: "missing",
      lastActiveByProjectId: { "project-2": "missing" },
      activeProjectId: "project-2",
    })
  ).toBe("chat-c");
});

test("ignores archived sessions and limits workspace tabs", () => {
  expect(
    resolveRestoredWorkspaceChatId({
      sessions: [
        { id: "chat-a", projectId: "project-1", archived: true, lastActiveAt: 50 },
        { id: "chat-b", projectId: "project-1", lastActiveAt: 10 },
      ],
      lastActiveChatId: "chat-a",
      lastActiveByProjectId: {},
      activeProjectId: null,
    })
  ).toBe("chat-b");

  const tabs: WorkspaceSessionTab[] = Array.from({ length: 10 }, (_, index) => ({
    chatId: `chat-${index}`,
    projectId: null,
    title: `Chat ${index}`,
    projectName: null,
    updatedAt: index,
  }));

  expect(trimWorkspaceTabs(tabs)).toHaveLength(8);
});

import { describe, expect, test } from "bun:test";
import { ENV } from "@/config/environment";
import {
  ListSessionsInputSchema,
  SessionListPageInputSchema,
  SessionMessagesPageInputSchema,
} from "./session.contract";

describe("session contract page limits", () => {
  test("enforces session list max limit from ENV", () => {
    expect(
      ListSessionsInputSchema.parse({
        limit: ENV.sessionListPageMaxLimit,
        offset: 0,
      })
    ).toEqual({
      limit: ENV.sessionListPageMaxLimit,
      offset: 0,
    });
    expect(() =>
      ListSessionsInputSchema.parse({
        limit: ENV.sessionListPageMaxLimit + 1,
        offset: 0,
      })
    ).toThrow();
  });

  test("enforces session messages max limit from ENV", () => {
    expect(
      SessionMessagesPageInputSchema.parse({
        chatId: "chat-1",
        limit: ENV.sessionMessagesPageMaxLimit,
      })
    ).toEqual({
      chatId: "chat-1",
      limit: ENV.sessionMessagesPageMaxLimit,
    });
    expect(() =>
      SessionMessagesPageInputSchema.parse({
        chatId: "chat-1",
        limit: ENV.sessionMessagesPageMaxLimit + 1,
      })
    ).toThrow();
  });

  test("enforces session list page max limit from ENV", () => {
    expect(
      SessionListPageInputSchema.parse({
        limit: ENV.sessionListPageMaxLimit,
      })
    ).toEqual({
      limit: ENV.sessionListPageMaxLimit,
    });
    expect(() =>
      SessionListPageInputSchema.parse({
        limit: ENV.sessionListPageMaxLimit + 1,
      })
    ).toThrow();
  });
});

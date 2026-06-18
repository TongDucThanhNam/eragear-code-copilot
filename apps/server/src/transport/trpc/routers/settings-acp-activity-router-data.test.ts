import { describe, expect, test } from "bun:test";
import {
  DeleteAcpReplayPresetRequestSchema,
  ExportAcpActivityRequestSchema,
  ReplayAcpActivityRequestSchema,
  RetryAcpActivityStreamRequestSchema,
  SaveAcpReplayPresetRequestSchema,
} from "./settings-acp-activity-router-data";

describe("settings ACP activity request schemas", () => {
  test("accepts omitted optional export, retry, and replay inputs", () => {
    expect(ExportAcpActivityRequestSchema.parse(undefined)).toBeUndefined();
    expect(
      RetryAcpActivityStreamRequestSchema.parse(undefined)
    ).toBeUndefined();
    expect(ReplayAcpActivityRequestSchema.parse(undefined)).toBeUndefined();
  });

  test("keeps export filters strict and bounded", () => {
    expect(
      ExportAcpActivityRequestSchema.parse({
        projectId: "project-1",
        chatId: " chat-1 ",
        limit: 500,
      })
    ).toEqual({
      projectId: "project-1",
      chatId: "chat-1",
      limit: 500,
    });

    expect(
      ExportAcpActivityRequestSchema.safeParse({
        chatId: "chat-1",
        limit: 501,
      }).success
    ).toBe(false);

    expect(
      ExportAcpActivityRequestSchema.safeParse({
        chatId: "chat-1",
        includeSecrets: true,
      }).success
    ).toBe(false);
  });

  test("keeps replay filters narrow and trimmed", () => {
    expect(
      ReplayAcpActivityRequestSchema.parse({
        projectId: "project-1",
        chatId: " chat-1 ",
        correlationKey: " turn-1 ",
        kind: " request ",
        limit: 25,
      })
    ).toEqual({
      projectId: "project-1",
      chatId: "chat-1",
      correlationKey: "turn-1",
      kind: "request",
      limit: 25,
    });

    expect(
      ReplayAcpActivityRequestSchema.safeParse({
        chatId: " ",
      }).success
    ).toBe(false);

    expect(
      ReplayAcpActivityRequestSchema.safeParse({
        correlationKey: "turn-1",
        timeline: true,
      }).success
    ).toBe(false);
  });

  test("bounds saved replay preset filters at the tRPC request seam", () => {
    expect(
      SaveAcpReplayPresetRequestSchema.parse({
        projectId: "project-1",
        id: " preset-1 ",
        name: " session replay ",
        chatId: " chat-1 ",
        correlationKey: " turn-1 ",
        kind: " response ",
        limit: 100,
      })
    ).toEqual({
      projectId: "project-1",
      id: "preset-1",
      name: "session replay",
      chatId: "chat-1",
      correlationKey: "turn-1",
      kind: "response",
      limit: 100,
    });

    expect(
      SaveAcpReplayPresetRequestSchema.safeParse({
        name: "",
      }).success
    ).toBe(false);

    expect(
      SaveAcpReplayPresetRequestSchema.safeParse({
        name: "x".repeat(81),
      }).success
    ).toBe(false);

    expect(
      SaveAcpReplayPresetRequestSchema.safeParse({
        name: "session replay",
        limit: 0,
      }).success
    ).toBe(false);
  });

  test("keeps replay preset delete requests narrow", () => {
    expect(
      DeleteAcpReplayPresetRequestSchema.parse({
        projectId: "project-1",
        id: " preset-1 ",
      })
    ).toEqual({
      projectId: "project-1",
      id: "preset-1",
    });

    expect(
      DeleteAcpReplayPresetRequestSchema.safeParse({
        id: "preset-1",
        name: "session replay",
      }).success
    ).toBe(false);
  });
});

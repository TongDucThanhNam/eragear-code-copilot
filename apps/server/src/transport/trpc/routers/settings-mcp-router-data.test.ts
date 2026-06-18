import { describe, expect, test } from "bun:test";
import {
  ConfigureMcpRemoteControlsRequestSchema,
  InvokeMcpToolRequestSchema,
  ReadMcpResourceRequestSchema,
  ToggleMcpServerRequestSchema,
  TrustMcpServerRequestSchema,
  UpsertMcpServerRequestSchema,
  WatchMcpNotificationsRequestSchema,
} from "./settings-mcp-router-data";

describe("settings MCP request schemas", () => {
  test("accepts canonical typed MCP server upserts", () => {
    const request = {
      projectId: "project-1",
      id: "server-1",
      name: " local tools ",
      transport: "stdio",
      enabled: true,
      command: "bun",
      args: ["x", "mcp-server"],
      env: { PATH: "bin" },
      headers: { "X-Trace": "trace-id" },
      headerEnv: { Authorization: "MCP_TOKEN" },
      remoteControls: {
        requestTimeoutMs: 1500,
        reconnectAttempts: 2,
        notificationWatchMs: 750,
      },
    };

    expect(UpsertMcpServerRequestSchema.parse(request)).toEqual({
      projectId: "project-1",
      id: "server-1",
      name: "local tools",
      transport: "stdio",
      enabled: true,
      command: "bun",
      args: ["x", "mcp-server"],
      env: { PATH: "bin" },
      headers: { "X-Trace": "trace-id" },
      headerEnv: { Authorization: "MCP_TOKEN" },
      remoteControls: {
        requestTimeoutMs: 1500,
        reconnectAttempts: 2,
        notificationWatchMs: 750,
      },
    });
  });

  test("keeps MCP server upsert requests strict at every nested request object", () => {
    expect(
      UpsertMcpServerRequestSchema.safeParse({
        name: "server",
        transport: "stdio",
        trustedFingerprint: "sha256:abc",
      }).success
    ).toBe(false);

    expect(
      UpsertMcpServerRequestSchema.safeParse({
        name: "server",
        transport: "stdio",
        remoteControls: {
          requestTimeoutMs: 1500,
          retryBackoffMs: 250,
        },
      }).success
    ).toBe(false);
  });

  test("rejects invalid MCP transports and non-string record values", () => {
    expect(
      UpsertMcpServerRequestSchema.safeParse({
        name: "server",
        transport: "websocket",
      }).success
    ).toBe(false);

    expect(
      UpsertMcpServerRequestSchema.safeParse({
        name: "server",
        transport: "stdio",
        env: { PORT: 3000 },
      }).success
    ).toBe(false);
  });

  test("bounds remote MCP operational controls at the tRPC request seam", () => {
    expect(
      ConfigureMcpRemoteControlsRequestSchema.safeParse({
        serverId: "server-1",
        fingerprint: "sha256:abc",
        requestTimeoutMs: 15_001,
      }).success
    ).toBe(false);

    expect(
      ConfigureMcpRemoteControlsRequestSchema.safeParse({
        serverId: "server-1",
        fingerprint: "sha256:abc",
        reconnectAttempts: 4,
      }).success
    ).toBe(false);

    expect(
      WatchMcpNotificationsRequestSchema.safeParse({
        serverId: "server-1",
        durationMs: 5001,
      }).success
    ).toBe(false);
  });

  test("keeps manual MCP operation requests strict and scoped to request fields", () => {
    expect(
      InvokeMcpToolRequestSchema.parse({
        projectId: "project-1",
        serverId: "server-1",
        toolName: " list_files ",
        arguments: {
          path: ".",
          recursive: false,
        },
      })
    ).toEqual({
      projectId: "project-1",
      serverId: "server-1",
      toolName: "list_files",
      arguments: {
        path: ".",
        recursive: false,
      },
    });

    expect(
      ReadMcpResourceRequestSchema.safeParse({
        serverId: "server-1",
        uri: " ",
      }).success
    ).toBe(false);
  });

  test("rejects unknown fields on narrow MCP action requests", () => {
    expect(
      ToggleMcpServerRequestSchema.safeParse({
        id: "server-1",
        enabled: true,
        transport: "stdio",
      }).success
    ).toBe(false);

    expect(
      TrustMcpServerRequestSchema.safeParse({
        serverId: "server-1",
        fingerprint: "sha256:abc",
        trustedAt: "2026-06-17T00:00:00.000Z",
      }).success
    ).toBe(false);
  });
});

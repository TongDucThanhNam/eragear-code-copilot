import { z } from "zod";

export const McpTransportRequestSchema = z.enum([
  "stdio",
  "sse",
  "streamable-http",
]);

const StringRecordRequestSchema = z.record(z.string(), z.string()).optional();

const McpRemoteControlsRequestSchema = z
  .object({
    requestTimeoutMs: z.number().int().min(1000).max(15_000).optional(),
    reconnectAttempts: z.number().int().min(0).max(3).optional(),
    notificationWatchMs: z.number().int().min(250).max(5000).optional(),
  })
  .strict();

export const UpsertMcpServerRequestSchema = z
  .object({
    projectId: z.string().optional(),
    id: z.string().optional(),
    name: z.string().trim().min(1),
    transport: McpTransportRequestSchema,
    enabled: z.boolean().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    url: z.string().optional(),
    messageEndpoint: z.string().optional(),
    env: StringRecordRequestSchema,
    headers: StringRecordRequestSchema,
    headerEnv: StringRecordRequestSchema,
    remoteControls: McpRemoteControlsRequestSchema.optional(),
  })
  .strict();

export const ToggleMcpServerRequestSchema = z
  .object({
    projectId: z.string().optional(),
    id: z.string().trim().min(1),
    enabled: z.boolean(),
  })
  .strict();

export const TrustMcpServerRequestSchema = z
  .object({
    projectId: z.string().optional(),
    serverId: z.string().trim().min(1),
    fingerprint: z.string().trim().min(1),
  })
  .strict();

export const ProbeMcpServerRequestSchema = z
  .object({
    projectId: z.string().optional(),
    id: z.string().trim().min(1),
  })
  .strict();

export const InvokeMcpToolRequestSchema = z
  .object({
    projectId: z.string().optional(),
    serverId: z.string().trim().min(1),
    toolName: z.string().trim().min(1),
    arguments: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const ReadMcpResourceRequestSchema = z
  .object({
    projectId: z.string().optional(),
    serverId: z.string().trim().min(1),
    uri: z.string().trim().min(1),
  })
  .strict();

export const WatchMcpNotificationsRequestSchema = z
  .object({
    projectId: z.string().optional(),
    serverId: z.string().trim().min(1),
    durationMs: z.number().int().min(250).max(5000).optional(),
  })
  .strict();

export const ConfigureMcpRemoteControlsRequestSchema = z
  .object({
    projectId: z.string().optional(),
    serverId: z.string().trim().min(1),
    fingerprint: z.string().trim().min(1),
    requestTimeoutMs: z.number().int().min(1000).max(15_000).optional(),
    reconnectAttempts: z.number().int().min(0).max(3).optional(),
    notificationWatchMs: z.number().int().min(250).max(5000).optional(),
  })
  .strict();

import { z } from "zod";

export const RemoteRelayDeviceStatusSchema = z.enum([
  "online",
  "offline",
  "disabled",
]);

export const RemoteSessionStatusSchema = z.enum([
  "requested",
  "active",
  "stopped",
  "expired",
]);

export const RemoteRelayDeviceSchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().min(1),
    name: z.string().min(1),
    relayUrl: z.string().url(),
    pairingCode: z.string().min(1).optional(),
    enabled: z.boolean(),
    status: RemoteRelayDeviceStatusSchema,
    lastSeenAt: z.number().int().nonnegative().nullable(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

export const RemoteSessionSchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().min(1),
    deviceId: z.string().min(1),
    chatId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    status: RemoteSessionStatusSchema,
    requestedAt: z.number().int().nonnegative(),
    startedAt: z.number().int().nonnegative().nullable(),
    stoppedAt: z.number().int().nonnegative().nullable(),
    expiresAt: z.number().int().nonnegative(),
    context: z.record(z.string(), z.string()).default({}),
  })
  .strict();

export const UpsertRemoteRelayDeviceInputSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).max(120),
    relayUrl: z.string().url(),
    pairingCode: z.string().min(1).max(256).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export const DeleteRemoteRelayDeviceInputSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export const RecordRemoteRelayHeartbeatInputSchema = z
  .object({
    deviceId: z.string().min(1),
  })
  .strict();

export const StartRemoteSessionInputSchema = z
  .object({
    deviceId: z.string().min(1),
    chatId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    ttlMs: z.number().int().min(60_000).max(86_400_000).optional(),
    context: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const StopRemoteSessionInputSchema = z
  .object({
    sessionId: z.string().min(1),
  })
  .strict();

export const RemoteControlStatusSchema = z
  .object({
    devices: z.array(RemoteRelayDeviceSchema),
    sessions: z.array(RemoteSessionSchema),
  })
  .strict();

export type RemoteRelayDeviceStatus = z.infer<
  typeof RemoteRelayDeviceStatusSchema
>;
export type RemoteSessionStatus = z.infer<typeof RemoteSessionStatusSchema>;
export type RemoteRelayDevice = z.infer<typeof RemoteRelayDeviceSchema>;
export type RemoteSession = z.infer<typeof RemoteSessionSchema>;
export type UpsertRemoteRelayDeviceInput = z.infer<
  typeof UpsertRemoteRelayDeviceInputSchema
>;
export type DeleteRemoteRelayDeviceInput = z.infer<
  typeof DeleteRemoteRelayDeviceInputSchema
>;
export type RecordRemoteRelayHeartbeatInput = z.infer<
  typeof RecordRemoteRelayHeartbeatInputSchema
>;
export type StartRemoteSessionInput = z.infer<
  typeof StartRemoteSessionInputSchema
>;
export type StopRemoteSessionInput = z.infer<
  typeof StopRemoteSessionInputSchema
>;
export type RemoteControlStatus = z.infer<typeof RemoteControlStatusSchema>;

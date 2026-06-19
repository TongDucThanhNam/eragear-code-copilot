import { randomUUID } from "node:crypto";
import { NotFoundError, ValidationError } from "#runtime/shared/errors";
import type {
  RemoteControlStatus,
  RemoteRelayDevice,
  RemoteSession,
  StartRemoteSessionInput,
  UpsertRemoteRelayDeviceInput,
} from "./contracts/remote-control.contract";
import type {
  MutableRemoteControlStoreSnapshot,
  RemoteControlRepositoryPort,
  RemoteControlStoreSnapshot,
} from "./ports/remote-control-repository.port";

const MODULE = "remote-control";
const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;
const ONLINE_WINDOW_MS = 2 * 60 * 1000;

interface RemoteControlServiceDeps {
  repository: RemoteControlRepositoryPort;
  now?: () => number;
  createId?: () => string;
}

export class RemoteControlService {
  private readonly repository: RemoteControlRepositoryPort;
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(deps: RemoteControlServiceDeps) {
    this.repository = deps.repository;
    this.now = deps.now ?? Date.now;
    this.createId = deps.createId ?? randomUUID;
  }

  async getStatus(userId: string): Promise<RemoteControlStatus> {
    return await this.repository.read((snapshot) => {
      const now = this.now();
      return {
        devices: findUserDevices(snapshot, userId).map((device) =>
          this.withComputedStatus(device, now)
        ),
        sessions: findUserSessions(snapshot, userId).map((session) =>
          this.withComputedSessionStatus(session, now)
        ),
      };
    });
  }

  async upsertDevice(
    userId: string,
    input: UpsertRemoteRelayDeviceInput
  ): Promise<RemoteRelayDevice> {
    return await this.repository.mutate((snapshot) => {
      const now = this.now();
      const existingIndex = input.id
        ? findDeviceIndex(snapshot, userId, input.id)
        : -1;
      const existing =
        existingIndex >= 0 ? snapshot.devices[existingIndex] : undefined;
      if (input.id && !existing) {
        throw new NotFoundError("Remote relay device not found", {
          module: MODULE,
          op: "upsertDevice",
          details: { deviceId: input.id },
        });
      }

      const next: RemoteRelayDevice = {
        id: existing?.id ?? this.createId(),
        userId,
        name: input.name.trim(),
        relayUrl: input.relayUrl.trim(),
        ...resolvePairingCode(input.pairingCode, existing?.pairingCode),
        enabled: input.enabled ?? existing?.enabled ?? true,
        status: existing?.status ?? "offline",
        lastSeenAt: existing?.lastSeenAt ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      if (existingIndex >= 0) {
        snapshot.devices[existingIndex] = next;
      } else {
        snapshot.devices.push(next);
      }
      return this.withComputedStatus(next, now);
    });
  }

  async deleteDevice(userId: string, deviceId: string): Promise<void> {
    await this.repository.mutate((snapshot) => {
      const existingIndex = findDeviceIndex(snapshot, userId, deviceId);
      if (existingIndex === -1) {
        throw new NotFoundError("Remote relay device not found", {
          module: MODULE,
          op: "deleteDevice",
          details: { deviceId },
        });
      }
      snapshot.devices.splice(existingIndex, 1);
    });
  }

  async recordHeartbeat(
    userId: string,
    deviceId: string
  ): Promise<RemoteRelayDevice> {
    return await this.repository.mutate((snapshot) => {
      const existingIndex = findDeviceIndex(snapshot, userId, deviceId);
      const existing =
        existingIndex >= 0 ? snapshot.devices[existingIndex] : undefined;
      if (!existing) {
        throw new NotFoundError("Remote relay device not found", {
          module: MODULE,
          op: "recordHeartbeat",
          details: { deviceId },
        });
      }
      const now = this.now();
      const next: RemoteRelayDevice = {
        ...existing,
        status: existing.enabled ? "online" : "disabled",
        lastSeenAt: now,
        updatedAt: now,
      };
      snapshot.devices[existingIndex] = next;
      return this.withComputedStatus(next, now);
    });
  }

  async startSession(
    userId: string,
    input: StartRemoteSessionInput
  ): Promise<RemoteSession> {
    return await this.repository.mutate((snapshot) => {
      const device = findDevice(snapshot, userId, input.deviceId);
      if (!device) {
        throw new NotFoundError("Remote relay device not found", {
          module: MODULE,
          op: "startSession",
          details: { deviceId: input.deviceId },
        });
      }
      const now = this.now();
      const computedDevice = this.withComputedStatus(device, now);
      if (computedDevice.status === "disabled") {
        throw new ValidationError("Remote relay device is disabled", {
          module: MODULE,
          op: "startSession",
          details: { deviceId: input.deviceId },
        });
      }

      const session: RemoteSession = {
        id: this.createId(),
        userId,
        deviceId: input.deviceId,
        ...(input.chatId ? { chatId: input.chatId } : {}),
        ...(input.projectId ? { projectId: input.projectId } : {}),
        status: computedDevice.status === "online" ? "active" : "requested",
        requestedAt: now,
        startedAt: computedDevice.status === "online" ? now : null,
        stoppedAt: null,
        expiresAt: now + (input.ttlMs ?? DEFAULT_SESSION_TTL_MS),
        context: input.context ?? {},
      };
      snapshot.sessions.push(session);
      return session;
    });
  }

  async stopSession(userId: string, sessionId: string): Promise<RemoteSession> {
    return await this.repository.mutate((snapshot) => {
      const existingIndex = findSessionIndex(snapshot, userId, sessionId);
      const existing =
        existingIndex >= 0 ? snapshot.sessions[existingIndex] : undefined;
      if (!existing) {
        throw new NotFoundError("Remote session not found", {
          module: MODULE,
          op: "stopSession",
          details: { sessionId },
        });
      }
      if (existing.status === "stopped") {
        return existing;
      }
      const next: RemoteSession = {
        ...existing,
        status: "stopped",
        stoppedAt: this.now(),
      };
      snapshot.sessions[existingIndex] = next;
      return next;
    });
  }

  private withComputedStatus(
    device: RemoteRelayDevice,
    now: number
  ): RemoteRelayDevice {
    if (!device.enabled) {
      return { ...device, status: "disabled" };
    }
    if (device.lastSeenAt && now - device.lastSeenAt <= ONLINE_WINDOW_MS) {
      return { ...device, status: "online" };
    }
    return { ...device, status: "offline" };
  }

  private withComputedSessionStatus(
    session: RemoteSession,
    now: number
  ): RemoteSession {
    if (
      (session.status === "requested" || session.status === "active") &&
      session.expiresAt <= now
    ) {
      return { ...session, status: "expired" };
    }
    return session;
  }
}

function findUserDevices(
  snapshot: RemoteControlStoreSnapshot,
  userId: string
): RemoteRelayDevice[] {
  return snapshot.devices.filter((device) => device.userId === userId);
}

function findUserSessions(
  snapshot: RemoteControlStoreSnapshot,
  userId: string
): RemoteSession[] {
  return snapshot.sessions.filter((session) => session.userId === userId);
}

function findDevice(
  snapshot: RemoteControlStoreSnapshot,
  userId: string,
  deviceId: string
): RemoteRelayDevice | undefined {
  return snapshot.devices.find(
    (device) => device.userId === userId && device.id === deviceId
  );
}

function findDeviceIndex(
  snapshot: MutableRemoteControlStoreSnapshot,
  userId: string,
  deviceId: string
): number {
  return snapshot.devices.findIndex(
    (device) => device.userId === userId && device.id === deviceId
  );
}

function findSessionIndex(
  snapshot: MutableRemoteControlStoreSnapshot,
  userId: string,
  sessionId: string
): number {
  return snapshot.sessions.findIndex(
    (session) => session.userId === userId && session.id === sessionId
  );
}

function resolvePairingCode(
  inputPairingCode: string | undefined,
  existingPairingCode: string | undefined
): { pairingCode?: string } {
  const nextPairingCode = inputPairingCode?.trim();
  if (nextPairingCode) {
    return { pairingCode: nextPairingCode };
  }
  return existingPairingCode ? { pairingCode: existingPairingCode } : {};
}

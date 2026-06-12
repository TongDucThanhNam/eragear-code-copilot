import { randomUUID } from "node:crypto";
import { NotFoundError, ValidationError } from "@/shared/errors";
import type {
  RemoteControlStatus,
  RemoteRelayDevice,
  RemoteSession,
  StartRemoteSessionInput,
  UpsertRemoteRelayDeviceInput,
} from "./contracts/remote-control.contract";
import type { RemoteControlRepositoryPort } from "./ports/remote-control-repository.port";

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
    const [devices, sessions] = await Promise.all([
      this.repository.listDevices(userId),
      this.repository.listSessions(userId),
    ]);
    const now = this.now();
    return {
      devices: devices.map((device) => this.withComputedStatus(device, now)),
      sessions: sessions.map((session) => this.withComputedSessionStatus(session, now)),
    };
  }

  async upsertDevice(
    userId: string,
    input: UpsertRemoteRelayDeviceInput
  ): Promise<RemoteRelayDevice> {
    const now = this.now();
    const existing = input.id
      ? await this.repository.getDevice(userId, input.id)
      : null;
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
      ...(input.pairingCode?.trim()
        ? { pairingCode: input.pairingCode.trim() }
        : existing?.pairingCode
          ? { pairingCode: existing.pairingCode }
          : {}),
      enabled: input.enabled ?? existing?.enabled ?? true,
      status: existing?.status ?? "offline",
      lastSeenAt: existing?.lastSeenAt ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    return this.withComputedStatus(
      await this.repository.saveDevice(next),
      now
    );
  }

  async deleteDevice(userId: string, deviceId: string): Promise<void> {
    const existing = await this.repository.getDevice(userId, deviceId);
    if (!existing) {
      throw new NotFoundError("Remote relay device not found", {
        module: MODULE,
        op: "deleteDevice",
        details: { deviceId },
      });
    }
    await this.repository.deleteDevice(userId, deviceId);
  }

  async recordHeartbeat(
    userId: string,
    deviceId: string
  ): Promise<RemoteRelayDevice> {
    const existing = await this.repository.getDevice(userId, deviceId);
    if (!existing) {
      throw new NotFoundError("Remote relay device not found", {
        module: MODULE,
        op: "recordHeartbeat",
        details: { deviceId },
      });
    }
    const now = this.now();
    const next = await this.repository.saveDevice({
      ...existing,
      status: existing.enabled ? "online" : "disabled",
      lastSeenAt: now,
      updatedAt: now,
    });
    return this.withComputedStatus(next, now);
  }

  async startSession(
    userId: string,
    input: StartRemoteSessionInput
  ): Promise<RemoteSession> {
    const device = await this.repository.getDevice(userId, input.deviceId);
    if (!device) {
      throw new NotFoundError("Remote relay device not found", {
        module: MODULE,
        op: "startSession",
        details: { deviceId: input.deviceId },
      });
    }
    const computedDevice = this.withComputedStatus(device, this.now());
    if (computedDevice.status === "disabled") {
      throw new ValidationError("Remote relay device is disabled", {
        module: MODULE,
        op: "startSession",
        details: { deviceId: input.deviceId },
      });
    }

    const now = this.now();
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
    return await this.repository.saveSession(session);
  }

  async stopSession(userId: string, sessionId: string): Promise<RemoteSession> {
    const existing = await this.repository.getSession(userId, sessionId);
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
    return await this.repository.saveSession({
      ...existing,
      status: "stopped",
      stoppedAt: this.now(),
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

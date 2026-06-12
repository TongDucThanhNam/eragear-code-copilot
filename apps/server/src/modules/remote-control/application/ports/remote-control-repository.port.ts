import type {
  RemoteRelayDevice,
  RemoteSession,
} from "../contracts/remote-control.contract";

export interface RemoteControlRepositoryPort {
  listDevices(userId: string): Promise<RemoteRelayDevice[]>;
  getDevice(userId: string, deviceId: string): Promise<RemoteRelayDevice | null>;
  saveDevice(device: RemoteRelayDevice): Promise<RemoteRelayDevice>;
  deleteDevice(userId: string, deviceId: string): Promise<void>;
  listSessions(userId: string): Promise<RemoteSession[]>;
  getSession(userId: string, sessionId: string): Promise<RemoteSession | null>;
  saveSession(session: RemoteSession): Promise<RemoteSession>;
}

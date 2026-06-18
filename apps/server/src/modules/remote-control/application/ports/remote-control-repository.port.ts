import type {
  RemoteRelayDevice,
  RemoteSession,
} from "../contracts/remote-control.contract";

export interface RemoteControlStoreSnapshot {
  devices: readonly RemoteRelayDevice[];
  sessions: readonly RemoteSession[];
}

export interface MutableRemoteControlStoreSnapshot {
  devices: RemoteRelayDevice[];
  sessions: RemoteSession[];
}

export interface RemoteControlRepositoryPort {
  read<T>(
    reader: (snapshot: RemoteControlStoreSnapshot) => T | Promise<T>
  ): Promise<T>;
  mutate<T>(
    mutator: (snapshot: MutableRemoteControlStoreSnapshot) => T | Promise<T>
  ): Promise<T>;
}

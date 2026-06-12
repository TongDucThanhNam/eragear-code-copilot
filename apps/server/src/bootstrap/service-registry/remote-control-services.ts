import {
  RemoteControlFileRepository,
  RemoteControlService,
} from "@/modules/remote-control";
import type { RemoteControlUseCases } from "@/modules/use-cases";
import { getStorageFileSync } from "@/platform/storage/storage-path";

export function createRemoteControlUseCases(): RemoteControlUseCases {
  const repository = new RemoteControlFileRepository({
    filePath: () => getStorageFileSync("remote-control.json"),
  });

  return {
    remoteControl: new RemoteControlService({ repository }),
  };
}

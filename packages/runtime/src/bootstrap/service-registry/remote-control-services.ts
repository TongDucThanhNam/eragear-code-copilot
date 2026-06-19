import { RemoteControlService } from "#runtime/modules/remote-control";
import { RemoteControlFileRepository } from "#runtime/modules/remote-control/di";
import type { RemoteControlUseCases } from "#runtime/modules/use-cases";
import { getStorageFileSync } from "#runtime/platform/storage/storage-path";

export function createRemoteControlUseCases(): RemoteControlUseCases {
  const repository = new RemoteControlFileRepository({
    filePath: () => getStorageFileSync("remote-control.json"),
  });

  return {
    remoteControl: new RemoteControlService({ repository }),
  };
}

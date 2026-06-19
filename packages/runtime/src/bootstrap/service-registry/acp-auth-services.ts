import path from "node:path";
import { AcpAuthService } from "#runtime/modules/acp-auth";
import { AcpAuthFileRepository } from "#runtime/modules/acp-auth/di";
import type {
  AcpAuthUseCases,
  CredentialUseCases,
} from "#runtime/modules/use-cases";
import {
  getStorageDirPathSync,
  getStorageFileSync,
} from "#runtime/platform/storage/storage-path";

export function createAcpAuthUseCases(
  credentialUseCases: CredentialUseCases
): AcpAuthUseCases {
  return {
    acpAuth: new AcpAuthService({
      repository: new AcpAuthFileRepository({
        filePath: () => getStorageFileSync("acp-auth.json"),
        storageRootPath: () => getStorageDirPathSync(),
      }),
      credentialResolver: {
        resolveSecret: async (userId, input) =>
          await credentialUseCases.credential.resolveSecret(userId, input),
      },
    }),
  };
}

export function getAcpAuthStorageRootForDiagnostics(): string {
  return path.join(getStorageDirPathSync(), "acp-auth");
}

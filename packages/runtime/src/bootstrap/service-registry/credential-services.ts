import { CredentialService } from "#runtime/modules/credential";
import { EncryptedCredentialFileStore } from "#runtime/modules/credential/di";
import type { CredentialUseCases } from "#runtime/modules/use-cases";
import { getAuthSecret } from "#runtime/platform/auth/secret";
import { getStorageFileSync } from "#runtime/platform/storage/storage-path";

export function createCredentialUseCases(): CredentialUseCases {
  return {
    credential: new CredentialService(
      new EncryptedCredentialFileStore({
        filePath: () => getStorageFileSync("credentials.json"),
        secretProvider: getAuthSecret,
      })
    ),
  };
}

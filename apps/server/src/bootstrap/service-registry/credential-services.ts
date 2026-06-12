import { CredentialService } from "@/modules/credential";
import { EncryptedCredentialFileStore } from "@/modules/credential/di";
import type { CredentialUseCases } from "@/modules/use-cases";
import { getAuthSecret } from "@/platform/auth/secret";
import { getStorageFileSync } from "@/platform/storage/storage-path";

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

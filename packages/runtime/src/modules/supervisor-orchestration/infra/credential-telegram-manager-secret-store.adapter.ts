import type { CredentialService } from "#runtime/modules/credential";
import type {
  TelegramManagerConfig,
  TelegramManagerSecretStorePort,
  TelegramPairingRecord,
} from "../application/telegram-manager-bridge.service";

const PROVIDER_ID = "telegram";
const CONFIG_NAME = "supervisos-telegram";
const PAIRING_NAME = "supervisos-telegram-pairing";

export class CredentialTelegramManagerSecretStoreAdapter
  implements TelegramManagerSecretStorePort
{
  private readonly credentials: Pick<
    CredentialService,
    "list" | "resolveSecret" | "upsert"
  >;

  constructor(
    credentials: Pick<CredentialService, "list" | "resolveSecret" | "upsert">
  ) {
    this.credentials = credentials;
  }

  loadConfig(userId: string): Promise<TelegramManagerConfig | null> {
    return this.load<TelegramManagerConfig>(userId, CONFIG_NAME);
  }

  saveConfig(userId: string, config: TelegramManagerConfig): Promise<void> {
    return this.save(userId, CONFIG_NAME, config);
  }

  loadPairing(userId: string): Promise<TelegramPairingRecord | null> {
    return this.load<TelegramPairingRecord>(userId, PAIRING_NAME);
  }

  savePairing(userId: string, pairing: TelegramPairingRecord): Promise<void> {
    return this.save(userId, PAIRING_NAME, pairing);
  }

  private async load<T>(userId: string, name: string): Promise<T | null> {
    const listed = await this.credentials.list(userId, {
      kind: "secret",
      providerId: PROVIDER_ID,
    });
    const record = listed.credentials.find(
      (credential) => credential.name === name
    );
    if (!record) {
      return null;
    }
    const resolved = await this.credentials.resolveSecret(userId, {
      id: record.id,
    });
    if (!resolved) {
      return null;
    }
    try {
      return JSON.parse(resolved.secret) as T;
    } catch {
      throw new Error(`Encrypted Telegram credential ${name} is invalid.`);
    }
  }

  private async save<T>(userId: string, name: string, value: T): Promise<void> {
    const existing = await this.credentials.list(userId, {
      providerId: PROVIDER_ID,
      kind: "secret",
    });
    const record = existing.credentials.find(
      (credential) => credential.name === name
    );
    await this.credentials.upsert(userId, {
      ...(record ? { id: record.id } : {}),
      name,
      kind: "secret",
      providerId: PROVIDER_ID,
      secret: JSON.stringify(value),
    });
  }
}

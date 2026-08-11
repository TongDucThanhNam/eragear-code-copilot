import { describe, expect, test } from "bun:test";
import { CredentialTelegramManagerSecretStoreAdapter } from "./credential-telegram-manager-secret-store.adapter";

function createCredentials(input?: { existing?: boolean }) {
  const calls = {
    list: 0,
    resolveSecret: 0,
  };
  return {
    calls,
    service: {
      list() {
        calls.list += 1;
        return Promise.resolve({
          credentials: input?.existing
            ? [
                {
                  id: "telegram-config",
                  name: "supervisos-telegram",
                },
              ]
            : [],
          totalCount: input?.existing ? 1 : 0,
        });
      },
      resolveSecret() {
        calls.resolveSecret += 1;
        return Promise.resolve({
          credential: { id: "telegram-config" },
          secret: JSON.stringify({
            botToken: "token",
            decisionKey: "decision-key",
            timezone: "UTC",
          }),
        });
      },
      upsert() {
        return Promise.resolve({ id: "telegram-config" });
      },
    },
  };
}

describe("CredentialTelegramManagerSecretStoreAdapter", () => {
  test("keeps missing Telegram config lookup read-only", async () => {
    const { calls, service } = createCredentials();
    const adapter = new CredentialTelegramManagerSecretStoreAdapter(
      service as never
    );

    expect(await adapter.loadConfig("user-1")).toBeNull();
    expect(calls).toEqual({ list: 1, resolveSecret: 0 });
  });

  test("resolves the encrypted secret only after finding its record", async () => {
    const { calls, service } = createCredentials({ existing: true });
    const adapter = new CredentialTelegramManagerSecretStoreAdapter(
      service as never
    );

    expect(await adapter.loadConfig("user-1")).toEqual({
      botToken: "token",
      decisionKey: "decision-key",
      timezone: "UTC",
    });
    expect(calls).toEqual({ list: 1, resolveSecret: 1 });
  });
});

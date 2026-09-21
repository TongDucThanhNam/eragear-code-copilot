import { describe, expect, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import { CryptoHasher } from "bun";

describe("Bun cryptographic hashing compatibility", () => {
  test("matches Node SHA-256 for UTF-8 and binary payloads", () => {
    const text = "Eragear workflow payload — xin chào";
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);

    expect(CryptoHasher.hash("sha256", text, "hex")).toBe(
      createHash("sha256").update(text).digest("hex")
    );
    expect(CryptoHasher.hash("sha256", bytes, "hex")).toBe(
      createHash("sha256").update(bytes).digest("hex")
    );
  });

  test("matches incremental Node hashing and HMAC output", () => {
    const nodeHash = createHash("sha256")
      .update("first", "utf8")
      .update("second", "utf8")
      .digest("hex");
    const bunHash = new CryptoHasher("sha256")
      .update("first", "utf8")
      .update("second", "utf8")
      .digest("hex");
    const key = Buffer.from("supervisos-decision-key");
    const payload = "run|revision|decision";

    expect(bunHash).toBe(nodeHash);
    expect(
      new CryptoHasher("sha256", key).update(payload).digest("base64url")
    ).toBe(createHmac("sha256", key).update(payload).digest("base64url"));
  });
});

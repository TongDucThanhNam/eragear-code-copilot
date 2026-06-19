import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign as signJwtPayload } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { validateCloudflareAccessHandshakeAuth } from "./server-cloudflare-access";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

function encodeBase64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function createJwt(params?: {
  issuer?: string;
  audience?: string;
  expiresInSeconds?: number;
}): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
  };
  const payload = {
    iss: params?.issuer ?? "https://example.cloudflareaccess.com",
    aud: params?.audience ?? "aud-1",
    exp: nowSeconds + (params?.expiresInSeconds ?? 300),
    nbf: nowSeconds - 1,
  };
  const headerSegment = encodeBase64Url(header);
  const payloadSegment = encodeBase64Url(payload);
  const signatureSegment = signJwtPayload(
    "RSA-SHA256",
    Buffer.from(`${headerSegment}.${payloadSegment}`),
    privateKey
  ).toString("base64url");
  return `${headerSegment}.${payloadSegment}.${signatureSegment}`;
}

function exportPublicKeyPem(): string {
  const exported = publicKey.export({ type: "pkcs1", format: "pem" });
  return typeof exported === "string" ? exported : exported.toString("utf8");
}

describe("validateCloudflareAccessHandshakeAuth", () => {
  test("accepts matching Cloudflare Access service token headers", () => {
    const headers: IncomingHttpHeaders = {
      "cf-access-client-id": "client-id",
      "cf-access-client-secret": "client-secret",
    };

    const result = validateCloudflareAccessHandshakeAuth(headers, {
      clientId: "client-id",
      clientSecret: "client-secret",
    });
    expect(result).toEqual({ ok: true });
  });

  test("rejects invalid Cloudflare Access service token headers", () => {
    const headers: IncomingHttpHeaders = {
      "cf-access-client-id": "client-id",
      "cf-access-client-secret": "bad-secret",
    };

    const result = validateCloudflareAccessHandshakeAuth(headers, {
      clientId: "client-id",
      clientSecret: "client-secret",
    });
    expect(result).toEqual({ ok: false, reason: "invalid_service_token" });
  });

  test("rejects partial Cloudflare Access service token headers", () => {
    const headers: IncomingHttpHeaders = {
      "cf-access-client-id": "client-id",
    };

    const result = validateCloudflareAccessHandshakeAuth(headers, {
      clientId: "client-id",
      clientSecret: "client-secret",
    });
    expect(result).toEqual({
      ok: false,
      reason: "partial_service_token_headers",
    });
  });

  test("accepts valid Cloudflare Access JWT assertion", () => {
    const headers: IncomingHttpHeaders = {
      "cf-access-jwt-assertion": createJwt(),
    };

    const result = validateCloudflareAccessHandshakeAuth(headers, {
      jwt: {
        publicKeyPem: exportPublicKeyPem(),
        audience: "aud-1",
        issuer: "https://example.cloudflareaccess.com",
      },
    });
    expect(result).toEqual({ ok: true });
  });

  test("rejects Cloudflare Access JWT assertion with invalid signature", () => {
    const jwt = createJwt();
    const segments = jwt.split(".");
    const tamperedPayload = encodeBase64Url({
      iss: "https://example.cloudflareaccess.com",
      aud: "aud-1",
      exp: Math.floor(Date.now() / 1000) + 300,
      nbf: Math.floor(Date.now() / 1000) - 1,
      tampered: true,
    });
    const headers: IncomingHttpHeaders = {
      "cf-access-jwt-assertion": `${segments[0]}.${tamperedPayload}.${segments[2]}`,
    };

    const result = validateCloudflareAccessHandshakeAuth(headers, {
      jwt: {
        publicKeyPem: exportPublicKeyPem(),
        audience: "aud-1",
        issuer: "https://example.cloudflareaccess.com",
      },
    });
    expect(result).toEqual({ ok: false, reason: "invalid_jwt" });
  });

  test("rejects handshake when no Cloudflare Access credentials are present", () => {
    const headers: IncomingHttpHeaders = {};

    const result = validateCloudflareAccessHandshakeAuth(headers, {
      clientId: "client-id",
      clientSecret: "client-secret",
    });
    expect(result).toEqual({ ok: false, reason: "missing_credentials" });
  });
});

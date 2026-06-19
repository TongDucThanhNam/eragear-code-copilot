import { describe, expect, test } from "bun:test";
import { redactSensitiveTextSample } from "./redaction.util";

describe("redactSensitiveTextSample", () => {
  test("redacts explicit secret assignments and bearer headers", () => {
    const sample =
      'password="sup3r-secret" authorization=Bearer abcdefghijklmnopqrstuvwxyz123456';

    expect(redactSensitiveTextSample(sample)).toBe(
      "password=[redacted] authorization=[redacted]"
    );
  });

  test("redacts high-entropy standalone tokens", () => {
    const sample = "stderr token ZXhhbXBsZVRva2VuMTIzNDU2Nzg5MEFCQ0RFRg==";

    expect(redactSensitiveTextSample(sample)).toContain("[redacted:");
    expect(redactSensitiveTextSample(sample)).not.toContain(
      "ZXhhbXBsZVRva2VuMTIzNDU2Nzg5MEFCQ0RFRg=="
    );
  });
});

import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { ENV } from "@/config/environment";
import { setRuntimeLogLevel } from "./runtime-log-level";
import { createLogger } from "./structured-logger";

describe("structured-logger", () => {
  const originalLogOutputFormat = ENV.logOutputFormat;

  afterEach(() => {
    mock.restore();
    ENV.logOutputFormat = originalLogOutputFormat;
  });

  test("emits JSON lines when log output format is json", () => {
    ENV.logOutputFormat = "json";
    setRuntimeLogLevel("debug");
    const logSpy = spyOn(console, "log").mockImplementation(() => undefined);

    createLogger("Storage").info("SQLite worker started", { pid: 1234 });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const output = String(logSpy.mock.calls[0]?.[0] ?? "");
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed.level).toBe("info");
    expect(parsed.tag).toBe("Storage");
    expect(parsed.message).toBe("SQLite worker started");
    expect(parsed.context).toEqual({ pid: 1234 });
  });

  test("emits formatted text when log output format is text", () => {
    ENV.logOutputFormat = "text";
    setRuntimeLogLevel("debug");
    const warnSpy = spyOn(console, "warn").mockImplementation(() => undefined);

    createLogger("Storage").warn("SQLite write rejected", { code: "CONFLICT" });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const output = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(output).toContain("WARN");
    expect(output).toContain("[Storage]");
    expect(output).toContain("SQLite write rejected");
  });

  test("safely serializes circular context and bigint values", () => {
    ENV.logOutputFormat = "json";
    setRuntimeLogLevel("debug");
    const infoSpy = spyOn(console, "log").mockImplementation(() => undefined);
    const cyclic: Record<string, unknown> = { id: "root", count: 42n };
    cyclic.self = cyclic;

    expect(() => {
      createLogger("Debug").info("Cycle safe", { cyclic });
    }).not.toThrow();

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const output = String(infoSpy.mock.calls[0]?.[0] ?? "");
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed.message).toBe("Cycle safe");
    expect(parsed.context).toEqual({
      cyclic: {
        id: "root",
        count: 42,
        self: "[Circular]",
      },
    });
  });
});

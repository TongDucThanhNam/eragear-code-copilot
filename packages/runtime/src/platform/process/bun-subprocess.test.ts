import { describe, expect, test } from "bun:test";
import {
  BunSubprocessError,
  BunSubprocessOutputLimitError,
  runBunSubprocess,
} from "./bun-subprocess";

describe("runBunSubprocess", () => {
  test("captures stdout and stderr without a shell", async () => {
    const result = await runBunSubprocess(process.execPath, [
      "-e",
      'process.stdout.write("out"); process.stderr.write("err");',
    ]);

    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "out",
      stderr: "err",
    });
  });

  test("preserves execFile-compatible failure evidence", async () => {
    try {
      await runBunSubprocess(process.execPath, [
        "-e",
        'process.stdout.write("partial"); process.stderr.write("failure"); process.exit(7);',
      ]);
      throw new Error("Expected subprocess to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BunSubprocessError);
      expect(error).toMatchObject({
        code: 7,
        stdout: "partial",
        stderr: "failure",
      });
    }
  });

  test("kills output that exceeds the configured buffer", async () => {
    await expect(
      runBunSubprocess(
        process.execPath,
        ["-e", 'process.stdout.write("x".repeat(4096));'],
        { maxBuffer: 32 }
      )
    ).rejects.toBeInstanceOf(BunSubprocessOutputLimitError);
  });

  test("terminates commands after the configured timeout", async () => {
    const startedAt = performance.now();
    await expect(
      runBunSubprocess(process.execPath, ["-e", "await Bun.sleep(10_000);"], {
        timeout: 50,
      })
    ).rejects.toMatchObject({ signalCode: "SIGTERM" });
    expect(performance.now() - startedAt).toBeLessThan(2000);
  });
});

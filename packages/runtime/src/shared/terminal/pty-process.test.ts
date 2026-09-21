import { describe, expect, test } from "bun:test";
import { sleep } from "bun";
import { spawnTerminalPty } from "./pty-process";

describe("spawnTerminalPty", () => {
  test("uses Bun.Terminal for PTY output and process exit", async () => {
    const pty = await spawnTerminalPty({
      command: process.execPath,
      args: ["-e", 'console.log("BUN_TERMINAL_READY")'],
      cwd: process.cwd(),
      env: { ...process.env } as Record<string, string>,
      cols: 90,
      rows: 30,
    });
    let output = "";
    pty.onData((data) => {
      output += data;
    });
    const exit = await new Promise<{ exitCode: number }>((resolve) => {
      pty.onExit(resolve);
    });

    expect(exit.exitCode).toBe(0);
    expect(output).toContain("BUN_TERMINAL_READY");
    expect(pty.cols).toBe(90);
    expect(pty.rows).toBe(30);
  });

  test("buffers output while paused and drains it on resume", async () => {
    const pty = await spawnTerminalPty({
      command: process.execPath,
      args: [
        "-e",
        'await Bun.sleep(25); console.log("PAUSED_OUTPUT"); await Bun.sleep(100);',
      ],
      cwd: process.cwd(),
      env: { ...process.env } as Record<string, string>,
      cols: 80,
      rows: 24,
    });
    let output = "";
    pty.onData((data) => {
      output += data;
    });
    pty.pause?.();
    await sleep(75);
    expect(output).not.toContain("PAUSED_OUTPUT");

    pty.resume?.();
    const exit = await new Promise<{ exitCode: number }>((resolve) => {
      pty.onExit(resolve);
    });
    expect(exit.exitCode).toBe(0);
    expect(output).toContain("PAUSED_OUTPUT");
  });

  test("drains paused output before reporting process exit", async () => {
    const pty = await spawnTerminalPty({
      command: process.execPath,
      args: ["-e", 'console.log("OUTPUT_BEFORE_EXIT")'],
      cwd: process.cwd(),
      env: { ...process.env } as Record<string, string>,
      cols: 80,
      rows: 24,
    });
    let output = "";
    pty.onData((data) => {
      output += data;
    });
    pty.pause?.();
    await new Promise<void>((resolve) => {
      pty.onExit(() => {
        expect(output).toContain("OUTPUT_BEFORE_EXIT");
        resolve();
      });
    });
  });
});

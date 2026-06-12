import { describe, expect, test } from "bun:test";
import { ENV } from "@/config/environment";
import type { TerminalEvent } from "../application/contracts/terminal.contract";
import { ChildProcessTerminalRuntimeAdapter } from "./child-process-terminal-runtime.adapter";

describe("ChildProcessTerminalRuntimeAdapter", () => {
  test("spawns an allowlisted process and streams stdin/stdout", async () => {
    const previousPolicies = ENV.allowedTerminalCommandPolicies;
    const previousEnvKeys = ENV.allowedEnvKeys;
    ENV.allowedTerminalCommandPolicies = [
      { command: process.execPath, allowAnyArgs: true },
    ];
    ENV.allowedEnvKeys = ["PATH", "HOME", "USERPROFILE", "TMP", "TEMP"];
    try {
      let now = 1;
      const runtime = new ChildProcessTerminalRuntimeAdapter({
        nowMs: () => now++,
      });
      const events: TerminalEvent[] = [];
      const terminal = await runtime.create({
        userId: "user-1",
        cwd: process.cwd(),
        settings: {
          inheritSystemProfile: false,
          shellCommand: process.execPath,
          shellArgs: [
            "-e",
            "process.stdin.resume(); process.stdin.once('data', d => { process.stdout.write('echo:' + d.toString()); process.exit(0); });",
          ],
        },
      });
      const unsubscribe = runtime.subscribe("user-1", terminal.id, (event) =>
        events.push(event)
      );

      await runtime.write("user-1", terminal.id, "hello\n");
      await waitFor(() =>
        events.some(
          (event) =>
            event.type === "output" && event.data.includes("echo:hello")
        )
      );

      await waitFor(() =>
        events.some(
          (event) =>
            event.type === "status" && event.terminal.status === "exited"
        )
      );
      unsubscribe();
      expect((await runtime.list("user-1"))[0]?.status).toBe("exited");
    } finally {
      ENV.allowedTerminalCommandPolicies = previousPolicies;
      ENV.allowedEnvKeys = previousEnvKeys;
    }
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for terminal event");
}

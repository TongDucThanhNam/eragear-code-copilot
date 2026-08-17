import { describe, expect, test } from "bun:test";
import path from "node:path";
import { resolveDesktopRuntimeLaunch } from "./runtime-launch.js";

describe("resolveDesktopRuntimeLaunch", () => {
  test("launches the source service through Bun during development", () => {
    const runtimeRoot = path.resolve("packages", "runtime");
    const launch = resolveDesktopRuntimeLaunch({
      role: "desktop-service",
      runtimeRoot,
    });

    expect(launch.command).toBe("bun");
    expect(launch.args).toEqual([
      "run",
      path.join("src", "runtime", "desktop-service.ts"),
    ]);
    expect(launch.requiredFile).toBe(
      path.join(runtimeRoot, "src", "runtime", "desktop-service.ts")
    );
  });

  test("launches either packaged role through the compiled sidecar", () => {
    const runtimeRoot = path.resolve("resources", "runtime");
    const runtimeExecutable = path.join(runtimeRoot, "eragear-runtime.exe");

    expect(
      resolveDesktopRuntimeLaunch({
        role: "desktop-service",
        runtimeExecutable,
        runtimeRoot,
      })
    ).toEqual({
      command: runtimeExecutable,
      args: ["desktop-service"],
      requiredFile: runtimeExecutable,
    });
    expect(
      resolveDesktopRuntimeLaunch({
        role: "daemon-service",
        runtimeExecutable,
        runtimeRoot,
      }).args
    ).toEqual(["daemon-service"]);
  });
});

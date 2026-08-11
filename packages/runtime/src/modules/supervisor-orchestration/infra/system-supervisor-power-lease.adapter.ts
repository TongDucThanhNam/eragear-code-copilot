import { type ChildProcess, execFile, spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { SupervisorPowerLeasePort } from "../application/supervisor-power-lease-coordinator.service";
import type { SupervisorPowerPolicyDecision } from "../application/supervisor-power-policy.service";

const execFileAsync = promisify(execFile);

export class SystemSupervisorPowerLeaseAdapter
  implements SupervisorPowerLeasePort
{
  private inhibitor: ChildProcess | null = null;
  private scheduledWakeAt: string | null = null;
  private wakeTimerMayExist =
    process.env.ERAGEAR_RUNTIME_TRANSPORT === "user-daemon";

  async isOnAcPower(): Promise<boolean> {
    if (process.env.ERAGEAR_RUNTIME_TRANSPORT !== "user-daemon") {
      return false;
    }
    if (os.platform() === "win32") {
      try {
        const { stdout } = await execFileAsync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "(Get-CimInstance Win32_Battery | Select-Object -First 1 -ExpandProperty BatteryStatus)",
          ],
          { windowsHide: true, timeout: 3000 }
        );
        const rawStatus = stdout.trim();
        if (!rawStatus) {
          return true;
        }
        const status = Number(rawStatus);
        return (
          !Number.isFinite(status) ||
          status === 2 ||
          status === 6 ||
          status === 7 ||
          status === 8 ||
          status === 9 ||
          status === 11
        );
      } catch {
        return true;
      }
    }
    if (os.platform() === "linux") {
      try {
        const root = "/sys/class/power_supply";
        for (const entry of await readdir(root)) {
          const type = (
            await readFile(path.join(root, entry, "type"), "utf8")
          ).trim();
          if (type !== "Mains" && type !== "USB") {
            continue;
          }
          if (
            (
              await readFile(path.join(root, entry, "online"), "utf8")
            ).trim() === "1"
          ) {
            return true;
          }
        }
        return false;
      } catch {
        return true;
      }
    }
    return false;
  }

  async apply(decision: SupervisorPowerPolicyDecision): Promise<void> {
    if (decision.wakeAt) {
      await this.scheduleWake(decision.wakeAt);
    } else {
      await this.cancelWake();
    }
    if (!decision.holdInhibitor) {
      this.release();
      return;
    }
    if (this.inhibitor && this.inhibitor.exitCode === null) {
      return;
    }
    this.inhibitor = createInhibitorProcess();
    this.inhibitor.once("exit", () => {
      this.inhibitor = null;
    });
  }

  async dispose(): Promise<void> {
    this.release();
    await this.cancelWake();
  }

  private release(): void {
    const inhibitor = this.inhibitor;
    this.inhibitor = null;
    if (inhibitor && inhibitor.exitCode === null) {
      inhibitor.kill();
    }
  }

  private async scheduleWake(wakeAt: string): Promise<void> {
    if (
      process.env.ERAGEAR_RUNTIME_TRANSPORT !== "user-daemon" ||
      this.scheduledWakeAt === wakeAt
    ) {
      return;
    }
    const instant = new Date(wakeAt);
    if (!Number.isFinite(instant.getTime())) {
      return;
    }
    await this.cancelWake();
    if (os.platform() === "linux") {
      await execFileAsync(
        "systemd-run",
        [
          "--user",
          "--unit=eragear-runtime-wake",
          `--on-calendar=${instant.toISOString()}`,
          "--timer-property=WakeSystem=true",
          "/usr/bin/true",
        ],
        { timeout: 5000 }
      );
      this.scheduledWakeAt = wakeAt;
      this.wakeTimerMayExist = true;
      return;
    }
    if (os.platform() === "win32") {
      const iso = instant.toISOString();
      const command = [
        "$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c exit 0';",
        `$trigger = New-ScheduledTaskTrigger -Once -At ([DateTimeOffset]::Parse('${iso}').LocalDateTime);`,
        "$settings = New-ScheduledTaskSettingsSet -WakeToRun;",
        "Register-ScheduledTask -TaskName 'EragearRuntimeWake' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null",
      ].join(" ");
      await execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-WindowStyle",
          "Hidden",
          "-Command",
          command,
        ],
        { windowsHide: true, timeout: 5000 }
      );
      this.scheduledWakeAt = wakeAt;
      this.wakeTimerMayExist = true;
    }
  }

  private async cancelWake(): Promise<void> {
    if (!this.wakeTimerMayExist) {
      return;
    }
    try {
      if (os.platform() === "linux") {
        await execFileAsync(
          "systemctl",
          ["--user", "stop", "eragear-runtime-wake.timer"],
          { timeout: 5000 }
        );
      } else if (os.platform() === "win32") {
        await execFileAsync(
          "schtasks.exe",
          ["/Delete", "/TN", "EragearRuntimeWake", "/F"],
          { windowsHide: true, timeout: 5000 }
        );
      }
    } catch {
      // The one-shot timer may already have fired or been removed by the OS.
    } finally {
      this.scheduledWakeAt = null;
      this.wakeTimerMayExist = false;
    }
  }
}

function createInhibitorProcess(): ChildProcess {
  if (os.platform() === "linux") {
    return spawn(
      "systemd-inhibit",
      [
        "--what=sleep",
        "--mode=block",
        "--why=Eragear Supervisos has runnable work",
        "sh",
        "-c",
        "while :; do sleep 3600; done",
      ],
      { stdio: "ignore" }
    );
  }
  if (os.platform() === "win32") {
    const command = [
      "Add-Type -TypeDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint esFlags);' -Name NativePower -Namespace Eragear;",
      "while ($true) { [Eragear.NativePower]::SetThreadExecutionState(0x80000001) | Out-Null; Start-Sleep -Seconds 20 }",
    ].join(" ");
    return spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        command,
      ],
      { stdio: "ignore", windowsHide: true }
    );
  }
  throw new Error("Power inhibition is unsupported on this platform.");
}

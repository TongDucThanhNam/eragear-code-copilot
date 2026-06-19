import type { DesktopAutoUpdateStatus } from "@eragear-code-copilot/shared";

const VERSION_PREFIX_PATTERN = /^v/i;

export interface DesktopUpdateManifest {
  version: string;
  url?: string;
  notes?: string;
}

export interface DesktopAutoUpdateControllerOptions {
  currentVersion: string;
  manifestUrl?: string;
  fetchManifest?: (url: string) => Promise<unknown>;
  notifyUpdate?: (status: DesktopAutoUpdateStatus) => void;
  now?: () => Date;
}

export class DesktopAutoUpdateController {
  private readonly currentVersion: string;
  private readonly manifestUrl: string;
  private readonly fetchManifest: (url: string) => Promise<unknown>;
  private readonly notifyUpdate?: (status: DesktopAutoUpdateStatus) => void;
  private readonly now: () => Date;
  private statusValue: DesktopAutoUpdateStatus;
  private notifiedVersion: string | null = null;

  constructor(options: DesktopAutoUpdateControllerOptions) {
    this.currentVersion = options.currentVersion;
    this.manifestUrl = options.manifestUrl?.trim() ?? "";
    this.fetchManifest = options.fetchManifest ?? fetchJson;
    this.notifyUpdate = options.notifyUpdate;
    this.now = options.now ?? (() => new Date());
    this.statusValue = this.manifestUrl
      ? {
          state: "idle",
          currentVersion: this.currentVersion,
          updateAvailable: false,
          manifestUrl: this.manifestUrl,
        }
      : {
          state: "not-configured",
          currentVersion: this.currentVersion,
          updateAvailable: false,
        };
  }

  status(): DesktopAutoUpdateStatus {
    return { ...this.statusValue };
  }

  async checkForUpdates(options?: {
    notify?: boolean;
  }): Promise<DesktopAutoUpdateStatus> {
    if (!this.manifestUrl) {
      this.statusValue = {
        state: "not-configured",
        currentVersion: this.currentVersion,
        updateAvailable: false,
      };
      return this.status();
    }

    this.statusValue = {
      ...this.statusValue,
      state: "checking",
      manifestUrl: this.manifestUrl,
    };
    try {
      const manifest = parseDesktopUpdateManifest(
        await this.fetchManifest(this.manifestUrl)
      );
      const updateAvailable =
        compareVersions(manifest.version, this.currentVersion) > 0;
      this.statusValue = {
        state: updateAvailable ? "available" : "not-available",
        currentVersion: this.currentVersion,
        latestVersion: manifest.version,
        updateAvailable,
        manifestUrl: this.manifestUrl,
        ...(manifest.url ? { downloadUrl: manifest.url } : {}),
        ...(manifest.notes ? { releaseNotes: manifest.notes } : {}),
        checkedAt: this.now().toISOString(),
        notificationShown:
          updateAvailable && this.notifiedVersion === manifest.version,
      };
      if (
        updateAvailable &&
        options?.notify !== false &&
        this.notifyUpdate &&
        this.notifiedVersion !== manifest.version
      ) {
        this.notifyUpdate(this.statusValue);
        this.notifiedVersion = manifest.version;
        this.statusValue = {
          ...this.statusValue,
          notificationShown: true,
        };
      }
    } catch (error) {
      this.statusValue = {
        state: "error",
        currentVersion: this.currentVersion,
        updateAvailable: false,
        manifestUrl: this.manifestUrl,
        checkedAt: this.now().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
    return this.status();
  }
}

export function parseDesktopUpdateManifest(
  value: unknown
): DesktopUpdateManifest {
  if (!value || typeof value !== "object") {
    throw new Error("Update manifest must be an object");
  }
  const candidate = value as Partial<DesktopUpdateManifest>;
  if (!(typeof candidate.version === "string" && candidate.version.trim())) {
    throw new Error("Update manifest version is required");
  }
  return {
    version: candidate.version.trim(),
    ...(typeof candidate.url === "string" && candidate.url.trim()
      ? { url: candidate.url.trim() }
      : {}),
    ...(typeof candidate.notes === "string" && candidate.notes.trim()
      ? { notes: candidate.notes.trim() }
      : {}),
  };
}

export function compareVersions(left: string, right: string): number {
  const leftParts = normalizeVersion(left);
  const rightParts = normalizeVersion(right);
  const length = Math.max(leftParts.numbers.length, rightParts.numbers.length);
  for (let index = 0; index < length; index += 1) {
    const diff =
      (leftParts.numbers[index] ?? 0) - (rightParts.numbers[index] ?? 0);
    if (diff !== 0) {
      return Math.sign(diff);
    }
  }
  if (leftParts.prerelease && !rightParts.prerelease) {
    return -1;
  }
  if (!leftParts.prerelease && rightParts.prerelease) {
    return 1;
  }
  return leftParts.prerelease.localeCompare(rightParts.prerelease);
}

function normalizeVersion(value: string): {
  numbers: number[];
  prerelease: string;
} {
  const cleaned =
    value.trim().replace(VERSION_PREFIX_PATTERN, "").split("+")[0] ?? "";
  const [version = "", prerelease = ""] = cleaned.split("-", 2);
  return {
    numbers: version
      .split(".")
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0)),
    prerelease,
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Update manifest request failed: ${response.status}`);
  }
  return await response.json();
}

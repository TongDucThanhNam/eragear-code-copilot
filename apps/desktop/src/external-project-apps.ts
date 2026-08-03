import { spawn } from "node:child_process";
import { access, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { shell } from "electron";

export const EXTERNAL_PROJECT_APP_TARGETS = [
  "zed",
  "vscode",
  "antigravity",
  "warp",
  "github-desktop",
  "file-explorer",
  "terminal",
  "git-bash",
] as const;

export type ExternalProjectAppTarget =
  (typeof EXTERNAL_PROJECT_APP_TARGETS)[number];

export interface OpenProjectInExternalAppInput {
  projectPath: string;
  target: ExternalProjectAppTarget;
}

export interface OpenProjectInExternalAppResult {
  method: string;
  projectPath: string;
  target: ExternalProjectAppTarget;
}

interface SpawnCandidate {
  args: string[];
  command: string;
  cwd?: string;
}

const TARGET_LABELS: Record<ExternalProjectAppTarget, string> = {
  antigravity: "Antigravity",
  "file-explorer": os.platform() === "darwin" ? "Finder" : "File Explorer",
  "git-bash": "Git Bash",
  "github-desktop": "GitHub Desktop",
  terminal: "Terminal",
  vscode: "VS Code",
  warp: "Warp",
  zed: "Zed",
};

export function isExternalProjectAppTarget(
  value: unknown
): value is ExternalProjectAppTarget {
  return (
    typeof value === "string" &&
    EXTERNAL_PROJECT_APP_TARGETS.includes(value as ExternalProjectAppTarget)
  );
}

export async function openProjectInExternalApp(
  input: OpenProjectInExternalAppInput
): Promise<OpenProjectInExternalAppResult> {
  const projectPath = await resolveProjectDirectory(input.projectPath);

  switch (input.target) {
    case "file-explorer":
      return await openProjectInFileExplorer(input.target, projectPath);
    case "terminal":
      return await openProjectInTerminal(input.target, projectPath);
    case "warp":
      return await openProjectInWarp(input.target, projectPath);
    case "vscode":
      return await openProjectInVSCode(input.target, projectPath);
    case "zed":
      return await openProjectInZed(input.target, projectPath);
    case "antigravity":
      return await openProjectInAntigravity(input.target, projectPath);
    case "github-desktop":
      return await openProjectInGitHubDesktop(input.target, projectPath);
    case "git-bash":
      return await openProjectInGitBash(input.target, projectPath);
    default: {
      const unsupportedTarget: never = input.target;
      throw new Error(`Unsupported external app target: ${unsupportedTarget}`);
    }
  }
}

async function resolveProjectDirectory(rawPath: string): Promise<string> {
  const trimmedPath = rawPath.trim();
  if (!trimmedPath) {
    throw new Error("Project path is required.");
  }
  const projectPath = path.resolve(trimmedPath);
  const projectStat = await stat(projectPath).catch(() => null);
  if (!projectStat?.isDirectory()) {
    throw new Error("Project path must be an existing folder.");
  }
  return projectPath;
}

async function openProjectInFileExplorer(
  target: ExternalProjectAppTarget,
  projectPath: string
): Promise<OpenProjectInExternalAppResult> {
  const errorMessage = await shell.openPath(projectPath);
  if (errorMessage) {
    throw new Error(errorMessage);
  }
  return { method: "electron-shell-open-path", projectPath, target };
}

async function openProjectInTerminal(
  target: ExternalProjectAppTarget,
  projectPath: string
): Promise<OpenProjectInExternalAppResult> {
  if (os.platform() === "win32") {
    const uriResult = await tryOpenExternalUri(
      `ms-terminal:new-tab?startingDirectory=${encodeURIComponent(projectPath)}`,
      target,
      projectPath,
      "windows-terminal-uri"
    );
    if (uriResult) {
      return uriResult;
    }
    return await spawnFirstAvailable(target, projectPath, [
      { command: "wt.exe", args: ["-d", projectPath], cwd: projectPath },
    ]);
  }

  if (os.platform() === "darwin") {
    return await spawnFirstAvailable(target, projectPath, [
      {
        command: "open",
        args: ["-a", "Terminal", projectPath],
        cwd: projectPath,
      },
    ]);
  }

  return await spawnFirstAvailable(target, projectPath, [
    {
      command: "x-terminal-emulator",
      args: ["--working-directory", projectPath],
      cwd: projectPath,
    },
    {
      command: "gnome-terminal",
      args: [`--working-directory=${projectPath}`],
      cwd: projectPath,
    },
    { command: "konsole", args: ["--workdir", projectPath], cwd: projectPath },
  ]);
}

async function openProjectInWarp(
  target: ExternalProjectAppTarget,
  projectPath: string
): Promise<OpenProjectInExternalAppResult> {
  const uriResult = await tryOpenExternalUri(
    `warp://action/new_tab?path=${encodeURIComponent(projectPath)}`,
    target,
    projectPath,
    "warp-uri"
  );
  if (uriResult) {
    return uriResult;
  }

  return await spawnFirstAvailable(
    target,
    projectPath,
    platformCandidates({
      darwin: [
        {
          command: "open",
          args: ["-a", "Warp", projectPath],
          cwd: projectPath,
        },
      ],
      other: [
        { command: "warp-terminal", args: [projectPath], cwd: projectPath },
      ],
      win32: windowsExecutableCandidates("Warp", "Warp.exe", projectPath),
    })
  );
}

async function openProjectInVSCode(
  target: ExternalProjectAppTarget,
  projectPath: string
): Promise<OpenProjectInExternalAppResult> {
  const uriResult = await tryOpenExternalUri(
    `vscode://file/${encodeURI(toUriPath(projectPath))}`,
    target,
    projectPath,
    "vscode-file-uri"
  );
  if (uriResult) {
    return uriResult;
  }

  return await spawnFirstAvailable(
    target,
    projectPath,
    platformCandidates({
      darwin: [
        {
          command: "open",
          args: ["-a", "Visual Studio Code", projectPath],
          cwd: projectPath,
        },
      ],
      other: [{ command: "code", args: [projectPath], cwd: projectPath }],
      win32: [
        ...windowsProgramCandidates(
          [
            ["Microsoft VS Code", "Code.exe"],
            [path.join("Programs", "Microsoft VS Code"), "Code.exe"],
          ],
          projectPath
        ),
        { command: "code.exe", args: [projectPath], cwd: projectPath },
      ],
    })
  );
}

async function openProjectInZed(
  target: ExternalProjectAppTarget,
  projectPath: string
): Promise<OpenProjectInExternalAppResult> {
  return await spawnFirstAvailable(
    target,
    projectPath,
    platformCandidates({
      darwin: [
        {
          command: "open",
          args: ["-a", "Zed", projectPath],
          cwd: projectPath,
        },
      ],
      other: [{ command: "zed", args: [projectPath], cwd: projectPath }],
      win32: [
        ...windowsProgramCandidates(
          [
            ["Zed", "Zed.exe"],
            [path.join("Programs", "Zed"), "Zed.exe"],
          ],
          projectPath
        ),
        { command: "zed.exe", args: [projectPath], cwd: projectPath },
      ],
    })
  );
}

async function openProjectInAntigravity(
  target: ExternalProjectAppTarget,
  projectPath: string
): Promise<OpenProjectInExternalAppResult> {
  return await spawnFirstAvailable(
    target,
    projectPath,
    platformCandidates({
      darwin: [
        {
          command: "open",
          args: ["-a", "Antigravity", projectPath],
          cwd: projectPath,
        },
      ],
      other: [
        { command: "antigravity", args: [projectPath], cwd: projectPath },
      ],
      win32: [
        ...windowsProgramCandidates(
          [
            ["Antigravity", "Antigravity.exe"],
            [path.join("Google", "Antigravity"), "Antigravity.exe"],
            [path.join("Google Antigravity"), "Antigravity.exe"],
            [path.join("Programs", "Antigravity"), "Antigravity.exe"],
            [path.join("Programs", "Google Antigravity"), "Antigravity.exe"],
          ],
          projectPath
        ),
        {
          command: "antigravity.exe",
          args: [projectPath],
          cwd: projectPath,
        },
      ],
    })
  );
}

async function openProjectInGitHubDesktop(
  target: ExternalProjectAppTarget,
  projectPath: string
): Promise<OpenProjectInExternalAppResult> {
  return await spawnFirstAvailable(
    target,
    projectPath,
    platformCandidates({
      darwin: [
        {
          command: "github",
          args: [projectPath],
          cwd: projectPath,
        },
        {
          command: "open",
          args: ["-a", "GitHub Desktop", projectPath],
          cwd: projectPath,
        },
      ],
      other: [
        { command: "github", args: [projectPath], cwd: projectPath },
        { command: "github-desktop", args: [projectPath], cwd: projectPath },
      ],
      win32: [
        { command: "github.exe", args: [projectPath], cwd: projectPath },
        ...windowsProgramCandidates(
          [
            ["GitHub Desktop", "GitHubDesktop.exe"],
            [path.join("GitHubDesktop"), "GitHubDesktop.exe"],
            [path.join("Programs", "GitHub Desktop"), "GitHubDesktop.exe"],
          ],
          projectPath
        ),
        {
          command: "GitHubDesktop.exe",
          args: [projectPath],
          cwd: projectPath,
        },
      ],
    })
  );
}

async function openProjectInGitBash(
  target: ExternalProjectAppTarget,
  projectPath: string
): Promise<OpenProjectInExternalAppResult> {
  if (os.platform() !== "win32") {
    throw new Error("Git Bash launcher is only supported on Windows.");
  }

  return await spawnFirstAvailable(target, projectPath, [
    ...windowsProgramCandidates(
      [
        ["Git", "git-bash.exe"],
        [path.join("Programs", "Git"), "git-bash.exe"],
      ],
      projectPath,
      (executable) => ({ command: executable, args: [`--cd=${projectPath}`] })
    ),
    { command: "git-bash.exe", args: [`--cd=${projectPath}`] },
  ]);
}

async function tryOpenExternalUri(
  uri: string,
  target: ExternalProjectAppTarget,
  projectPath: string,
  method: string
): Promise<OpenProjectInExternalAppResult | null> {
  try {
    await shell.openExternal(uri);
    return { method, projectPath, target };
  } catch {
    return null;
  }
}

async function spawnFirstAvailable(
  target: ExternalProjectAppTarget,
  projectPath: string,
  candidates: SpawnCandidate[]
): Promise<OpenProjectInExternalAppResult> {
  const errors: string[] = [];
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate.command)) {
      const exists = await fileExists(candidate.command);
      if (!exists) {
        continue;
      }
    }

    try {
      await spawnDetached(candidate);
      return {
        method: `spawn:${path.basename(candidate.command)}`,
        projectPath,
        target,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const details = errors.length > 0 ? ` ${errors.at(-1)}` : "";
  throw new Error(
    `Could not open ${TARGET_LABELS[target]}. Install it or enable its command line launcher.${details}`
  );
}

function spawnDetached(candidate: SpawnCandidate): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(candidate.command, candidate.args, {
      ...(candidate.cwd ? { cwd: candidate.cwd } : {}),
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });

    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function windowsExecutableCandidates(
  appFolderName: string,
  executableName: string,
  projectPath: string
): SpawnCandidate[] {
  return windowsProgramCandidates(
    [
      [appFolderName, executableName],
      [path.join("Programs", appFolderName), executableName],
    ],
    projectPath
  );
}

function platformCandidates(input: {
  darwin: SpawnCandidate[];
  other: SpawnCandidate[];
  win32: SpawnCandidate[];
}): SpawnCandidate[] {
  switch (os.platform()) {
    case "darwin":
      return input.darwin;
    case "win32":
      return input.win32;
    default:
      return input.other;
  }
}

function windowsProgramCandidates(
  locations: [string, string][],
  projectPath: string,
  toCandidate: (executable: string) => SpawnCandidate = (executable) => ({
    command: executable,
    args: [projectPath],
    cwd: projectPath,
  })
): SpawnCandidate[] {
  const basePaths = [
    process.env.LOCALAPPDATA,
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
  ].filter((value): value is string => Boolean(value));

  const candidates: SpawnCandidate[] = [];
  for (const basePath of basePaths) {
    for (const [folder, executableName] of locations) {
      candidates.push(toCandidate(path.join(basePath, folder, executableName)));
    }
  }
  return candidates;
}

function toUriPath(projectPath: string): string {
  return projectPath.replace(/\\/g, "/");
}

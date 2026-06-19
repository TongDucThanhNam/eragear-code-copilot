import path from "node:path";
import type {
  ProjectRepositoryPort,
  ResolveActiveProjectService,
} from "#runtime/modules/project";
import { NotFoundError, ValidationError } from "#runtime/shared/errors";
import type {
  CreateTerminalInput,
  KillTerminalInput,
  ResizeTerminalInput,
  TerminalEvent,
  TerminalListResult,
  TerminalRecord,
  TerminalSettings,
  TerminalSettingsResult,
  UpdateTerminalSettingsInput,
  WriteTerminalInput,
} from "./contracts/terminal.contract";
import { TerminalSettingsSchema } from "./contracts/terminal.contract";
import type { TerminalRuntimePort } from "./ports/terminal-runtime.port";
import type { TerminalSettingsRepositoryPort } from "./ports/terminal-settings-repository.port";

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  inheritSystemProfile: true,
  shellCommand: "",
  shellArgs: [],
};

const MODULE = "terminal";
const DEFAULT_TERMINAL_COLS = 80;
const DEFAULT_TERMINAL_ROWS = 24;

export interface TerminalServiceDeps {
  runtime: TerminalRuntimePort;
  settingsRepo: TerminalSettingsRepositoryPort;
  projectRepo: ProjectRepositoryPort;
  activeProjectResolver: ResolveActiveProjectService;
}

export class TerminalService {
  private readonly runtime: TerminalRuntimePort;
  private readonly settingsRepo: TerminalSettingsRepositoryPort;
  private readonly projectRepo: ProjectRepositoryPort;
  private readonly activeProjectResolver: ResolveActiveProjectService;

  constructor(deps: TerminalServiceDeps) {
    this.runtime = deps.runtime;
    this.settingsRepo = deps.settingsRepo;
    this.projectRepo = deps.projectRepo;
    this.activeProjectResolver = deps.activeProjectResolver;
  }

  async getSettings(userId: string): Promise<TerminalSettingsResult> {
    return { settings: await this.readSettings(userId) };
  }

  async updateSettings(
    userId: string,
    input?: UpdateTerminalSettingsInput
  ): Promise<TerminalSettingsResult> {
    const update = normalizeSettingsInput(input);
    return {
      settings: await this.settingsRepo.mutate((snapshot) => {
        const next = cloneSettings(
          TerminalSettingsSchema.parse({
            ...DEFAULT_TERMINAL_SETTINGS,
            ...(snapshot.settingsByUserId[userId] ?? {}),
            ...update,
          })
        );
        snapshot.settingsByUserId[userId] = next;
        return next;
      }),
    };
  }

  async list(userId: string): Promise<TerminalListResult> {
    return { terminals: await this.runtime.list(userId) };
  }

  async create(
    userId: string,
    input?: CreateTerminalInput
  ): Promise<TerminalRecord> {
    const project = await this.resolveProject(userId, input?.projectId);
    const cwd = resolveCwdWithinProject(project.path, input?.cwd);
    const settings = await this.readSettings(userId);
    return await this.runtime.create({
      userId,
      projectId: project.id,
      cwd,
      settings,
      cols: input?.cols ?? DEFAULT_TERMINAL_COLS,
      rows: input?.rows ?? DEFAULT_TERMINAL_ROWS,
    });
  }

  async write(
    userId: string,
    input: WriteTerminalInput
  ): Promise<TerminalRecord> {
    return await this.runtime.write(userId, input.terminalId, input.data);
  }

  async resize(
    userId: string,
    input: ResizeTerminalInput
  ): Promise<TerminalRecord> {
    return await this.runtime.resize(
      userId,
      input.terminalId,
      input.cols,
      input.rows
    );
  }

  async kill(
    userId: string,
    input: KillTerminalInput
  ): Promise<TerminalRecord> {
    return await this.runtime.kill(userId, input.terminalId);
  }

  subscribe(
    userId: string,
    terminalId: string,
    listener: (event: TerminalEvent) => void
  ): () => void {
    return this.runtime.subscribe(userId, terminalId, listener);
  }

  private async resolveProject(userId: string, projectId?: string) {
    if (projectId === "") {
      throw new NotFoundError("Active project is required for terminal", {
        module: MODULE,
        op: "create",
      });
    }

    if (projectId === undefined) {
      return await this.activeProjectResolver.execute(userId, {
        module: MODULE,
        op: "create",
      });
    }

    const project = await this.projectRepo.findById(projectId, userId);
    if (!project) {
      throw new NotFoundError("Project not found for terminal", {
        module: MODULE,
        op: "create",
        details: { projectId },
      });
    }
    return project;
  }

  private async readSettings(userId: string): Promise<TerminalSettings> {
    return await this.settingsRepo.read((snapshot) =>
      cloneSettings(
        snapshot.settingsByUserId[userId] ?? DEFAULT_TERMINAL_SETTINGS
      )
    );
  }
}

function normalizeSettingsInput(
  input?: UpdateTerminalSettingsInput
): UpdateTerminalSettingsInput {
  if (!input) {
    return {};
  }
  return {
    ...(input.inheritSystemProfile !== undefined
      ? { inheritSystemProfile: input.inheritSystemProfile }
      : {}),
    ...(input.shellCommand !== undefined
      ? { shellCommand: input.shellCommand.trim() }
      : {}),
    ...(input.shellArgs
      ? { shellArgs: input.shellArgs.map((arg) => arg.trim()).filter(Boolean) }
      : {}),
  };
}

function cloneSettings(settings: TerminalSettings): TerminalSettings {
  return {
    ...settings,
    shellArgs: [...settings.shellArgs],
  };
}

function resolveCwdWithinProject(projectRoot: string, requestedCwd?: string) {
  const root = path.resolve(projectRoot);
  const target = requestedCwd ? path.resolve(root, requestedCwd) : root;
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ValidationError("Terminal cwd must stay inside project root", {
      module: MODULE,
      op: "create",
      details: { projectRoot, requestedCwd },
    });
  }
  return target;
}

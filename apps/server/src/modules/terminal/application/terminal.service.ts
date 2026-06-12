import path from "node:path";
import type { ProjectRepositoryPort } from "@/modules/project";
import { NotFoundError, ValidationError } from "@/shared/errors";
import type {
  CreateTerminalInput,
  KillTerminalInput,
  TerminalEvent,
  TerminalListResult,
  TerminalRecord,
  TerminalSettings,
  TerminalSettingsResult,
  UpdateTerminalSettingsInput,
  WriteTerminalInput,
} from "./contracts/terminal.contract";
import type { TerminalRuntimePort } from "./ports/terminal-runtime.port";
import type { TerminalSettingsRepositoryPort } from "./ports/terminal-settings-repository.port";

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  inheritSystemProfile: true,
  shellCommand: "",
  shellArgs: [],
};

const MODULE = "terminal";

export interface TerminalServiceDeps {
  runtime: TerminalRuntimePort;
  settingsRepo: TerminalSettingsRepositoryPort;
  projectRepo: ProjectRepositoryPort;
}

export class TerminalService {
  private readonly runtime: TerminalRuntimePort;
  private readonly settingsRepo: TerminalSettingsRepositoryPort;
  private readonly projectRepo: ProjectRepositoryPort;

  constructor(deps: TerminalServiceDeps) {
    this.runtime = deps.runtime;
    this.settingsRepo = deps.settingsRepo;
    this.projectRepo = deps.projectRepo;
  }

  async getSettings(userId: string): Promise<TerminalSettingsResult> {
    return { settings: await this.settingsRepo.getSettings(userId) };
  }

  async updateSettings(
    userId: string,
    input?: UpdateTerminalSettingsInput
  ): Promise<TerminalSettingsResult> {
    return {
      settings: await this.settingsRepo.updateSettings(
        userId,
        normalizeSettingsInput(input)
      ),
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
    const settings = await this.settingsRepo.getSettings(userId);
    return await this.runtime.create({
      userId,
      projectId: project.id,
      cwd,
      settings,
    });
  }

  async write(
    userId: string,
    input: WriteTerminalInput
  ): Promise<TerminalRecord> {
    return await this.runtime.write(userId, input.terminalId, input.data);
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
    const resolvedProjectId =
      projectId ?? (await this.projectRepo.getActiveId(userId));
    if (!resolvedProjectId) {
      throw new NotFoundError("Active project is required for terminal", {
        module: MODULE,
        op: "create",
      });
    }
    const project = await this.projectRepo.findById(resolvedProjectId, userId);
    if (!project) {
      throw new NotFoundError("Project not found for terminal", {
        module: MODULE,
        op: "create",
        details: { projectId: resolvedProjectId },
      });
    }
    return project;
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

import type { GitPort, SessionRuntimePort } from "../../../shared/types/ports";

export class CodeContextService {
  constructor(
    private git: GitPort,
    private sessionRuntime: SessionRuntimePort
  ) {}

  async getProjectContext(chatId: string) {
    const session = this.sessionRuntime.get(chatId);
    if (!session) {
      throw new Error("Chat not found");
    }
    const scanRoot = session.cwd || session.projectRoot;
    return await this.git.getProjectContext(scanRoot);
  }

  async getGitDiff(chatId: string) {
    const session = this.sessionRuntime.get(chatId);
    if (!session) {
      throw new Error("Chat not found");
    }
    return await this.git.getDiff(session.projectRoot);
  }

  async getFileContent(chatId: string, path: string) {
    const session = this.sessionRuntime.get(chatId);
    if (!session) {
      throw new Error("Chat not found");
    }
    const content = await this.git.readFileWithinRoot(
      session.projectRoot,
      path
    );
    return { content };
  }
}

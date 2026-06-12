import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  SessionBindingPort,
  SessionForkBinding,
} from "../application/ports/session-binding.port";

const SessionForkBindingSchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().min(1),
    sourceChatId: z.string().min(1),
    forkedChatId: z.string().min(1),
    projectId: z.string().optional(),
    projectRoot: z.string().min(1),
    createdAt: z.number().int().nonnegative(),
    messageCount: z.number().int().nonnegative(),
  })
  .strict();

const SessionBindingFileSchema = z
  .object({
    version: z.literal(1),
    forks: z.array(SessionForkBindingSchema),
  })
  .strict();

type SessionBindingFile = z.infer<typeof SessionBindingFileSchema>;

export class SessionBindingFileRepository implements SessionBindingPort {
  private readonly filePath: () => string;

  constructor(deps: { filePath: () => string }) {
    this.filePath = deps.filePath;
  }

  async recordFork(binding: SessionForkBinding): Promise<SessionForkBinding> {
    const file = await this.readFile();
    file.forks = [
      binding,
      ...file.forks.filter((item) => item.id !== binding.id),
    ].slice(0, 2000);
    await this.writeFile(file);
    return binding;
  }

  async listForks(
    userId: string,
    chatId: string
  ): Promise<SessionForkBinding[]> {
    const file = await this.readFile();
    return file.forks.filter(
      (binding) =>
        binding.userId === userId &&
        (binding.sourceChatId === chatId || binding.forkedChatId === chatId)
    );
  }

  private async readFile(): Promise<SessionBindingFile> {
    try {
      const raw = await readFile(this.filePath(), "utf8");
      return SessionBindingFileSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (isFileNotFound(error)) {
        return {
          version: 1,
          forks: [],
        };
      }
      throw error;
    }
  }

  private async writeFile(file: SessionBindingFile): Promise<void> {
    const target = this.filePath();
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    String((error as { code?: unknown }).code) === "ENOENT"
  );
}

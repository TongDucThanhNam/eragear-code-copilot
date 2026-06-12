import type {
  FileWatcherSessionInput,
  FileWatcherSnapshot,
  FileWatcherStatusInput,
  UnwatchSessionInput,
} from "./contracts/file-watcher.contract";
import type { FileWatcherPort } from "./ports/file-watcher.port";

export class FileWatcherService {
  private readonly watcher: FileWatcherPort;

  constructor(watcher: FileWatcherPort) {
    this.watcher = watcher;
  }

  async watchSession(
    input: FileWatcherSessionInput
  ): Promise<FileWatcherSnapshot> {
    return await this.watcher.watchSession(input);
  }

  async unwatchSession(
    input: UnwatchSessionInput
  ): Promise<FileWatcherSnapshot> {
    return await this.watcher.unwatchSession(input);
  }

  status(input?: FileWatcherStatusInput): FileWatcherSnapshot {
    return this.watcher.getStatus(input);
  }

  dispose(): void {
    this.watcher.dispose();
  }
}

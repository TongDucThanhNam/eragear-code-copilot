import type {
  FileWatcherSessionInput,
  FileWatcherSnapshot,
  FileWatcherStatusInput,
  UnwatchSessionInput,
} from "../contracts/file-watcher.contract";

export interface FileWatcherPort {
  watchSession(input: FileWatcherSessionInput): Promise<FileWatcherSnapshot>;
  unwatchSession(input: UnwatchSessionInput): Promise<FileWatcherSnapshot>;
  getStatus(input?: FileWatcherStatusInput): FileWatcherSnapshot;
  dispose(): void;
}

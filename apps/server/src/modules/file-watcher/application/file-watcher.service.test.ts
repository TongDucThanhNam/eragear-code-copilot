import { describe, expect, test } from "bun:test";
import type {
  FileWatcherSessionInput,
  FileWatcherSnapshot,
  FileWatcherStatusInput,
  UnwatchSessionInput,
} from "./contracts/file-watcher.contract";
import { FileWatcherService } from "./file-watcher.service";
import type { FileWatcherPort } from "./ports/file-watcher.port";

class FileWatcherPortStub implements FileWatcherPort {
  readonly watched: FileWatcherSessionInput[] = [];
  readonly unwatched: UnwatchSessionInput[] = [];
  disposed = false;

  watchSession(input: FileWatcherSessionInput): Promise<FileWatcherSnapshot> {
    this.watched.push(input);
    return Promise.resolve(this.getStatus());
  }

  unwatchSession(input: UnwatchSessionInput): Promise<FileWatcherSnapshot> {
    this.unwatched.push(input);
    return Promise.resolve(this.getStatus());
  }

  getStatus(_input?: FileWatcherStatusInput): FileWatcherSnapshot {
    return {
      roots: [
        {
          projectRoot: "/repo",
          watched: this.watched.length > this.unwatched.length,
          chatIds: this.watched.map((input) => input.chatId),
        },
      ],
      sessionCount: this.watched.length - this.unwatched.length,
    };
  }

  dispose(): void {
    this.disposed = true;
  }
}

describe("FileWatcherService", () => {
  test("delegates watch and unwatch lifecycle to the port", async () => {
    const port = new FileWatcherPortStub();
    const service = new FileWatcherService(port);

    const watched = await service.watchSession({
      userId: "user-1",
      chatId: "chat-1",
      projectRoot: "/repo",
    });
    const unwatched = await service.unwatchSession({ chatId: "chat-1" });

    expect(port.watched).toEqual([
      {
        userId: "user-1",
        chatId: "chat-1",
        projectRoot: "/repo",
      },
    ]);
    expect(port.unwatched).toEqual([{ chatId: "chat-1" }]);
    expect(watched.sessionCount).toBe(1);
    expect(unwatched.sessionCount).toBe(0);
  });

  test("disposes the watcher port", () => {
    const port = new FileWatcherPortStub();
    const service = new FileWatcherService(port);

    service.dispose();

    expect(port.disposed).toBe(true);
  });
});

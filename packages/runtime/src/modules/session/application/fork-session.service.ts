import crypto from "node:crypto";
import { NotFoundError } from "#runtime/shared/errors";
import type { StoredSession } from "../domain/stored-session.types";
import type { SessionBindingPort } from "./ports/session-binding.port";
import type { SessionRepositoryPort } from "./ports/session-repository.port";

const OP = "session.lifecycle.fork";

export interface ForkSessionInput {
  userId: string;
  chatId: string;
  name?: string;
}

export interface ForkSessionResult {
  chatId: string;
  sourceChatId: string;
  name?: string;
  projectId?: string;
  projectRoot: string;
  messageCount: number;
  createdAt: number;
}

export class ForkSessionService {
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly bindings: SessionBindingPort;
  private readonly nowMs: () => number;
  private readonly idFactory: () => string;

  constructor(deps: {
    sessionRepo: SessionRepositoryPort;
    bindings: SessionBindingPort;
    nowMs?: () => number;
    idFactory?: () => string;
  }) {
    this.sessionRepo = deps.sessionRepo;
    this.bindings = deps.bindings;
    this.nowMs = deps.nowMs ?? (() => Date.now());
    this.idFactory = deps.idFactory ?? (() => crypto.randomUUID());
  }

  async execute(input: ForkSessionInput): Promise<ForkSessionResult> {
    const stored = await this.sessionRepo.findById(input.chatId, input.userId);
    if (!stored) {
      throw new NotFoundError("Session not found in store", {
        module: "session",
        op: OP,
        details: { chatId: input.chatId },
      });
    }

    const now = this.nowMs();
    const forkId = this.idFactory();
    const forked: StoredSession = {
      ...stored,
      id: forkId,
      name: input.name?.trim() || defaultForkName(stored),
      sessionId: undefined,
      status: "stopped",
      pinned: false,
      archived: false,
      createdAt: now,
      lastActiveAt: now,
      messages: stored.messages.map((message) => ({ ...message })),
      messageCount: stored.messages.length,
    };

    await this.sessionRepo.create(forked);
    await this.bindings.recordFork({
      id: this.idFactory(),
      userId: input.userId,
      sourceChatId: stored.id,
      forkedChatId: forkId,
      ...(stored.projectId ? { projectId: stored.projectId } : {}),
      projectRoot: stored.projectRoot,
      createdAt: now,
      messageCount: forked.messageCount ?? forked.messages.length,
    });

    return {
      chatId: forkId,
      sourceChatId: stored.id,
      name: forked.name,
      projectId: forked.projectId,
      projectRoot: forked.projectRoot,
      messageCount: forked.messageCount ?? forked.messages.length,
      createdAt: now,
    };
  }
}

function defaultForkName(session: StoredSession): string {
  const baseName = session.name?.trim() || "Forked task";
  return baseName.toLowerCase().includes("fork")
    ? baseName
    : `${baseName} (fork)`;
}

import type { UIMessage } from "@repo/shared";
import type {
  StoredContentBlock,
  StoredMessage,
} from "@/modules/session/domain/stored-session.types";
import type { ChatSession } from "@/shared/types/session.types";
import { finalizeStreamingParts } from "@/shared/utils/ui-message.util";
import type { CreateSessionParams } from "./create-session.types";
import {
  isExternalHistoryImportSupportedAgentCommand,
  resolveExternalHistoryImportMessages,
  type ExternalHistoryResolveInput,
} from "./external-history-resolver";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionMetadataPersistenceService } from "./session-metadata-persistence.service";

const IMPORT_ROLE_ALLOWLIST = new Set<UIMessage["role"]>(["user", "assistant"]);
type TextStoredContentBlock = Extract<StoredContentBlock, { type: "text" }>;
type ExternalHistoryResolver = (
  input: ExternalHistoryResolveInput
) => Promise<UIMessage[] | null>;

export interface PersistSessionBootstrapInput {
  chatId: string;
  projectRoot: string;
  params: CreateSessionParams;
  chatSession: ChatSession;
  agentCommand: string;
  agentArgs: string[];
  agentEnv: Record<string, string>;
}

export class PersistSessionBootstrapService {
  private readonly metadataPersistence: SessionMetadataPersistenceService;
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly externalHistoryResolver: ExternalHistoryResolver;

  constructor(
    metadataPersistence: SessionMetadataPersistenceService,
    sessionRepo: SessionRepositoryPort,
    externalHistoryResolver: ExternalHistoryResolver = (
      input: ExternalHistoryResolveInput
    ) => resolveExternalHistoryImportMessages(input)
  ) {
    this.metadataPersistence = metadataPersistence;
    this.sessionRepo = sessionRepo;
    this.externalHistoryResolver = externalHistoryResolver;
  }

  async execute(input: PersistSessionBootstrapInput): Promise<void> {
    await this.metadataPersistence.persist({
      chatId: input.chatId,
      params: input.params,
      chatSession: input.chatSession,
      agentCommand: input.agentCommand,
      agentArgs: input.agentArgs,
      agentEnv: input.agentEnv,
      projectRoot: input.projectRoot,
    });
    await this.persistImportedExternalHistory(input);
  }

  private async persistImportedExternalHistory(
    input: PersistSessionBootstrapInput
  ): Promise<void> {
    const shouldImport =
      input.params.importExternalHistoryOnLoad === true &&
      input.chatSession.importExternalHistoryOnLoad === true;
    if (!shouldImport) {
      return;
    }
    input.chatSession.importExternalHistoryOnLoad = false;

    const runtimeMessages = collectUiMessages(input.chatSession.uiState.messages);
    let uiMessages = runtimeMessages;
    if (
      shouldAttemptExternalImportFallback({
        agentCommand: input.agentCommand,
        runtimeMessages,
        replayedStoredHistoryFallback:
          input.chatSession.replayedStoredHistoryFallback === true,
      })
    ) {
      const externalMessages = await this.externalHistoryResolver({
        sessionIdToLoad: input.params.sessionIdToLoad,
        agentCommand: input.agentCommand,
        agentEnv: input.agentEnv,
      });
      if (shouldUseExternalImport(runtimeMessages, externalMessages)) {
        const shouldMergeWithRuntime =
          input.chatSession.replayedStoredHistoryFallback === true;
        uiMessages = shouldMergeWithRuntime
          ? mergeRuntimeAndExternalMessages(runtimeMessages, externalMessages)
          : externalMessages;
        input.chatSession.uiState.messages = new Map(
          uiMessages.map((message) => [message.id, message])
        );
      }
    }

    const messageEntries = uiMessages.map((message, index) => ({ index, message }));
    const baseTimestamp = Date.now();
    const storedMessages: StoredMessage[] = [];

    for (const { index, message } of messageEntries) {
      const finalizedMessage = finalizeStreamingParts(message);
      if (finalizedMessage !== message) {
        input.chatSession.uiState.messages.set(
          finalizedMessage.id,
          finalizedMessage
        );
      }
      const stored = mapUiMessageToStoredMessage(
        finalizedMessage,
        baseTimestamp + index
      );
      if (!stored) {
        continue;
      }
      storedMessages.push(stored);
    }

    // Persist canonical bootstrap snapshot atomically so DB ordering/content
    // matches the runtime replay source-of-truth.
    await this.sessionRepo.replaceMessages(
      input.chatId,
      input.params.userId,
      storedMessages
    );
  }
}

function normalizeMessageTimestamp(value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }
  const timestamp = Math.trunc(Number(value));
  if (timestamp <= 0) {
    return undefined;
  }
  return timestamp;
}

function mapUiMessageToStoredMessage(
  message: UIMessage,
  fallbackTimestamp: number
): StoredMessage | null {
  if (!IMPORT_ROLE_ALLOWLIST.has(message.role)) {
    return null;
  }
  const role = message.role === "user" ? "user" : "assistant";
  const contentBlocks = extractTextBlocks(message, "text");
  const reasoningBlocks = extractTextBlocks(message, "reasoning");
  const content = contentBlocks.map((block) => block.text).join("");
  const reasoning = reasoningBlocks.map((block) => block.text).join("");
  const timestamp =
    normalizeMessageTimestamp(message.createdAt) ?? Math.trunc(fallbackTimestamp);

  const stored: StoredMessage = {
    id: message.id,
    role,
    content,
    timestamp,
    parts: message.parts,
  };
  if (contentBlocks.length > 0) {
    stored.contentBlocks = contentBlocks;
  }
  if (reasoningBlocks.length > 0) {
    stored.reasoningBlocks = reasoningBlocks;
  }
  if (reasoning.length > 0) {
    stored.reasoning = reasoning;
  }
  return stored;
}

function extractTextBlocks(
  message: UIMessage,
  partType: "text" | "reasoning"
): TextStoredContentBlock[] {
  const blocks: TextStoredContentBlock[] = [];
  for (const part of message.parts) {
    if (part.type !== partType) {
      continue;
    }
    blocks.push({
      type: "text",
      text: part.text,
    });
  }
  return blocks;
}

function collectUiMessages(
  source: Map<string, UIMessage>
): UIMessage[] {
  return sortMessagesChronologically([...source.values()]);
}

function shouldUseExternalImport(
  runtimeMessages: UIMessage[],
  externalMessages: UIMessage[] | null
): externalMessages is UIMessage[] {
  if (!externalMessages || externalMessages.length === 0) {
    return false;
  }

  const runtimeSummary = summarizeMessageRoles(runtimeMessages);
  const externalSummary = summarizeMessageRoles(externalMessages);
  if (externalSummary.assistant === 0) {
    return false;
  }
  if (runtimeSummary.assistant === 0 && externalSummary.assistant > 0) {
    return true;
  }
  if (
    externalSummary.assistant > runtimeSummary.assistant &&
    externalSummary.total >= runtimeSummary.total
  ) {
    return true;
  }
  if (
    runtimeSummary.assistant * 2 <= runtimeSummary.user &&
    externalSummary.assistant > runtimeSummary.assistant
  ) {
    return true;
  }
  const runtimeLatestTimestamp = findLatestTimestamp(runtimeMessages);
  const externalLatestTimestamp = findLatestTimestamp(externalMessages);
  if (
    externalLatestTimestamp !== undefined &&
    runtimeLatestTimestamp !== undefined &&
    externalLatestTimestamp > runtimeLatestTimestamp &&
    externalSummary.total > runtimeSummary.total &&
    externalSummary.assistant >= runtimeSummary.assistant
  ) {
    return true;
  }
  return false;
}

function shouldAttemptExternalImportFallback(params: {
  agentCommand: string;
  runtimeMessages: UIMessage[];
  replayedStoredHistoryFallback: boolean;
}): boolean {
  if (!isExternalHistoryImportSupportedAgentCommand(params.agentCommand)) {
    return false;
  }
  if (params.replayedStoredHistoryFallback) {
    return true;
  }
  const runtimeSummary = summarizeMessageRoles(params.runtimeMessages);
  return (
    runtimeSummary.assistant === 0 ||
    runtimeSummary.assistant * 2 <= runtimeSummary.user
  );
}

function findLatestTimestamp(messages: UIMessage[]): number | undefined {
  let latest: number | undefined;
  for (const message of messages) {
    const timestamp = normalizeMessageTimestamp(message.createdAt);
    if (timestamp === undefined) {
      continue;
    }
    if (latest === undefined || timestamp > latest) {
      latest = timestamp;
    }
  }
  return latest;
}

function mergeRuntimeAndExternalMessages(
  runtimeMessages: UIMessage[],
  externalMessages: UIMessage[]
): UIMessage[] {
  const merged = [...runtimeMessages];
  const exactKeys = new Set(runtimeMessages.map(buildMessageExactSemanticKey));
  const timestampRoleKeys = new Set(
    runtimeMessages.map(buildMessageTimestampRoleKey)
  );
  const seenIds = new Set(runtimeMessages.map((message) => message.id));

  for (const externalMessage of externalMessages) {
    if (seenIds.has(externalMessage.id)) {
      continue;
    }
    const exactKey = buildMessageExactSemanticKey(externalMessage);
    if (exactKeys.has(exactKey)) {
      continue;
    }
    const timestampRoleKey = buildMessageTimestampRoleKey(externalMessage);
    if (timestampRoleKeys.has(timestampRoleKey)) {
      continue;
    }
    merged.push(externalMessage);
    seenIds.add(externalMessage.id);
    exactKeys.add(exactKey);
    timestampRoleKeys.add(timestampRoleKey);
  }

  return sortMessagesChronologically(merged);
}

function sortMessagesChronologically(messages: UIMessage[]): UIMessage[] {
  return messages
    .map((message, index) => ({ index, message }))
    .sort((left, right) => {
      const leftTimestamp = normalizeMessageTimestamp(left.message.createdAt);
      const rightTimestamp = normalizeMessageTimestamp(right.message.createdAt);
      if (
        leftTimestamp !== undefined &&
        rightTimestamp !== undefined &&
        leftTimestamp !== rightTimestamp
      ) {
        return leftTimestamp - rightTimestamp;
      }
      if (leftTimestamp !== undefined && rightTimestamp === undefined) {
        return -1;
      }
      if (leftTimestamp === undefined && rightTimestamp !== undefined) {
        return 1;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.message);
}

function buildMessageExactSemanticKey(message: UIMessage): string {
  const timestamp = normalizeMessageTimestamp(message.createdAt) ?? 0;
  return `${message.role}|${timestamp}|${normalizeMessageText(message)}`;
}

function buildMessageTimestampRoleKey(message: UIMessage): string {
  const timestamp = normalizeMessageTimestamp(message.createdAt) ?? 0;
  return `${message.role}|${timestamp}`;
}

function normalizeMessageText(message: UIMessage): string {
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim()
    .toLowerCase();
  if (text.length === 0) {
    return "";
  }
  return text.replace(/\s+/g, " ");
}

function summarizeMessageRoles(messages: UIMessage[]): {
  total: number;
  user: number;
  assistant: number;
} {
  let user = 0;
  let assistant = 0;
  for (const message of messages) {
    if (message.role === "user") {
      user += 1;
      continue;
    }
    if (message.role === "assistant") {
      assistant += 1;
    }
  }
  return {
    total: messages.length,
    user,
    assistant,
  };
}

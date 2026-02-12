import { ENV } from "@/config/environment";
import type {
  StoredMessage,
  StoredSession,
} from "@/modules/session/domain/stored-session.types";
import { toSqliteBoolean, toSqliteJson } from "@/platform/storage/sqlite-store";
import { SessionSqliteReadMapper } from "./session-sqlite.mapper.read";
import type {
  MessageInsert,
  SessionInsert,
} from "./session-sqlite.mapper.types";

type SessionMetadataUpdateKey =
  | "name"
  | "sessionId"
  | "projectId"
  | "userId"
  | "projectRoot"
  | "command"
  | "args"
  | "env"
  | "cwd"
  | "loadSessionSupported"
  | "useUnstableResume"
  | "supportsModelSwitching"
  | "agentInfo"
  | "status"
  | "pinned"
  | "archived"
  | "createdAt"
  | "modeId"
  | "modelId"
  | "plan"
  | "commands"
  | "agentCapabilities"
  | "authMethods";

type MetadataWriter = {
  [K in SessionMetadataUpdateKey]: (
    value: StoredSession[K]
  ) => Partial<SessionInsert>;
};

const SESSION_METADATA_WRITERS: MetadataWriter = {
  name: (value) => ({ name: value ?? null }),
  sessionId: (value) => ({ sessionId: value ?? null }),
  projectId: (value) => ({ projectId: value ?? null }),
  userId: (value) => (typeof value === "string" ? { userId: value } : {}),
  projectRoot: (value) => (value ? { projectRoot: value } : {}),
  command: (value) => ({ command: value ?? null }),
  args: (value) => ({ argsJson: toSqliteJson(value) }),
  env: (value) => ({ envJson: toSqliteJson(value) }),
  cwd: (value) => ({ cwd: value ?? null }),
  loadSessionSupported: (value) => ({
    loadSessionSupported: toSqliteBoolean(value),
  }),
  useUnstableResume: (value) => ({ useUnstableResume: toSqliteBoolean(value) }),
  supportsModelSwitching: (value) => ({
    supportsModelSwitching: toSqliteBoolean(value),
  }),
  agentInfo: (value) => ({ agentInfoJson: toSqliteJson(value) }),
  status: (value) => ({
    status: value === "running" ? "running" : "stopped",
  }),
  pinned: (value) => ({ pinned: toSqliteBoolean(value) }),
  archived: (value) => ({ archived: toSqliteBoolean(value) }),
  createdAt: (value) => (typeof value === "number" ? { createdAt: value } : {}),
  modeId: (value) => ({ modeId: value ?? null }),
  modelId: (value) => ({ modelId: value ?? null }),
  plan: (value) => ({ planJson: toSqliteJson(value) }),
  commands: (value) => ({ commandsJson: toSqliteJson(value) }),
  agentCapabilities: (value) => ({
    agentCapabilitiesJson: toSqliteJson(value),
  }),
  authMethods: (value) => ({ authMethodsJson: toSqliteJson(value) }),
};

const SESSION_METADATA_UPDATE_KEYS = Object.keys(
  SESSION_METADATA_WRITERS
) as SessionMetadataUpdateKey[];

export class SessionSqliteMapper extends SessionSqliteReadMapper {
  toSessionInsert(session: StoredSession): SessionInsert {
    return {
      id: session.id,
      userId: session.userId,
      name: session.name ?? null,
      sessionId: session.sessionId ?? null,
      projectId: session.projectId ?? null,
      projectRoot: session.projectRoot,
      command: session.command ?? null,
      argsJson: toSqliteJson(session.args),
      envJson: toSqliteJson(session.env),
      cwd: session.cwd ?? null,
      loadSessionSupported: toSqliteBoolean(session.loadSessionSupported),
      useUnstableResume: toSqliteBoolean(session.useUnstableResume),
      supportsModelSwitching: toSqliteBoolean(session.supportsModelSwitching),
      agentInfoJson: toSqliteJson(session.agentInfo),
      status: session.status === "running" ? "running" : "stopped",
      pinned: toSqliteBoolean(session.pinned),
      archived: toSqliteBoolean(session.archived),
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
      modeId: session.modeId ?? null,
      modelId: session.modelId ?? null,
      planJson: toSqliteJson(session.plan),
      commandsJson: toSqliteJson(session.commands),
      agentCapabilitiesJson: toSqliteJson(session.agentCapabilities),
      authMethodsJson: toSqliteJson(session.authMethods),
      messageCount: 0,
    };
  }

  toMessageInsert(sessionId: string, message: StoredMessage): MessageInsert {
    this.assertMessagePayloadBudget(message);
    return {
      sessionId,
      messageId: message.id,
      role: message.role,
      content: message.content,
      contentBlocksJson: toSqliteJson(message.contentBlocks),
      timestamp: message.timestamp,
      toolCallsJson: toSqliteJson(message.toolCalls),
      reasoning: message.reasoning ?? null,
      reasoningBlocksJson: toSqliteJson(message.reasoningBlocks),
      partsJson: toSqliteJson(message.parts),
      storageTier: "hot",
      retainedPayload: 1,
      compactedAt: null,
    };
  }

  toMetadataUpdateSet(updates: Partial<StoredSession>): Partial<SessionInsert> {
    const setValues: Partial<SessionInsert> = {};
    for (const key of SESSION_METADATA_UPDATE_KEYS) {
      if (!(key in updates)) {
        continue;
      }
      const writer = SESSION_METADATA_WRITERS[key];
      Object.assign(setValues, writer(updates[key] as never));
    }
    return setValues;
  }

  private assertMessagePayloadBudget(message: StoredMessage): void {
    const contentBytes = Buffer.byteLength(message.content ?? "", "utf8");
    if (contentBytes > ENV.messageContentMaxBytes) {
      throw new Error(
        `Message content exceeds max size: ${contentBytes} bytes > ${ENV.messageContentMaxBytes}`
      );
    }

    const partsBytes = Buffer.byteLength(
      JSON.stringify(message.parts ?? []),
      "utf8"
    );
    if (partsBytes > ENV.messagePartsMaxBytes) {
      throw new Error(
        `Message parts payload exceeds max size: ${partsBytes} bytes > ${ENV.messagePartsMaxBytes}`
      );
    }
  }
}

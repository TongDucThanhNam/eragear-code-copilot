import { ENV } from "@/config/environment";
import { toSqliteBoolean, toSqliteJson } from "@/platform/storage/sqlite-store";
import type {
  StoredMessage,
  StoredSession,
} from "@/shared/types/session.types";
import { SessionSqliteReadMapper } from "./session-sqlite.mapper.read";
import type {
  MessageInsert,
  SessionInsert,
} from "./session-sqlite.mapper.types";

export class SessionSqliteMapper extends SessionSqliteReadMapper {
  protected toSessionInsert(session: StoredSession): SessionInsert {
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

  protected toMessageInsert(
    sessionId: string,
    message: StoredMessage
  ): MessageInsert {
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

  protected toSessionSaveUpdateSet(
    session: StoredSession
  ): Partial<SessionInsert> {
    const setValues: Partial<SessionInsert> = {
      userId: session.userId,
      projectRoot: session.projectRoot,
      status: session.status === "running" ? "running" : "stopped",
      lastActiveAt: session.lastActiveAt,
    };

    if (session.name !== undefined) {
      setValues.name = session.name;
    }
    if (session.sessionId !== undefined) {
      setValues.sessionId = session.sessionId;
    }
    if (session.projectId !== undefined) {
      setValues.projectId = session.projectId;
    }
    if (session.command !== undefined) {
      setValues.command = session.command;
    }
    if (session.args !== undefined) {
      setValues.argsJson = toSqliteJson(session.args);
    }
    if (session.env !== undefined) {
      setValues.envJson = toSqliteJson(session.env);
    }
    if (session.cwd !== undefined) {
      setValues.cwd = session.cwd;
    }
    if (session.loadSessionSupported !== undefined) {
      setValues.loadSessionSupported = toSqliteBoolean(
        session.loadSessionSupported
      );
    }
    if (session.useUnstableResume !== undefined) {
      setValues.useUnstableResume = toSqliteBoolean(session.useUnstableResume);
    }
    if (session.supportsModelSwitching !== undefined) {
      setValues.supportsModelSwitching = toSqliteBoolean(
        session.supportsModelSwitching
      );
    }
    if (session.agentInfo !== undefined) {
      setValues.agentInfoJson = toSqliteJson(session.agentInfo);
    }
    if (session.pinned !== undefined) {
      setValues.pinned = toSqliteBoolean(session.pinned);
    }
    if (session.archived !== undefined) {
      setValues.archived = toSqliteBoolean(session.archived);
    }
    if (session.modeId !== undefined) {
      setValues.modeId = session.modeId;
    }
    if (session.modelId !== undefined) {
      setValues.modelId = session.modelId;
    }
    if (session.plan !== undefined) {
      setValues.planJson = toSqliteJson(session.plan);
    }
    if (session.commands !== undefined) {
      setValues.commandsJson = toSqliteJson(session.commands);
    }
    if (session.agentCapabilities !== undefined) {
      setValues.agentCapabilitiesJson = toSqliteJson(session.agentCapabilities);
    }
    if (session.authMethods !== undefined) {
      setValues.authMethodsJson = toSqliteJson(session.authMethods);
    }

    return setValues;
  }

  protected toMetadataUpdateSet(
    updates: Partial<StoredSession>
  ): Partial<SessionInsert> {
    const setValues: Partial<SessionInsert> = {};
    this.applyIdentityMetadataUpdates(setValues, updates);
    this.applyCapabilityMetadataUpdates(setValues, updates);
    this.applyModelMetadataUpdates(setValues, updates);
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

  private applyIdentityMetadataUpdates(
    setValues: Partial<SessionInsert>,
    updates: Partial<StoredSession>
  ): void {
    if ("name" in updates) {
      setValues.name = updates.name ?? null;
    }
    if ("sessionId" in updates) {
      setValues.sessionId = updates.sessionId ?? null;
    }
    if ("projectId" in updates) {
      setValues.projectId = updates.projectId ?? null;
    }
    if ("userId" in updates && typeof updates.userId === "string") {
      setValues.userId = updates.userId;
    }
    if ("projectRoot" in updates && updates.projectRoot) {
      setValues.projectRoot = updates.projectRoot;
    }
    if ("command" in updates) {
      setValues.command = updates.command ?? null;
    }
    if ("args" in updates) {
      setValues.argsJson = toSqliteJson(updates.args);
    }
    if ("env" in updates) {
      setValues.envJson = toSqliteJson(updates.env);
    }
    if ("cwd" in updates) {
      setValues.cwd = updates.cwd ?? null;
    }
  }

  private applyCapabilityMetadataUpdates(
    setValues: Partial<SessionInsert>,
    updates: Partial<StoredSession>
  ): void {
    if ("loadSessionSupported" in updates) {
      setValues.loadSessionSupported = toSqliteBoolean(
        updates.loadSessionSupported
      );
    }
    if ("useUnstableResume" in updates) {
      setValues.useUnstableResume = toSqliteBoolean(updates.useUnstableResume);
    }
    if ("supportsModelSwitching" in updates) {
      setValues.supportsModelSwitching = toSqliteBoolean(
        updates.supportsModelSwitching
      );
    }
    if ("agentInfo" in updates) {
      setValues.agentInfoJson = toSqliteJson(updates.agentInfo);
    }
    if ("status" in updates) {
      setValues.status = updates.status === "running" ? "running" : "stopped";
    }
    if ("pinned" in updates) {
      setValues.pinned = toSqliteBoolean(updates.pinned);
    }
    if ("archived" in updates) {
      setValues.archived = toSqliteBoolean(updates.archived);
    }
  }

  private applyModelMetadataUpdates(
    setValues: Partial<SessionInsert>,
    updates: Partial<StoredSession>
  ): void {
    if ("createdAt" in updates && typeof updates.createdAt === "number") {
      setValues.createdAt = updates.createdAt;
    }
    if ("modeId" in updates) {
      setValues.modeId = updates.modeId ?? null;
    }
    if ("modelId" in updates) {
      setValues.modelId = updates.modelId ?? null;
    }
    if ("plan" in updates) {
      setValues.planJson = toSqliteJson(updates.plan);
    }
    if ("commands" in updates) {
      setValues.commandsJson = toSqliteJson(updates.commands);
    }
    if ("agentCapabilities" in updates) {
      setValues.agentCapabilitiesJson = toSqliteJson(updates.agentCapabilities);
    }
    if ("authMethods" in updates) {
      setValues.authMethodsJson = toSqliteJson(updates.authMethods);
    }
  }
}

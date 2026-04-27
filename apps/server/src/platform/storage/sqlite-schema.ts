import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
});

export const userSettings = sqliteTable(
  "user_settings",
  {
    userId: text("user_id").notNull(),
    key: text("key").notNull(),
    valueJson: text("value_json").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.key] }),
  })
);

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  name: text("name").notNull(),
  path: text("path").notNull().unique(),
  description: text("description"),
  tagsJson: text("tags_json").notNull(),
  favorite: integer("favorite").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  lastOpenedAt: integer("last_opened_at"),
});

export const agents = sqliteTable(
  "agents",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    name: text("name").notNull(),
    type: text("type").notNull(),
    command: text("command").notNull(),
    argsJson: text("args_json"),
    resumeCommandTemplate: text("resume_command_template"),
    envJson: text("env_json"),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    userIdIdx: index("idx_agents_user_id").on(table.userId),
    projectIdIdx: index("idx_agents_project_id").on(table.projectId),
    userIdProjectIdIdx: index("idx_agents_user_project_id").on(
      table.userId,
      table.projectId
    ),
  })
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    agentId: text("agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    name: text("name"),
    sessionId: text("session_id"),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    projectRoot: text("project_root").notNull(),
    command: text("command"),
    argsJson: text("args_json"),
    envJson: text("env_json"),
    cwd: text("cwd"),
    loadSessionSupported: integer("load_session_supported"),
    useUnstableResume: integer("use_unstable_resume"),
    supportsModelSwitching: integer("supports_model_switching"),
    agentInfoJson: text("agent_info_json"),
    status: text("status").notNull(),
    pinned: integer("pinned"),
    archived: integer("archived"),
    createdAt: integer("created_at").notNull(),
    lastActiveAt: integer("last_active_at").notNull(),
    modeId: text("mode_id"),
    modelId: text("model_id"),
    planJson: text("plan_json"),
    commandsJson: text("commands_json"),
    agentCapabilitiesJson: text("agent_capabilities_json"),
    authMethodsJson: text("auth_methods_json"),
    supervisorJson: text("supervisor_json"),
    messageCount: integer("message_count").notNull().default(0),
  },
  (table) => ({
    userIdIdx: index("idx_sessions_user_id").on(table.userId),
    projectIdIdx: index("idx_sessions_project_id").on(table.projectId),
    userIdProjectIdIdx: index("idx_sessions_user_project_id").on(
      table.userId,
      table.projectId
    ),
    lastActiveAtIdx: index("idx_sessions_last_active_at").on(
      table.lastActiveAt
    ),
    lastActiveAtIdIdx: index("idx_sessions_last_active_at_id").on(
      table.lastActiveAt,
      table.id
    ),
    projectIdLastActiveAtIdx: index(
      "idx_sessions_project_id_last_active_at"
    ).on(table.projectId, table.lastActiveAt),
    archivedPinnedLastActiveAtIdx: index(
      "idx_sessions_archived_pinned_last_active_at"
    ).on(table.archived, table.pinned, table.lastActiveAt),
    userIdLastActiveAtIdx: index("idx_sessions_user_last_active_at").on(
      table.userId,
      table.lastActiveAt
    ),
  })
);

export const sessionMessages = sqliteTable(
  "session_messages",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    messageId: text("message_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    contentBlocksJson: text("content_blocks_json"),
    timestamp: integer("timestamp").notNull(),
    toolCallsJson: text("tool_calls_json"),
    reasoning: text("reasoning"),
    reasoningBlocksJson: text("reasoning_blocks_json"),
    partsJson: text("parts_json"),
    storageTier: text("storage_tier").notNull().default("hot"),
    retainedPayload: integer("retained_payload").notNull().default(1),
    compactedAt: integer("compacted_at"),
  },
  (table) => ({
    sessionIdMessageIdUnique: uniqueIndex(
      "uniq_messages_session_id_message_id"
    ).on(table.sessionId, table.messageId),
    sessionIdSeqIdx: index("idx_messages_session_id_seq").on(
      table.sessionId,
      table.seq
    ),
    sessionIdTimestampIdx: index("idx_messages_session_id_timestamp").on(
      table.sessionId,
      table.timestamp
    ),
    sessionIdRetainedPayloadSeqIdx: index(
      "idx_messages_session_id_retained_payload_seq"
    ).on(table.sessionId, table.retainedPayload, table.seq),
  })
);

export const sessionEventOutbox = sqliteTable(
  "session_event_outbox",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id").notNull(),
    userId: text("user_id").notNull(),
    eventJson: text("event_json").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at").notNull(),
    createdAt: integer("created_at").notNull(),
    publishedAt: integer("published_at"),
    lastError: text("last_error"),
  },
  (table) => ({
    statusNextAttemptIdx: index("idx_outbox_status_next_attempt").on(
      table.status,
      table.nextAttemptAt
    ),
    createdAtIdx: index("idx_outbox_created_at").on(table.createdAt),
  })
);

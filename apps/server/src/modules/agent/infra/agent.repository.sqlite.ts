/**
 * Agent Repository (SQLite-backed via Drizzle ORM)
 */

import { randomUUID } from "node:crypto";
import { and, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import {
  getSqliteOrm,
  sqliteSchema,
  withSqliteTransaction,
} from "@/platform/storage/sqlite-db";
import {
  fromSqliteJsonWithSchema,
  SQLITE_SETTING_KEYS,
  toSqliteJson,
} from "@/platform/storage/sqlite-store";
import { enqueueSqliteWrite } from "@/platform/storage/sqlite-write-queue";
import type {
  AgentConfig,
  AgentInput,
  AgentUpdateInput,
} from "@/shared/types/agent.types";
import type { AgentRepositoryPort } from "../application/ports/agent-repository.port";

type AgentRow = typeof sqliteSchema.agents.$inferSelect;
const StringArraySchema = z.array(z.string());
const StringRecordSchema = z.record(z.string(), z.string());
const NullableStringSchema = z.string().nullable();

export class AgentSqliteRepository implements AgentRepositoryPort {
  private parseActiveAgentId(valueJson: string | undefined): string | null {
    return fromSqliteJsonWithSchema(valueJson, null, NullableStringSchema, {
      table: "user_settings",
      column: "value_json",
    });
  }

  private upsertUserSetting(
    db: Awaited<ReturnType<typeof getSqliteOrm>>,
    userId: string,
    key: string,
    valueJson: string
  ) {
    db.insert(sqliteSchema.userSettings)
      .values({
        userId,
        key,
        valueJson,
      })
      .onConflictDoUpdate({
        target: [
          sqliteSchema.userSettings.userId,
          sqliteSchema.userSettings.key,
        ],
        set: { valueJson },
      })
      .run();
  }

  private mapRow(row: AgentRow): AgentConfig {
    if (!row.userId) {
      throw new Error(`Agent ${row.id} is missing owner`);
    }
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      type: row.type as AgentConfig["type"],
      command: row.command,
      args: fromSqliteJsonWithSchema(row.argsJson, [], StringArraySchema, {
        table: "agents",
        column: "args_json",
      }),
      env: fromSqliteJsonWithSchema(row.envJson, {}, StringRecordSchema, {
        table: "agents",
        column: "env_json",
      }),
      projectId: row.projectId ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async findById(id: string, userId: string): Promise<AgentConfig | undefined> {
    const db = await getSqliteOrm();
    const row = db
      .select()
      .from(sqliteSchema.agents)
      .where(
        and(
          eq(sqliteSchema.agents.id, id),
          eq(sqliteSchema.agents.userId, userId)
        )
      )
      .get();
    if (!row) {
      return undefined;
    }
    return this.mapRow(row);
  }

  async findAll(userId: string): Promise<AgentConfig[]> {
    const db = await getSqliteOrm();
    const rows = db
      .select()
      .from(sqliteSchema.agents)
      .where(eq(sqliteSchema.agents.userId, userId))
      .all();
    return rows.map((row) => this.mapRow(row));
  }

  async getActiveId(userId: string): Promise<string | null> {
    const db = await getSqliteOrm();
    const row = db
      .select({ valueJson: sqliteSchema.userSettings.valueJson })
      .from(sqliteSchema.userSettings)
      .where(
        and(
          eq(sqliteSchema.userSettings.userId, userId),
          eq(sqliteSchema.userSettings.key, SQLITE_SETTING_KEYS.activeAgentId)
        )
      )
      .get();
    const activeId = this.parseActiveAgentId(row?.valueJson);
    return activeId;
  }

  async listByProject(
    projectId: string | null | undefined,
    userId: string
  ): Promise<AgentConfig[]> {
    const db = await getSqliteOrm();
    if (projectId === undefined) {
      const rows = db
        .select()
        .from(sqliteSchema.agents)
        .where(eq(sqliteSchema.agents.userId, userId))
        .all();
      return rows.map((row) => this.mapRow(row));
    }
    if (projectId === null) {
      const rows = db
        .select()
        .from(sqliteSchema.agents)
        .where(
          and(
            eq(sqliteSchema.agents.userId, userId),
            isNull(sqliteSchema.agents.projectId)
          )
        )
        .all();
      return rows.map((row) => this.mapRow(row));
    }
    const rows = db
      .select()
      .from(sqliteSchema.agents)
      .where(
        and(
          eq(sqliteSchema.agents.userId, userId),
          or(
            isNull(sqliteSchema.agents.projectId),
            eq(sqliteSchema.agents.projectId, projectId)
          )
        )
      )
      .all();
    return rows.map((row) => this.mapRow(row));
  }

  ensureDefaultsSeeded(
    userId: string,
    defaultAgentInput: AgentInput
  ): Promise<{ activeAgentId: string | null }> {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) {
      return Promise.resolve({ activeAgentId: null });
    }

    return enqueueSqliteWrite("agent.ensure_defaults_seeded", async () => {
      return await withSqliteTransaction(({ orm }) => {
        let agentRows = orm
          .select()
          .from(sqliteSchema.agents)
          .where(eq(sqliteSchema.agents.userId, normalizedUserId))
          .all();

        const activeRow = orm
          .select({ valueJson: sqliteSchema.userSettings.valueJson })
          .from(sqliteSchema.userSettings)
          .where(
            and(
              eq(sqliteSchema.userSettings.userId, normalizedUserId),
              eq(
                sqliteSchema.userSettings.key,
                SQLITE_SETTING_KEYS.activeAgentId
              )
            )
          )
          .get();

        const seedMarker = orm
          .select({ valueJson: sqliteSchema.userSettings.valueJson })
          .from(sqliteSchema.userSettings)
          .where(
            and(
              eq(sqliteSchema.userSettings.userId, normalizedUserId),
              eq(
                sqliteSchema.userSettings.key,
                SQLITE_SETTING_KEYS.agentDefaultsSeededV1
              )
            )
          )
          .get();

        if (agentRows.length === 0) {
          const name = defaultAgentInput.name.trim();
          if (!name) {
            throw new Error("Agent name is required");
          }
          const now = Date.now();
          const created: AgentRow = {
            id: randomUUID(),
            userId: normalizedUserId,
            name,
            type: defaultAgentInput.type,
            command: defaultAgentInput.command,
            argsJson: toSqliteJson(defaultAgentInput.args),
            envJson: toSqliteJson(defaultAgentInput.env),
            projectId: defaultAgentInput.projectId ?? null,
            createdAt: now,
            updatedAt: now,
          };
          orm.insert(sqliteSchema.agents).values(created).run();
          agentRows = [created];
        }

        const currentActiveId = this.parseActiveAgentId(activeRow?.valueJson);
        const hasCurrentActive =
          currentActiveId !== null &&
          agentRows.some((agent) => agent.id === currentActiveId);
        const nextActiveId = hasCurrentActive
          ? currentActiveId
          : (agentRows[0]?.id ?? null);

        if (nextActiveId !== currentActiveId) {
          this.upsertUserSetting(
            orm,
            normalizedUserId,
            SQLITE_SETTING_KEYS.activeAgentId,
            toSqliteJson(nextActiveId) ?? "null"
          );
        }

        if (!seedMarker) {
          this.upsertUserSetting(
            orm,
            normalizedUserId,
            SQLITE_SETTING_KEYS.agentDefaultsSeededV1,
            "true"
          );
        }

        return { activeAgentId: nextActiveId };
      });
    });
  }

  create(input: AgentInput): Promise<AgentConfig> {
    return enqueueSqliteWrite("agent.create", async () => {
      const db = await getSqliteOrm();
      const name = input.name.trim();
      if (!name) {
        throw new Error("Agent name is required");
      }

      const now = Date.now();
      const created: AgentConfig = {
        id: randomUUID(),
        userId: input.userId,
        name,
        type: input.type,
        command: input.command,
        args: input.args,
        env: input.env,
        projectId: input.projectId,
        createdAt: now,
        updatedAt: now,
      };

      db.insert(sqliteSchema.agents)
        .values({
          id: created.id,
          userId: created.userId,
          name: created.name,
          type: created.type,
          command: created.command,
          argsJson: toSqliteJson(created.args),
          envJson: toSqliteJson(created.env),
          projectId: created.projectId ?? null,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
        })
        .run();

      return created;
    });
  }

  update(input: AgentUpdateInput): Promise<AgentConfig> {
    return enqueueSqliteWrite("agent.update", async () => {
      const db = await getSqliteOrm();
      const row = db
        .select()
        .from(sqliteSchema.agents)
        .where(
          and(
            eq(sqliteSchema.agents.id, input.id),
            eq(sqliteSchema.agents.userId, input.userId)
          )
        )
        .get();
      if (!row) {
        throw new Error("Agent not found");
      }

      const current = this.mapRow(row);
      const updated: AgentConfig = {
        ...current,
        name: input.name?.trim() || current.name,
        type: input.type || current.type,
        command: input.command || current.command,
        args: input.args !== undefined ? input.args : current.args,
        env: input.env !== undefined ? input.env : current.env,
        projectId:
          input.projectId !== undefined ? input.projectId : current.projectId,
        updatedAt: Date.now(),
      };

      db.update(sqliteSchema.agents)
        .set({
          name: updated.name,
          type: updated.type,
          command: updated.command,
          argsJson: toSqliteJson(updated.args),
          envJson: toSqliteJson(updated.env),
          projectId: updated.projectId ?? null,
          updatedAt: updated.updatedAt,
        })
        .where(
          and(
            eq(sqliteSchema.agents.id, updated.id),
            eq(sqliteSchema.agents.userId, input.userId)
          )
        )
        .run();

      return updated;
    });
  }

  async delete(id: string, userId: string): Promise<void> {
    await enqueueSqliteWrite("agent.delete", async () => {
      const db = await getSqliteOrm();
      db.delete(sqliteSchema.agents)
        .where(
          and(
            eq(sqliteSchema.agents.id, id),
            eq(sqliteSchema.agents.userId, userId)
          )
        )
        .run();
    });
  }

  async setActive(id: string | null, userId: string): Promise<void> {
    await enqueueSqliteWrite("agent.set_active", async () => {
      const db = await getSqliteOrm();
      if (id) {
        const exists = db
          .select({ id: sqliteSchema.agents.id })
          .from(sqliteSchema.agents)
          .where(
            and(
              eq(sqliteSchema.agents.id, id),
              eq(sqliteSchema.agents.userId, userId)
            )
          )
          .get();
        if (!exists) {
          throw new Error("Agent not found");
        }
      }
      this.upsertUserSetting(
        db,
        userId,
        SQLITE_SETTING_KEYS.activeAgentId,
        toSqliteJson(id) ?? "null"
      );
    });
  }
}

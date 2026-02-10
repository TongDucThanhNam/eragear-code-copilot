/**
 * Agent Repository (SQLite-backed via Drizzle ORM)
 */

import { randomUUID } from "node:crypto";
import { and, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { getSqliteOrm, sqliteSchema } from "@/platform/storage/sqlite-db";
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

const DEFAULT_AGENT_ID = "default-opencode";

type AgentRow = typeof sqliteSchema.agents.$inferSelect;
const StringArraySchema = z.array(z.string());
const StringRecordSchema = z.record(z.string(), z.string());
const NullableStringSchema = z.string().nullable();

export class AgentSqliteRepository implements AgentRepositoryPort {
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

  private ensureDefaultAgent(
    db: Awaited<ReturnType<typeof getSqliteOrm>>,
    userId: string
  ): void {
    const existing = db
      .select({ id: sqliteSchema.agents.id })
      .from(sqliteSchema.agents)
      .where(eq(sqliteSchema.agents.userId, userId))
      .limit(1)
      .get();
    if (existing) {
      return;
    }

    const now = Date.now();
    db.insert(sqliteSchema.agents)
      .values({
        id: `${DEFAULT_AGENT_ID}-${userId}`,
        userId,
        name: "Default (Opencode)",
        type: "opencode",
        command: "opencode",
        argsJson: toSqliteJson(["acp"]),
        envJson: toSqliteJson({}),
        projectId: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(sqliteSchema.userSettings)
      .values({
        userId,
        key: SQLITE_SETTING_KEYS.activeAgentId,
        valueJson: toSqliteJson(`${DEFAULT_AGENT_ID}-${userId}`) ?? "null",
      })
      .onConflictDoUpdate({
        target: [
          sqliteSchema.userSettings.userId,
          sqliteSchema.userSettings.key,
        ],
        set: {
          valueJson: toSqliteJson(`${DEFAULT_AGENT_ID}-${userId}`) ?? "null",
        },
      })
      .run();
  }

  async findById(id: string, userId: string): Promise<AgentConfig | undefined> {
    const db = await getSqliteOrm();
    this.ensureDefaultAgent(db, userId);
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
    this.ensureDefaultAgent(db, userId);
    const rows = db
      .select()
      .from(sqliteSchema.agents)
      .where(eq(sqliteSchema.agents.userId, userId))
      .all();
    return rows.map((row) => this.mapRow(row));
  }

  async getActiveId(userId: string): Promise<string | null> {
    const db = await getSqliteOrm();
    this.ensureDefaultAgent(db, userId);
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
    const activeId = fromSqliteJsonWithSchema(
      row?.valueJson,
      null,
      NullableStringSchema,
      {
        table: "user_settings",
        column: "value_json",
      }
    );
    if (activeId) {
      const activeExists = db
        .select({ id: sqliteSchema.agents.id })
        .from(sqliteSchema.agents)
        .where(
          and(
            eq(sqliteSchema.agents.id, activeId),
            eq(sqliteSchema.agents.userId, userId)
          )
        )
        .get();
      if (activeExists) {
        return activeId;
      }
    }

    const fallback = db
      .select({ id: sqliteSchema.agents.id })
      .from(sqliteSchema.agents)
      .where(eq(sqliteSchema.agents.userId, userId))
      .limit(1)
      .get();
    const fallbackId = fallback?.id ?? null;

    await enqueueSqliteWrite("agent.repair_active_id", async () => {
      const writeDb = await getSqliteOrm();
      writeDb
        .insert(sqliteSchema.userSettings)
        .values({
          userId,
          key: SQLITE_SETTING_KEYS.activeAgentId,
          valueJson: toSqliteJson(fallbackId) ?? "null",
        })
        .onConflictDoUpdate({
          target: [
            sqliteSchema.userSettings.userId,
            sqliteSchema.userSettings.key,
          ],
          set: {
            valueJson: toSqliteJson(fallbackId) ?? "null",
          },
        })
        .run();
    });

    return fallbackId;
  }

  async listByProject(
    projectId: string | null | undefined,
    userId: string
  ): Promise<AgentConfig[]> {
    const db = await getSqliteOrm();
    this.ensureDefaultAgent(db, userId);
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

  create(input: AgentInput): Promise<AgentConfig> {
    return enqueueSqliteWrite("agent.create", async () => {
      const db = await getSqliteOrm();
      this.ensureDefaultAgent(db, input.userId);
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

      const activeRow = db
        .select({ valueJson: sqliteSchema.userSettings.valueJson })
        .from(sqliteSchema.userSettings)
        .where(
          and(
            eq(sqliteSchema.userSettings.userId, input.userId),
            eq(sqliteSchema.userSettings.key, SQLITE_SETTING_KEYS.activeAgentId)
          )
        )
        .get();
      const currentActive = fromSqliteJsonWithSchema(
        activeRow?.valueJson,
        null,
        NullableStringSchema,
        {
          table: "user_settings",
          column: "value_json",
        }
      );
      if (!currentActive) {
        db.insert(sqliteSchema.userSettings)
          .values({
            userId: input.userId,
            key: SQLITE_SETTING_KEYS.activeAgentId,
            valueJson: toSqliteJson(created.id) ?? "null",
          })
          .onConflictDoUpdate({
            target: [
              sqliteSchema.userSettings.userId,
              sqliteSchema.userSettings.key,
            ],
            set: {
              valueJson: toSqliteJson(created.id) ?? "null",
            },
          })
          .run();
      }

      return created;
    });
  }

  update(input: AgentUpdateInput): Promise<AgentConfig> {
    return enqueueSqliteWrite("agent.update", async () => {
      const db = await getSqliteOrm();
      this.ensureDefaultAgent(db, input.userId);
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
      db.transaction((tx) => {
        tx.delete(sqliteSchema.agents)
          .where(
            and(
              eq(sqliteSchema.agents.id, id),
              eq(sqliteSchema.agents.userId, userId)
            )
          )
          .run();

        const activeRow = tx
          .select({ valueJson: sqliteSchema.userSettings.valueJson })
          .from(sqliteSchema.userSettings)
          .where(
            and(
              eq(sqliteSchema.userSettings.userId, userId),
              eq(sqliteSchema.userSettings.key, SQLITE_SETTING_KEYS.activeAgentId)
            )
          )
          .get();
        const activeAgentId = fromSqliteJsonWithSchema(
          activeRow?.valueJson,
          null,
          NullableStringSchema,
          {
            table: "user_settings",
            column: "value_json",
          }
        );
        if (activeAgentId !== id) {
          return;
        }

        const nextActive = tx
          .select({ id: sqliteSchema.agents.id })
          .from(sqliteSchema.agents)
          .where(eq(sqliteSchema.agents.userId, userId))
          .limit(1)
          .get();
        tx.insert(sqliteSchema.userSettings)
          .values({
            userId,
            key: SQLITE_SETTING_KEYS.activeAgentId,
            valueJson: toSqliteJson(nextActive?.id ?? null) ?? "null",
          })
          .onConflictDoUpdate({
            target: [
              sqliteSchema.userSettings.userId,
              sqliteSchema.userSettings.key,
            ],
            set: {
              valueJson: toSqliteJson(nextActive?.id ?? null) ?? "null",
            },
          })
          .run();
      });
    });
  }

  async setActive(id: string | null, userId: string): Promise<void> {
    await enqueueSqliteWrite("agent.set_active", async () => {
      const db = await getSqliteOrm();
      this.ensureDefaultAgent(db, userId);
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
      db.insert(sqliteSchema.userSettings)
        .values({
          userId,
          key: SQLITE_SETTING_KEYS.activeAgentId,
          valueJson: toSqliteJson(id) ?? "null",
        })
        .onConflictDoUpdate({
          target: [
            sqliteSchema.userSettings.userId,
            sqliteSchema.userSettings.key,
          ],
          set: {
            valueJson: toSqliteJson(id) ?? "null",
          },
        })
        .run();
    });
  }
}

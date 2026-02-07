/**
 * Agent Repository (SQLite-backed via Drizzle ORM)
 */

import { randomUUID } from "node:crypto";
import { eq, isNull, or } from "drizzle-orm";
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
    return {
      id: row.id,
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
    db: Awaited<ReturnType<typeof getSqliteOrm>>
  ): void {
    const existing = db
      .select({ id: sqliteSchema.agents.id })
      .from(sqliteSchema.agents)
      .limit(1)
      .get();
    if (existing) {
      return;
    }

    const now = Date.now();
    db.insert(sqliteSchema.agents)
      .values({
        id: DEFAULT_AGENT_ID,
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
    db.insert(sqliteSchema.appSettings)
      .values({
        key: SQLITE_SETTING_KEYS.activeAgentId,
        valueJson: toSqliteJson(DEFAULT_AGENT_ID) ?? "null",
      })
      .onConflictDoUpdate({
        target: sqliteSchema.appSettings.key,
        set: {
          valueJson: toSqliteJson(DEFAULT_AGENT_ID) ?? "null",
        },
      })
      .run();
  }

  async findById(id: string): Promise<AgentConfig | undefined> {
    const db = await getSqliteOrm();
    this.ensureDefaultAgent(db);
    const row = db
      .select()
      .from(sqliteSchema.agents)
      .where(eq(sqliteSchema.agents.id, id))
      .get();
    if (!row) {
      return undefined;
    }
    return this.mapRow(row);
  }

  async findAll(): Promise<AgentConfig[]> {
    const db = await getSqliteOrm();
    this.ensureDefaultAgent(db);
    const rows = db.select().from(sqliteSchema.agents).all();
    return rows.map((row) => this.mapRow(row));
  }

  async getActiveId(): Promise<string | null> {
    const db = await getSqliteOrm();
    this.ensureDefaultAgent(db);
    const row = db
      .select({ valueJson: sqliteSchema.appSettings.valueJson })
      .from(sqliteSchema.appSettings)
      .where(
        eq(sqliteSchema.appSettings.key, SQLITE_SETTING_KEYS.activeAgentId)
      )
      .get();
    const activeId = fromSqliteJsonWithSchema(
      row?.valueJson,
      null,
      NullableStringSchema,
      {
        table: "app_settings",
        column: "value_json",
      }
    );
    if (activeId) {
      const activeExists = db
        .select({ id: sqliteSchema.agents.id })
        .from(sqliteSchema.agents)
        .where(eq(sqliteSchema.agents.id, activeId))
        .get();
      if (activeExists) {
        return activeId;
      }
    }

    const fallback = db
      .select({ id: sqliteSchema.agents.id })
      .from(sqliteSchema.agents)
      .limit(1)
      .get();
    const fallbackId = fallback?.id ?? null;

    await enqueueSqliteWrite("agent.repair_active_id", async () => {
      const writeDb = await getSqliteOrm();
      writeDb
        .insert(sqliteSchema.appSettings)
        .values({
          key: SQLITE_SETTING_KEYS.activeAgentId,
          valueJson: toSqliteJson(fallbackId) ?? "null",
        })
        .onConflictDoUpdate({
          target: sqliteSchema.appSettings.key,
          set: {
            valueJson: toSqliteJson(fallbackId) ?? "null",
          },
        })
        .run();
    });

    return fallbackId;
  }

  async listByProject(projectId?: string | null): Promise<AgentConfig[]> {
    const db = await getSqliteOrm();
    this.ensureDefaultAgent(db);
    if (projectId === undefined) {
      const rows = db.select().from(sqliteSchema.agents).all();
      return rows.map((row) => this.mapRow(row));
    }
    if (projectId === null) {
      const rows = db
        .select()
        .from(sqliteSchema.agents)
        .where(isNull(sqliteSchema.agents.projectId))
        .all();
      return rows.map((row) => this.mapRow(row));
    }
    const rows = db
      .select()
      .from(sqliteSchema.agents)
      .where(
        or(
          isNull(sqliteSchema.agents.projectId),
          eq(sqliteSchema.agents.projectId, projectId)
        )
      )
      .all();
    return rows.map((row) => this.mapRow(row));
  }

  create(input: AgentInput): Promise<AgentConfig> {
    return enqueueSqliteWrite("agent.create", async () => {
      const db = await getSqliteOrm();
      this.ensureDefaultAgent(db);
      const name = input.name.trim();
      if (!name) {
        throw new Error("Agent name is required");
      }

      const now = Date.now();
      const created: AgentConfig = {
        id: randomUUID(),
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
        .select({ valueJson: sqliteSchema.appSettings.valueJson })
        .from(sqliteSchema.appSettings)
        .where(
          eq(sqliteSchema.appSettings.key, SQLITE_SETTING_KEYS.activeAgentId)
        )
        .get();
      const currentActive = fromSqliteJsonWithSchema(
        activeRow?.valueJson,
        null,
        NullableStringSchema,
        {
          table: "app_settings",
          column: "value_json",
        }
      );
      if (!currentActive) {
        db.insert(sqliteSchema.appSettings)
          .values({
            key: SQLITE_SETTING_KEYS.activeAgentId,
            valueJson: toSqliteJson(created.id) ?? "null",
          })
          .onConflictDoUpdate({
            target: sqliteSchema.appSettings.key,
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
      this.ensureDefaultAgent(db);
      const row = db
        .select()
        .from(sqliteSchema.agents)
        .where(eq(sqliteSchema.agents.id, input.id))
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
        .where(eq(sqliteSchema.agents.id, updated.id))
        .run();

      return updated;
    });
  }

  async delete(id: string): Promise<void> {
    await enqueueSqliteWrite("agent.delete", async () => {
      const db = await getSqliteOrm();
      db.transaction((tx) => {
        tx.delete(sqliteSchema.agents)
          .where(eq(sqliteSchema.agents.id, id))
          .run();

        const activeRow = tx
          .select({ valueJson: sqliteSchema.appSettings.valueJson })
          .from(sqliteSchema.appSettings)
          .where(
            eq(sqliteSchema.appSettings.key, SQLITE_SETTING_KEYS.activeAgentId)
          )
          .get();
        const activeAgentId = fromSqliteJsonWithSchema(
          activeRow?.valueJson,
          null,
          NullableStringSchema,
          {
            table: "app_settings",
            column: "value_json",
          }
        );
        if (activeAgentId !== id) {
          return;
        }

        const nextActive = tx
          .select({ id: sqliteSchema.agents.id })
          .from(sqliteSchema.agents)
          .limit(1)
          .get();
        tx.insert(sqliteSchema.appSettings)
          .values({
            key: SQLITE_SETTING_KEYS.activeAgentId,
            valueJson: toSqliteJson(nextActive?.id ?? null) ?? "null",
          })
          .onConflictDoUpdate({
            target: sqliteSchema.appSettings.key,
            set: {
              valueJson: toSqliteJson(nextActive?.id ?? null) ?? "null",
            },
          })
          .run();
      });
    });
  }

  async setActive(id: string | null): Promise<void> {
    await enqueueSqliteWrite("agent.set_active", async () => {
      const db = await getSqliteOrm();
      this.ensureDefaultAgent(db);
      if (id) {
        const exists = db
          .select({ id: sqliteSchema.agents.id })
          .from(sqliteSchema.agents)
          .where(eq(sqliteSchema.agents.id, id))
          .get();
        if (!exists) {
          throw new Error("Agent not found");
        }
      }
      db.insert(sqliteSchema.appSettings)
        .values({
          key: SQLITE_SETTING_KEYS.activeAgentId,
          valueJson: toSqliteJson(id) ?? "null",
        })
        .onConflictDoUpdate({
          target: sqliteSchema.appSettings.key,
          set: {
            valueJson: toSqliteJson(id) ?? "null",
          },
        })
        .run();
    });
  }
}

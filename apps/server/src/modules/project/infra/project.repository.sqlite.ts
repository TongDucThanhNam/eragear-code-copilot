/**
 * Project Repository (SQLite-backed via Drizzle ORM)
 */

import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getSqliteOrm, sqliteSchema } from "@/platform/storage/sqlite-db";
import {
  fromSqliteJsonWithSchema,
  SQLITE_SETTING_KEYS,
  toSqliteJson,
} from "@/platform/storage/sqlite-store";
import { enqueueSqliteWrite } from "@/platform/storage/sqlite-write-queue";
import type {
  Project,
  ProjectInput,
  ProjectUpdateInput,
} from "@/shared/types/project.types";
import { resolveProjectPath } from "@/shared/utils/project-roots.util";
import type { ProjectRepositoryPort } from "../application/ports/project-repository.port";

type ProjectRow = typeof sqliteSchema.projects.$inferSelect;
const ProjectTagsSchema = z.array(z.string());
const NullableStringSchema = z.string().nullable();

export class ProjectSqliteRepository implements ProjectRepositoryPort {
  private allowedRoots: string[];

  constructor(allowedRoots: string[]) {
    this.allowedRoots = allowedRoots;
  }

  setAllowedRoots(roots: string[]): Promise<void> {
    this.allowedRoots = roots;
    return Promise.resolve();
  }

  private mapRow(row: ProjectRow): Project {
    if (!row.userId) {
      throw new Error(`Project ${row.id} is missing owner`);
    }
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      path: row.path,
      description: row.description ?? null,
      tags: fromSqliteJsonWithSchema(row.tagsJson, [], ProjectTagsSchema, {
        table: "projects",
        column: "tags_json",
      }),
      favorite: Number(row.favorite) === 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastOpenedAt: row.lastOpenedAt ?? null,
    };
  }

  async findById(id: string, userId: string): Promise<Project | undefined> {
    const db = await getSqliteOrm();
    const row = db
      .select()
      .from(sqliteSchema.projects)
      .where(
        and(
          eq(sqliteSchema.projects.id, id),
          eq(sqliteSchema.projects.userId, userId)
        )
      )
      .get();
    if (!row) {
      return undefined;
    }
    return this.mapRow(row);
  }

  async findAll(userId: string): Promise<Project[]> {
    const db = await getSqliteOrm();
    const rows = db
      .select()
      .from(sqliteSchema.projects)
      .where(eq(sqliteSchema.projects.userId, userId))
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
          eq(sqliteSchema.userSettings.key, SQLITE_SETTING_KEYS.activeProjectId)
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
    if (!activeId) {
      return null;
    }

    const activeProject = db
      .select({ id: sqliteSchema.projects.id })
      .from(sqliteSchema.projects)
      .where(
        and(
          eq(sqliteSchema.projects.id, activeId),
          eq(sqliteSchema.projects.userId, userId)
        )
      )
      .get();
    return activeProject ? activeId : null;
  }

  create(input: ProjectInput): Promise<Project> {
    return enqueueSqliteWrite("project.create", async () => {
      const db = await getSqliteOrm();
      const resolvedPath = resolveProjectPath(input.path, this.allowedRoots);
      const name = input.name.trim();

      if (!name) {
        throw new Error("Project name is required");
      }

      const existing = db
        .select({ id: sqliteSchema.projects.id })
        .from(sqliteSchema.projects)
        .where(eq(sqliteSchema.projects.path, resolvedPath))
        .get();
      if (existing) {
        throw new Error(`Project path already exists: ${resolvedPath}`);
      }

      const now = Date.now();
      const created: Project = {
        id: randomUUID(),
        userId: input.userId,
        name,
        path: resolvedPath,
        description: input.description ?? null,
        tags: this.normalizeTags(input.tags),
        favorite: Boolean(input.favorite),
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: null,
      };

      db.insert(sqliteSchema.projects)
        .values({
          id: created.id,
          userId: created.userId,
          name: created.name,
          path: created.path,
          description: created.description,
          tagsJson: toSqliteJson(created.tags) ?? "[]",
          favorite: created.favorite ? 1 : 0,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
          lastOpenedAt: created.lastOpenedAt,
        })
        .run();

      return created;
    });
  }

  update(input: ProjectUpdateInput): Promise<Project> {
    return enqueueSqliteWrite("project.update", async () => {
      const db = await getSqliteOrm();
      const currentRow = db
        .select()
        .from(sqliteSchema.projects)
        .where(
          and(
            eq(sqliteSchema.projects.id, input.id),
            eq(sqliteSchema.projects.userId, input.userId)
          )
        )
        .get();
      if (!currentRow) {
        throw new Error("Project not found");
      }
      const current = this.mapRow(currentRow);
      let nextPath = current.path;

      if (input.path && input.path !== current.path) {
        nextPath = resolveProjectPath(input.path, this.allowedRoots);
        const exists = db
          .select({ id: sqliteSchema.projects.id })
          .from(sqliteSchema.projects)
          .where(
            and(
              eq(sqliteSchema.projects.path, nextPath),
              ne(sqliteSchema.projects.id, input.id)
            )
          )
          .get();
        if (exists) {
          throw new Error(`Project path already exists: ${nextPath}`);
        }
      }

      const updated: Project = {
        ...current,
        name: input.name ? input.name.trim() || current.name : current.name,
        path: nextPath,
        description:
          input.description === undefined
            ? current.description
            : input.description,
        tags: input.tags ? this.normalizeTags(input.tags) : current.tags,
        favorite:
          input.favorite === undefined ? current.favorite : input.favorite,
        updatedAt: Date.now(),
      };

      db.update(sqliteSchema.projects)
        .set({
          name: updated.name,
          path: updated.path,
          description: updated.description,
          tagsJson: toSqliteJson(updated.tags) ?? "[]",
          favorite: updated.favorite ? 1 : 0,
          updatedAt: updated.updatedAt,
        })
        .where(
          and(
            eq(sqliteSchema.projects.id, input.id),
            eq(sqliteSchema.projects.userId, input.userId)
          )
        )
        .run();

      return updated;
    });
  }

  async delete(id: string, userId: string): Promise<void> {
    await enqueueSqliteWrite("project.delete", async () => {
      const db = await getSqliteOrm();
      db.transaction((tx) => {
        const project = tx
          .select({
            id: sqliteSchema.projects.id,
          })
          .from(sqliteSchema.projects)
          .where(
            and(
              eq(sqliteSchema.projects.id, id),
              eq(sqliteSchema.projects.userId, userId)
            )
          )
          .get();
        if (!project) {
          return;
        }

        tx.delete(sqliteSchema.projects)
          .where(
            and(
              eq(sqliteSchema.projects.id, id),
              eq(sqliteSchema.projects.userId, userId)
            )
          )
          .run();

        const activeProjectRow = tx
          .select({ valueJson: sqliteSchema.userSettings.valueJson })
          .from(sqliteSchema.userSettings)
          .where(
            and(
              eq(sqliteSchema.userSettings.userId, userId),
              eq(
                sqliteSchema.userSettings.key,
                SQLITE_SETTING_KEYS.activeProjectId
              )
            )
          )
          .get();
        const activeProjectId = fromSqliteJsonWithSchema(
          activeProjectRow?.valueJson,
          null,
          NullableStringSchema,
          {
            table: "user_settings",
            column: "value_json",
          }
        );
        if (activeProjectId === id) {
          tx.insert(sqliteSchema.userSettings)
            .values({
              userId,
              key: SQLITE_SETTING_KEYS.activeProjectId,
              valueJson: "null",
            })
            .onConflictDoUpdate({
              target: [
                sqliteSchema.userSettings.userId,
                sqliteSchema.userSettings.key,
              ],
              set: {
                valueJson: "null",
              },
            })
            .run();
        }
      });
    });
  }

  async setActive(id: string | null, userId: string): Promise<void> {
    await enqueueSqliteWrite("project.set_active", async () => {
      const db = await getSqliteOrm();
      db.transaction((tx) => {
        if (id) {
          const project = tx
            .select({ id: sqliteSchema.projects.id })
            .from(sqliteSchema.projects)
            .where(
              and(
                eq(sqliteSchema.projects.id, id),
                eq(sqliteSchema.projects.userId, userId)
              )
            )
            .get();
          if (!project) {
            throw new Error("Project not found");
          }

          tx.update(sqliteSchema.projects)
            .set({
              lastOpenedAt: Date.now(),
              updatedAt: Date.now(),
            })
            .where(
              and(
                eq(sqliteSchema.projects.id, id),
                eq(sqliteSchema.projects.userId, userId)
              )
            )
            .run();
        }
        tx.insert(sqliteSchema.userSettings)
          .values({
            userId,
            key: SQLITE_SETTING_KEYS.activeProjectId,
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
    });
  }

  private normalizeTags(tags?: string[]): string[] {
    if (!tags) {
      return [];
    }
    const trimmed = tags.map((tag) => tag.trim()).filter(Boolean);
    return Array.from(new Set(trimmed));
  }
}

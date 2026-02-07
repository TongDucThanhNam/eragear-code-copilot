/**
 * Settings Repository (SQLite-backed via Drizzle ORM)
 */

import { eq } from "drizzle-orm";
import { z } from "zod";
import { getSqliteOrm, sqliteSchema } from "@/infra/storage/sqlite-db";
import {
  fromSqliteJson,
  SQLITE_SETTING_KEYS,
  toSqliteJson,
} from "@/infra/storage/sqlite-store";
import type { McpServerConfig, Settings } from "@/shared/types/settings.types";
import type { SettingsRepositoryPort } from "../application/ports/settings-repository.port";

const UiSettingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
  accentColor: z.string().min(4),
  density: z.enum(["comfortable", "compact"]),
  fontScale: z.number().min(0.8).max(1.3),
});

const McpEnvSchema = z.object({
  name: z.string(),
  value: z.string(),
});

const McpHeaderSchema = z.object({
  name: z.string(),
  value: z.string(),
});

const McpStdioSchema = z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()),
  env: z.array(McpEnvSchema).optional(),
});

const McpHttpSchema = z.object({
  type: z.literal("http"),
  name: z.string(),
  url: z.string(),
  headers: z.array(McpHeaderSchema),
});

const McpSseSchema = z.object({
  type: z.literal("sse"),
  name: z.string(),
  url: z.string(),
  headers: z.array(McpHeaderSchema),
});

const McpServerSchema = z.union([McpStdioSchema, McpHttpSchema, McpSseSchema]);

const SettingsSchema = z.object({
  ui: UiSettingsSchema,
  projectRoots: z.array(z.string()).min(1).default([process.cwd()]),
  mcpServers: z.array(McpServerSchema).optional(),
});

const DEFAULT_SETTINGS: Settings = {
  ui: {
    theme: "system",
    accentColor: "#2563eb",
    density: "comfortable",
    fontScale: 1,
  },
  projectRoots: [process.cwd()],
  mcpServers: [],
};

export class SettingsSqliteRepository implements SettingsRepositoryPort {
  private getRawSetting<T>(
    db: Awaited<ReturnType<typeof getSqliteOrm>>,
    key: string,
    fallback: T
  ): T {
    const row = db
      .select({ valueJson: sqliteSchema.appSettings.valueJson })
      .from(sqliteSchema.appSettings)
      .where(eq(sqliteSchema.appSettings.key, key))
      .get();
    return fromSqliteJson(row?.valueJson, fallback);
  }

  private upsertSetting(
    db: Awaited<ReturnType<typeof getSqliteOrm>>,
    key: string,
    value: unknown
  ): void {
    db.insert(sqliteSchema.appSettings)
      .values({
        key,
        valueJson: toSqliteJson(value) ?? "null",
      })
      .onConflictDoUpdate({
        target: sqliteSchema.appSettings.key,
        set: {
          valueJson: toSqliteJson(value) ?? "null",
        },
      })
      .run();
  }

  private saveSettings(
    db: Awaited<ReturnType<typeof getSqliteOrm>>,
    settings: Settings
  ): void {
    this.upsertSetting(db, SQLITE_SETTING_KEYS.uiSettings, settings.ui);
    this.upsertSetting(
      db,
      SQLITE_SETTING_KEYS.projectRoots,
      settings.projectRoots
    );
    this.upsertSetting(
      db,
      SQLITE_SETTING_KEYS.mcpServers,
      settings.mcpServers ?? []
    );
  }

  async get(): Promise<Settings> {
    const db = await getSqliteOrm();
    const raw = {
      ui: this.getRawSetting(
        db,
        SQLITE_SETTING_KEYS.uiSettings,
        DEFAULT_SETTINGS.ui
      ),
      projectRoots: this.getRawSetting(
        db,
        SQLITE_SETTING_KEYS.projectRoots,
        DEFAULT_SETTINGS.projectRoots
      ),
      mcpServers: this.getRawSetting(
        db,
        SQLITE_SETTING_KEYS.mcpServers,
        DEFAULT_SETTINGS.mcpServers ?? []
      ),
    };

    try {
      const parsed = SettingsSchema.parse(raw);
      const normalized: Settings = {
        ui: parsed.ui,
        projectRoots: parsed.projectRoots,
        mcpServers: parsed.mcpServers ?? [],
      };
      this.saveSettings(db, normalized);
      return normalized;
    } catch {
      const partial = raw as Partial<Settings>;
      const uiResult = UiSettingsSchema.safeParse(partial.ui);
      const projectRoots = Array.isArray(partial.projectRoots)
        ? partial.projectRoots
        : DEFAULT_SETTINGS.projectRoots;
      const mcpServersResult = Array.isArray(partial.mcpServers)
        ? z.array(McpServerSchema).safeParse(partial.mcpServers)
        : { success: false as const, data: [] as McpServerConfig[] };

      const normalized: Settings = {
        ui: uiResult.success ? uiResult.data : DEFAULT_SETTINGS.ui,
        projectRoots:
          projectRoots.length > 0
            ? projectRoots
            : DEFAULT_SETTINGS.projectRoots,
        mcpServers: mcpServersResult.success
          ? mcpServersResult.data
          : (DEFAULT_SETTINGS.mcpServers ?? []),
      };
      this.saveSettings(db, normalized);
      return normalized;
    }
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    const db = await getSqliteOrm();
    const current = await this.get();
    const next: Settings = {
      ...current,
      ...patch,
      ui: { ...current.ui, ...(patch.ui ?? {}) },
      mcpServers:
        patch.mcpServers !== undefined ? patch.mcpServers : current.mcpServers,
      projectRoots:
        patch.projectRoots !== undefined
          ? patch.projectRoots
          : current.projectRoots,
    };
    this.saveSettings(db, next);
    return next;
  }
}

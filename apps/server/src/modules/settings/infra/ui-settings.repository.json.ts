/**
 * UI Settings JSON Repository
 *
 * JSON-backed repository implementation for settings persistence.
 * Provides Zod-validated read/write operations for UI settings,
 * project roots, and MCP server configurations.
 *
 * @module modules/settings/infra/ui-settings.repository.json
 */

import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../../../infra/storage/json-store";
import type {
  McpServerConfig,
  Settings,
} from "../../../shared/types/settings.types";
import type { SettingsRepositoryPort } from "../application/ports/settings-repository.port";

// ============================================================================
// Zod Schemas
// ============================================================================

/** Schema for UI appearance settings */
const UiSettingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
  accentColor: z.string().min(4),
  density: z.enum(["comfortable", "compact"]),
  fontScale: z.number().min(0.8).max(1.3),
});

/** Schema for MCP server environment variables */
const McpEnvSchema = z.object({
  name: z.string(),
  value: z.string(),
});

/** Schema for MCP server HTTP headers */
const McpHeaderSchema = z.object({
  name: z.string(),
  value: z.string(),
});

/** Schema for stdio-based MCP server configuration */
const McpStdioSchema = z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()),
  env: z.array(McpEnvSchema).optional(),
});

/** Schema for HTTP-based MCP server configuration */
const McpHttpSchema = z.object({
  type: z.literal("http"),
  name: z.string(),
  url: z.string(),
  headers: z.array(McpHeaderSchema),
});

/** Schema for SSE-based MCP server configuration */
const McpSseSchema = z.object({
  type: z.literal("sse"),
  name: z.string(),
  url: z.string(),
  headers: z.array(McpHeaderSchema),
});

/** Union schema for all MCP server types */
const McpServerSchema = z.union([McpStdioSchema, McpHttpSchema, McpSseSchema]);

/** Complete settings schema */
const SettingsSchema = z.object({
  ui: UiSettingsSchema,
  projectRoots: z.array(z.string()).min(1).default([process.cwd()]),
  mcpServers: z.array(McpServerSchema).optional(),
});

// ============================================================================
// Constants
// ============================================================================

/** Filename for persisting UI settings */
const SETTINGS_FILE = "ui-settings.json";

/** Default settings when no settings file exists */
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

// ============================================================================
// Repository Implementation
// ============================================================================

/**
 * SettingsJsonRepository
 *
 * JSON-backed implementation of the SettingsRepositoryPort.
 * Handles reading, writing, and validating application settings.
 *
 * @example
 * ```typescript
 * const repo = new SettingsJsonRepository();
 * const settings = repo.get();
 *
 * const updated = repo.update({
 *   ui: { theme: "dark", accentColor: "#ff0000" }
 * });
 * ```
 */
export class SettingsJsonRepository implements SettingsRepositoryPort {
  /**
   * Retrieves the current settings with Zod validation
   * Falls back to partial parsing and defaults on validation failure
   *
   * @returns The validated Settings object
   */
  get(): Settings {
    const raw = readJsonFile(SETTINGS_FILE, DEFAULT_SETTINGS);
    try {
      return SettingsSchema.parse(raw);
    } catch {
      try {
        const parsed = raw as Partial<Settings>;
        const uiResult = UiSettingsSchema.safeParse(parsed.ui);
        const projectRoots = Array.isArray(parsed.projectRoots)
          ? parsed.projectRoots
          : DEFAULT_SETTINGS.projectRoots;
        const mcpServersResult = Array.isArray(parsed.mcpServers)
          ? z.array(McpServerSchema).safeParse(parsed.mcpServers)
          : { success: false as const, data: [] as McpServerConfig[] };
        const mcpServers: McpServerConfig[] = mcpServersResult.success
          ? mcpServersResult.data
          : (DEFAULT_SETTINGS.mcpServers ?? []);
        const next: Settings = {
          ui: uiResult.success ? uiResult.data : DEFAULT_SETTINGS.ui,
          projectRoots:
            projectRoots.length > 0
              ? projectRoots
              : DEFAULT_SETTINGS.projectRoots,
          mcpServers,
        };
        writeJsonFile(SETTINGS_FILE, next);
        return next;
      } catch {
        writeJsonFile(SETTINGS_FILE, DEFAULT_SETTINGS);
        return DEFAULT_SETTINGS;
      }
    }
  }

  /**
   * Updates settings with a partial patch and persists to file
   *
   * @param patch - Partial settings to merge
   * @returns The updated Settings object
   */
  update(patch: Partial<Settings>): Settings {
    const current = this.get();
    const next: Settings = {
      ...current,
      ...patch,
      ui: { ...current.ui, ...(patch.ui ?? {}) },
    };
    writeJsonFile(SETTINGS_FILE, next);
    return next;
  }
}

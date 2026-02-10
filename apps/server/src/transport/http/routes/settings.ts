/**
 * Settings Routes
 *
 * API endpoints for UI settings management.
 *
 * Endpoints:
 * - GET  /api/ui-settings     - Get current settings
 * - PUT  /api/ui-settings     - Update settings (API)
 * - POST /api/ui-settings     - Update settings (API)
 *
 * @module transport/http/routes/settings
 */

import type { Context, Hono } from "hono";
import { isAppError } from "../../../shared/errors";
import { parseUiSettingsForm } from "../../../shared/utils/ui-settings.util";
import type { HttpRouteDependencies } from "./deps";

/**
 * Registers settings-related HTTP routes
 */
export function registerSettingsRoutes(
  api: Hono,
  deps: Pick<HttpRouteDependencies, "settingsServices" | "logger">
): void {
  const { settingsServices, logger } = deps;

  // =========================================================================
  // API Routes
  // =========================================================================

  /**
   * GET /api/ui-settings - Get current UI settings
   */
  api.get("/ui-settings", async (c: Context) => {
    const service = settingsServices.getSettings();
    const settings = await service.execute();
    return c.json(settings);
  });

  /**
   * PUT/POST /api/ui-settings - Update UI settings
   */
  const handleApiUpdate = async (c: Context) => {
    try {
      const body = await c.req.parseBody();
      const getSettings = settingsServices.getSettings();
      const currentSettings = await getSettings.execute();
      const formData = body as Record<string, string | File | undefined>;

      const { ui, projectRoots } = parseUiSettingsForm(
        formData,
        currentSettings
      );
      const updateSettings = settingsServices.updateSettings();
      const result = await updateSettings.execute({ ui, projectRoots });
      return c.json({
        ...result.settings,
        changedKeys: result.changedKeys,
        requiresRestart: result.requiresRestart,
      });
    } catch (error) {
      if (isAppError(error)) {
        return c.json({ error: error.message }, error.statusCode as 400 | 404);
      }
      logger.error("Failed to parse settings update payload", {
        error: error instanceof Error ? error.message : String(error),
      });
      return c.json({ error: "Failed to parse settings" }, 400);
    }
  };

  api.put("/ui-settings", handleApiUpdate);
  api.post("/ui-settings", handleApiUpdate);
}

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
import { getContainer } from "../../../bootstrap/container";
import { isAppError } from "../../../shared/errors";
import { parseUiSettingsForm } from "../../../shared/utils/ui-settings.util";

/**
 * Registers settings-related HTTP routes
 */
export function registerSettingsRoutes(api: Hono): void {
  const container = getContainer();

  // =========================================================================
  // API Routes
  // =========================================================================

  /**
   * GET /api/ui-settings - Get current UI settings
   */
  api.get("/ui-settings", async (c: Context) => {
    const service = container.getSettingsServices().getSettings();
    const settings = await service.execute();
    return c.json(settings);
  });

  /**
   * PUT/POST /api/ui-settings - Update UI settings
   */
  const handleApiUpdate = async (c: Context) => {
    try {
      const body = await c.req.parseBody();
      const getSettings = container.getSettingsServices().getSettings();
      const currentSettings = await getSettings.execute();
      const formData = body as Record<string, string | File | undefined>;

      const { ui, projectRoots } = parseUiSettingsForm(
        formData,
        currentSettings
      );
      const updateSettings = container.getSettingsServices().updateSettings();
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
      console.error("Settings parse error:", error);
      return c.json({ error: "Failed to parse settings" }, 400);
    }
  };

  api.put("/ui-settings", handleApiUpdate);
  api.post("/ui-settings", handleApiUpdate);
}

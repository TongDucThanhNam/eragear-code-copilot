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
  api.get("/ui-settings", (c: Context) => {
    const settings = container.getSettings().get();
    return c.json(settings);
  });

  /**
   * PUT/POST /api/ui-settings - Update UI settings
   */
  const handleApiUpdate = async (c: Context) => {
    try {
      const body = await c.req.parseBody();
      const currentSettings = container.getSettings().get();
      const formData = body as Record<string, string | File | undefined>;

      const { ui, projectRoots } = parseUiSettingsForm(
        formData,
        currentSettings
      );
      if (projectRoots.length < 1) {
        return c.json({ error: "At least one project root is required." }, 400);
      }
      const next = container.getSettings().update({ ui, projectRoots });
      const applied = container.applySettings(next);
      container.getEventBus().publish({
        type: "settings_updated",
        changedKeys: applied.changedKeys,
        requiresRestart: applied.requiresRestart,
      });
      return c.json({ ...next, ...applied });
    } catch (error) {
      console.error("Settings parse error:", error);
      return c.json({ error: "Failed to parse settings" }, 400);
    }
  };

  api.put("/ui-settings", handleApiUpdate);
  api.post("/ui-settings", handleApiUpdate);
}

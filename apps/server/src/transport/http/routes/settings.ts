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
import type { Settings } from "../../../shared/types/settings.types";
import { parseUiSettingsForm } from "../../../shared/utils/ui-settings.util";
import type { HttpRouteDependencies } from "./deps";
import { isJsonBodyParseError, parseJsonBodyWithLimit } from "./helpers";

/**
 * Registers settings-related HTTP routes
 */
export function registerSettingsRoutes(
  api: Hono,
  deps: Pick<HttpRouteDependencies, "settingsServices" | "logger" | "runtime">
): void {
  const { settingsServices, logger, runtime } = deps;

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
      const updateSettings = settingsServices.updateSettings();
      const contentType = c.req.header("content-type") ?? "";
      let result:
        | Awaited<ReturnType<typeof updateSettings.execute>>
        | undefined;

      if (contentType.includes("application/json")) {
        const patch = await parseJsonBodyWithLimit<Partial<Settings>>(
          c.req.raw,
          runtime.httpMaxBodyBytes
        );
        result = await updateSettings.execute(patch);
      } else {
        const body = await c.req.parseBody();
        const getSettings = settingsServices.getSettings();
        const currentSettings = await getSettings.execute();
        const formData = body as Record<string, string | File | undefined>;
        const { ui, projectRoots, app } = parseUiSettingsForm(
          formData,
          currentSettings
        );
        result = await updateSettings.execute({ ui, projectRoots, app });
      }

      return c.json({
        ...result.settings,
        changedKeys: result.changedKeys,
        requiresRestart: result.requiresRestart,
      });
    } catch (error) {
      if (isAppError(error)) {
        return c.json({ error: error.message }, error.statusCode as 400 | 404);
      }
      if (isJsonBodyParseError(error)) {
        return c.json({ error: error.message }, error.statusCode);
      }
      if (error instanceof Error) {
        logger.error("Failed to parse settings update payload", {
          error: error.message,
        });
        return c.json({ error: error.message }, 400);
      }
      logger.error("Failed to parse settings update payload", {
        error: String(error),
      });
      return c.json({ error: "Failed to parse settings" }, 400);
    }
  };

  api.put("/ui-settings", handleApiUpdate);
  api.post("/ui-settings", handleApiUpdate);
}

/**
 * Settings Routes
 *
 * API endpoints for UI settings management.
 *
 * Endpoints:
 * - GET  /api/ui-settings     - Get current settings
 * - PUT  /api/ui-settings     - Update settings (API)
 * - POST /api/ui-settings     - Update settings (API)
 * - GET  /api/boot-allowlists - Get boot/runtime allowlist config
 * - PUT  /api/boot-allowlists - Update boot/runtime allowlist config
 * - POST /api/boot-allowlists - Update boot/runtime allowlist config
 *
 * @module transport/http/routes/settings
 */

import type { Context, Hono } from "hono";
import type { HttpRouteDependencies } from "./deps";
import { parseJsonBodyWithLimit } from "./helpers";
import { respondToRouteError } from "./route-errors";
import {
  readUiSettingsRouteInput,
  type UiSettingsFormData,
} from "./settings-route-input";

/**
 * Registers settings-related HTTP routes
 */
export function registerSettingsRoutes(
  api: Hono,
  deps: Pick<HttpRouteDependencies, "useCases" | "logger" | "runtime">
): void {
  const { useCases, logger, runtime } = deps;

  // =========================================================================
  // API Routes
  // =========================================================================

  /**
   * GET /api/ui-settings - Get current UI settings
   */
  api.get("/ui-settings", async (c: Context) => {
    const service = useCases.settings.get;
    const settings = await service.execute();
    return c.json(settings);
  });

  /**
   * PUT/POST /api/ui-settings - Update UI settings
   */
  const handleApiUpdate = async (c: Context) => {
    try {
      const updateSettings = useCases.settings.update;

      const parsedInput = await readUiSettingsRouteInput({
        contentType: c.req.header("content-type"),
        readJson: () =>
          parseJsonBodyWithLimit<unknown>(c.req.raw, runtime.httpMaxBodyBytes),
        readForm: async () => (await c.req.parseBody()) as UiSettingsFormData,
        getCurrentSettings: () => useCases.settings.get.execute(),
      });
      if (!parsedInput.ok) {
        return c.json({ error: parsedInput.error }, 400);
      }

      const result = await updateSettings.execute(parsedInput.input);

      return c.json({
        ...result.settings,
        changedKeys: result.changedKeys,
        requiresRestart: result.requiresRestart,
      });
    } catch (error) {
      return respondToRouteError(c, error, {
        logger,
        logMessage: "Failed to parse settings update payload",
        fallbackMessage: "Failed to parse settings",
        fallbackStatus: 400,
        exposeUnexpectedErrorMessage: true,
      });
    }
  };

  api.put("/ui-settings", handleApiUpdate);
  api.post("/ui-settings", handleApiUpdate);

  /**
   * GET /api/boot-allowlists - Get boot config allowlists
   */
  api.get("/boot-allowlists", async (c: Context) => {
    const service = useCases.settings.manageBootAllowlists;
    const snapshot = await service.get();
    return c.json(snapshot);
  });

  /**
   * PUT/POST /api/boot-allowlists - Update boot config allowlists
   */
  const handleBootAllowlistUpdate = async (c: Context) => {
    try {
      const payload = await parseJsonBodyWithLimit<unknown>(
        c.req.raw,
        runtime.httpMaxBodyBytes
      );
      const service = useCases.settings.manageBootAllowlists;
      const snapshot = await service.update(payload);
      return c.json(snapshot);
    } catch (error) {
      return respondToRouteError(c, error, {
        logger,
        logMessage: "Failed to update boot allowlist payload",
        fallbackMessage: "Failed to update boot allowlists",
        fallbackStatus: 400,
        exposeUnexpectedErrorMessage: true,
      });
    }
  };

  api.put("/boot-allowlists", handleBootAllowlistUpdate);
  api.post("/boot-allowlists", handleBootAllowlistUpdate);
}

/**
 * Agents Routes
 *
 * API endpoints for agent configuration management (CRUD).
 *
 * Endpoints:
 * - GET    /api/agents          - List all agents
 * - POST   /api/agents          - Create agent (API)
 * - PUT    /api/agents          - Update agent (API)
 * - DELETE /api/agents          - Delete agent (API)
 *
 * @module transport/http/routes/agents
 */

import type { Context, Hono } from "hono";
import {
  parseCreateAgentRouteInput,
  parseDeleteAgentRouteInput,
  parseUpdateAgentRouteInput,
} from "./agent-route-input";
import type { HttpRouteDependencies } from "./deps";
import { parseJsonBodyWithLimit } from "./helpers";
import { requireRouteUserId } from "./route-auth";
import { respondToRouteError } from "./route-errors";

/**
 * Registers agent-related HTTP routes
 */
export function registerAgentRoutes(
  api: Hono,
  deps: Pick<
    HttpRouteDependencies,
    "useCases" | "logger" | "resolveAuthContext" | "runtime"
  >
): void {
  const { useCases, logger, resolveAuthContext, runtime } = deps;

  // =========================================================================
  // API Routes
  // =========================================================================

  /**
   * GET /api/agents - List all agent configurations
   */
  api.get("/agents", async (c: Context) => {
    const auth = await requireRouteUserId(c, resolveAuthContext);
    if (!auth.ok) {
      return auth.response;
    }
    const service = useCases.agent.list;
    const result = await service.execute(auth.userId);
    return c.json({ agents: result.agents });
  });

  /**
   * POST /api/agents - Create a new agent configuration
   */
  api.post("/agents", async (c: Context) => {
    try {
      const auth = await requireRouteUserId(c, resolveAuthContext);
      if (!auth.ok) {
        return auth.response;
      }
      const payload = await parseJsonBodyWithLimit<unknown>(
        c.req.raw,
        runtime.httpMaxBodyBytes
      );
      const parsedInput = parseCreateAgentRouteInput(payload);
      if (!parsedInput.ok) {
        return c.json({ error: parsedInput.error }, 400);
      }

      const service = useCases.agent.create;
      const agent = await service.execute(auth.userId, parsedInput.input);

      return c.json({ ok: true, agent });
    } catch (error) {
      return respondToRouteError(c, error, {
        logger,
        logMessage: "Failed to create agent",
        fallbackMessage: "Failed to create agent",
        fallbackStatus: 500,
      });
    }
  });

  /**
   * PUT /api/agents - Update an agent configuration
   */
  api.put("/agents", async (c: Context) => {
    try {
      const auth = await requireRouteUserId(c, resolveAuthContext);
      if (!auth.ok) {
        return auth.response;
      }
      const payload = await parseJsonBodyWithLimit<unknown>(
        c.req.raw,
        runtime.httpMaxBodyBytes
      );
      const parsedInput = parseUpdateAgentRouteInput(payload);
      if (!parsedInput.ok) {
        return c.json({ error: parsedInput.error }, 400);
      }

      const service = useCases.agent.update;
      const agent = await service.execute(auth.userId, parsedInput.input);

      return c.json({ ok: true, agent });
    } catch (error) {
      return respondToRouteError(c, error, {
        logger,
        logMessage: "Failed to update agent",
        fallbackMessage: "Failed to update agent",
        fallbackStatus: 500,
      });
    }
  });

  /**
   * DELETE /api/agents - Delete an agent configuration
   */
  api.delete("/agents", async (c: Context) => {
    try {
      const auth = await requireRouteUserId(c, resolveAuthContext);
      if (!auth.ok) {
        return auth.response;
      }
      const parsedInput = parseDeleteAgentRouteInput(await c.req.parseBody());
      if (!parsedInput.ok) {
        return c.json({ error: parsedInput.error }, 400);
      }

      const service = useCases.agent.delete;
      await service.execute(auth.userId, parsedInput.input.agentId);

      return c.json({ ok: true });
    } catch (error) {
      return respondToRouteError(c, error, {
        logger,
        logMessage: "Failed to delete agent",
        fallbackMessage: "Failed to delete agent",
        fallbackStatus: 500,
      });
    }
  });
}

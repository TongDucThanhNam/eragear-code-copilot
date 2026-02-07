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
import { getContainer } from "../../../bootstrap/container";
import { AgentService } from "../../../modules/agent/application/agent.service";
import { ValidationError } from "../../../shared/errors";
import { parseArgsInput } from "../../../shared/utils/cli-args.util";

/** Valid agent types */
const VALID_AGENT_TYPES = [
  "claude",
  "codex",
  "opencode",
  "gemini",
  "other",
] as const;
type AgentType = (typeof VALID_AGENT_TYPES)[number];

/**
 * Registers agent-related HTTP routes
 */
export function registerAgentRoutes(api: Hono): void {
  const container = getContainer();

  // =========================================================================
  // API Routes
  // =========================================================================

  /**
   * GET /api/agents - List all agent configurations
   */
  api.get("/agents", async (c: Context) => {
    const agents = await container.getAgents().findAll();
    return c.json({ agents });
  });

  /**
   * POST /api/agents - Create a new agent configuration
   */
  api.post("/agents", async (c: Context) => {
    try {
      const body = await c.req.json();
      const { name, type, command, args, argsInput, env, projectId } = body as {
        name: string;
        type: AgentType;
        command: string;
        args?: string[];
        argsInput?: string;
        env?: Record<string, string>;
        projectId?: string | null;
      };

      if (!(name && type && command)) {
        return c.json({ error: "name, type, and command are required" }, 400);
      }

      if (!VALID_AGENT_TYPES.includes(type)) {
        return c.json(
          { error: `type must be one of: ${VALID_AGENT_TYPES.join(", ")}` },
          400
        );
      }

      let resolvedArgs = Array.isArray(args) ? args : undefined;
      if (!resolvedArgs && argsInput) {
        const parsed = parseArgsInput(argsInput);
        if (parsed.error) {
          return c.json({ error: parsed.error }, 400);
        }
        resolvedArgs = parsed.args;
      }

      const service = new AgentService(container.getAgents());
      const agent = await service.createAgent({
        name,
        type,
        command,
        args: resolvedArgs,
        env,
        projectId,
      });

      container.getEventBus().publish({
        type: "dashboard_refresh",
        reason: "agent_created",
        agentId: agent.id,
      });

      return c.json({ ok: true, agent });
    } catch (error) {
      if (error instanceof ValidationError) {
        return c.json({ error: error.message }, error.statusCode as 400 | 404);
      }
      console.error("Failed to create agent:", error);
      return c.json({ error: "Failed to create agent" }, 500);
    }
  });

  /**
   * PUT /api/agents - Update an agent configuration
   */
  api.put("/agents", async (c: Context) => {
    try {
      const body = await c.req.json();
      const { id, name, type, command, args, argsInput, env, projectId } =
        body as {
          id: string;
          name?: string;
          type?: AgentType;
          command?: string;
          args?: string[];
          argsInput?: string;
          env?: Record<string, string>;
          projectId?: string | null;
        };

      if (!id) {
        return c.json({ error: "id is required" }, 400);
      }

      const existing = await container.getAgents().findById(id);
      if (!existing) {
        return c.json({ error: "Agent not found" }, 404);
      }

      if (type && !VALID_AGENT_TYPES.includes(type)) {
        return c.json(
          { error: `type must be one of: ${VALID_AGENT_TYPES.join(", ")}` },
          400
        );
      }

      let resolvedArgs = Array.isArray(args) ? args : undefined;
      if (!resolvedArgs && argsInput) {
        const parsed = parseArgsInput(argsInput);
        if (parsed.error) {
          return c.json({ error: parsed.error }, 400);
        }
        resolvedArgs = parsed.args;
      }

      const service = new AgentService(container.getAgents());
      const agent = await service.updateAgent({
        id,
        name,
        type,
        command,
        args: resolvedArgs,
        env,
        projectId,
      });

      container.getEventBus().publish({
        type: "dashboard_refresh",
        reason: "agent_updated",
        agentId: agent.id,
      });

      return c.json({ ok: true, agent });
    } catch (error) {
      if (error instanceof ValidationError) {
        return c.json({ error: error.message }, error.statusCode as 400 | 404);
      }
      console.error("Failed to update agent:", error);
      return c.json({ error: "Failed to update agent" }, 500);
    }
  });

  /**
   * DELETE /api/agents - Delete an agent configuration
   */
  api.delete("/agents", async (c: Context) => {
    try {
      const body = await c.req.parseBody();
      const agentId = body.agentId as string;

      if (!agentId) {
        return c.json({ error: "agentId is required" }, 400);
      }

      await container.getAgents().delete(agentId);
      container.getEventBus().publish({
        type: "dashboard_refresh",
        reason: "agent_deleted",
        agentId,
      });

      return c.json({ ok: true });
    } catch (error) {
      console.error("Failed to delete agent:", error);
      return c.json({ error: "Failed to delete agent" }, 500);
    }
  });
}

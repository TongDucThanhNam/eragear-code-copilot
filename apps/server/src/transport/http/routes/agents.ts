/**
 * Agents Routes
 *
 * API and form endpoints for agent configuration management (CRUD).
 *
 * Endpoints:
 * - GET    /api/agents          - List all agents
 * - POST   /api/agents          - Create agent (API)
 * - PUT    /api/agents          - Update agent (API)
 * - DELETE /api/agents          - Delete agent (API)
 * - POST   /form/agents/create  - Create agent (HTML form)
 * - POST   /form/agents/update  - Update agent (HTML form)
 * - POST   /form/agents/delete  - Delete agent (HTML form)
 *
 * @module transport/http/routes/agents
 */

import type { Context, Hono } from "hono";
import { getContainer } from "../../../bootstrap/container";
import { AgentService } from "../../../modules/agent/application/agent.service";
import { ValidationError } from "../../../shared/errors";
import { parseArgsInput } from "../../../shared/utils/cli-args.util";
import { type FormDataRecord, getFormValue, redirectWithParams } from "./helpers";

/** Valid agent types */
const VALID_AGENT_TYPES = ["claude", "codex", "opencode", "gemini", "other"] as const;
type AgentType = (typeof VALID_AGENT_TYPES)[number];

/**
 * Registers agent-related HTTP routes
 */
export function registerAgentRoutes(api: Hono, form: Hono): void {
  const container = getContainer();

  // =========================================================================
  // API Routes
  // =========================================================================

  /**
   * GET /api/agents - List all agent configurations
   */
  api.get("/agents", (c: Context) => {
    const agents = container.getAgents().findAll();
    return c.json({ agents });
  });

  /**
   * POST /api/agents - Create a new agent configuration
   */
  api.post("/agents", async (c: Context) => {
    try {
      const body = await c.req.json();
      const { name, type, command, args, env, projectId } = body as {
        name: string;
        type: AgentType;
        command: string;
        args?: string[];
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

      const service = new AgentService(container.getAgents());
      const agent = service.createAgent({
        name,
        type,
        command,
        args,
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
      const { id, name, type, command, args, env, projectId } = body as {
        id: string;
        name?: string;
        type?: AgentType;
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        projectId?: string | null;
      };

      if (!id) {
        return c.json({ error: "id is required" }, 400);
      }

      const existing = container.getAgents().findById(id);
      if (!existing) {
        return c.json({ error: "Agent not found" }, 404);
      }

      if (type && !VALID_AGENT_TYPES.includes(type)) {
        return c.json(
          { error: `type must be one of: ${VALID_AGENT_TYPES.join(", ")}` },
          400
        );
      }

      const service = new AgentService(container.getAgents());
      const agent = service.updateAgent({
        id,
        name,
        type,
        command,
        args,
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

      container.getAgents().delete(agentId);
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

  // =========================================================================
  // Form Routes (HTML form submissions)
  // =========================================================================

  /**
   * POST /form/agents/create - Create agent via HTML form
   */
  form.post("/agents/create", async (c: Context) => {
    try {
      const body = await c.req.parseBody();
      const formData = body as FormDataRecord;
      const name = getFormValue(formData, "name").trim();
      const type = getFormValue(formData, "type").trim() as AgentType | "";
      const command = getFormValue(formData, "command").trim();
      const argsInput = getFormValue(formData, "args");
      const argsResult = parseArgsInput(argsInput);
      const projectId = getFormValue(formData, "projectId") || undefined;

      if (!(name && type && command)) {
        return redirectWithParams(c, {
          tab: "agents",
          error: "name, type, and command are required",
        });
      }

      if (!VALID_AGENT_TYPES.includes(type as AgentType)) {
        return redirectWithParams(c, {
          tab: "agents",
          error: `type must be one of: ${VALID_AGENT_TYPES.join(", ")}`,
        });
      }

      if (argsResult.error) {
        return redirectWithParams(c, {
          tab: "agents",
          error: argsResult.error,
        });
      }

      const service = new AgentService(container.getAgents());
      const agent = service.createAgent({
        name,
        type: type as AgentType,
        command,
        args: argsResult.args,
        projectId: projectId || null,
      });

      container.getEventBus().publish({
        type: "dashboard_refresh",
        reason: "agent_created",
        agentId: agent.id,
      });

      return redirectWithParams(c, { tab: "agents", notice: "Agent added." });
    } catch (error) {
      if (error instanceof ValidationError) {
        return redirectWithParams(c, {
          tab: "agents",
          error: error.message,
        });
      }
      console.error("Failed to create agent:", error);
      return redirectWithParams(c, {
        tab: "agents",
        error: "Failed to create agent",
      });
    }
  });

  /**
   * POST /form/agents/update - Update agent via HTML form
   */
  form.post("/agents/update", async (c: Context) => {
    try {
      const body = await c.req.parseBody();
      const formData = body as FormDataRecord;
      const id = getFormValue(formData, "id");
      if (!id) {
        return redirectWithParams(c, {
          tab: "agents",
          error: "id is required",
        });
      }

      const existing = container.getAgents().findById(id);
      if (!existing) {
        return redirectWithParams(c, {
          tab: "agents",
          error: "Agent not found",
        });
      }

      const name = getFormValue(formData, "name") || undefined;
      const type = getFormValue(formData, "type") as AgentType | "";
      const command = getFormValue(formData, "command") || undefined;
      const argsInput = getFormValue(formData, "args");
      const argsResult = parseArgsInput(argsInput);
      const projectId = getFormValue(formData, "projectId");

      if (type && !VALID_AGENT_TYPES.includes(type as AgentType)) {
        return redirectWithParams(c, {
          tab: "agents",
          error: `type must be one of: ${VALID_AGENT_TYPES.join(", ")}`,
        });
      }

      if (argsResult.error) {
        return redirectWithParams(c, {
          tab: "agents",
          error: argsResult.error,
        });
      }

      const service = new AgentService(container.getAgents());
      const agent = service.updateAgent({
        id,
        name,
        type: type || undefined,
        command,
        args: argsResult.args,
        projectId: projectId || undefined,
      });

      container.getEventBus().publish({
        type: "dashboard_refresh",
        reason: "agent_updated",
        agentId: agent.id,
      });

      return redirectWithParams(c, {
        tab: "agents",
        notice: "Agent updated.",
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        return redirectWithParams(c, {
          tab: "agents",
          error: error.message,
        });
      }
      console.error("Failed to update agent:", error);
      return redirectWithParams(c, {
        tab: "agents",
        error: "Failed to update agent",
      });
    }
  });

  /**
   * POST /form/agents/delete - Delete agent via HTML form
   */
  form.post("/agents/delete", async (c: Context) => {
    try {
      const body = await c.req.parseBody();
      const formData = body as FormDataRecord;
      const agentId = getFormValue(formData, "agentId");

      if (!agentId) {
        return redirectWithParams(c, {
          tab: "agents",
          error: "agentId is required",
        });
      }

      container.getAgents().delete(agentId);
      container.getEventBus().publish({
        type: "dashboard_refresh",
        reason: "agent_deleted",
        agentId,
      });

      return redirectWithParams(c, {
        tab: "agents",
        notice: "Agent deleted.",
      });
    } catch (error) {
      console.error("Failed to delete agent:", error);
      return redirectWithParams(c, {
        tab: "agents",
        error: "Failed to delete agent",
      });
    }
  });
}

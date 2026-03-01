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
import { isAppError } from "../../../shared/errors";
import { parseArgsInput } from "../../../shared/utils/cli-args.util";
import type { HttpRouteDependencies } from "./deps";
import { isJsonBodyParseError, parseJsonBodyWithLimit } from "./helpers";

/** Valid agent types */
const VALID_AGENT_TYPES = [
  "claude",
  "codex",
  "opencode",
  "gemini",
  "other",
] as const;
type AgentType = (typeof VALID_AGENT_TYPES)[number];

function resolveAgentArgs(input: { args?: string[]; argsInput?: string }): {
  args: string[] | undefined;
  error?: string;
} {
  if (Array.isArray(input.args)) {
    return { args: input.args };
  }
  if (!input.argsInput) {
    return { args: undefined };
  }
  const parsed = parseArgsInput(input.argsInput);
  if (parsed.error) {
    return { args: undefined, error: parsed.error };
  }
  return { args: parsed.args };
}

/**
 * Registers agent-related HTTP routes
 */
export function registerAgentRoutes(
  api: Hono,
  deps: Pick<
    HttpRouteDependencies,
    "agentServices" | "logger" | "resolveAuthContext" | "runtime"
  >
): void {
  const { agentServices, logger, resolveAuthContext, runtime } = deps;

  // =========================================================================
  // API Routes
  // =========================================================================

  /**
   * GET /api/agents - List all agent configurations
   */
  api.get("/agents", async (c: Context) => {
    const auth = await resolveAuthContext({
      headers: c.req.raw.headers,
      url: c.req.raw.url,
      remoteAddress: c.req.header("x-eragear-remote-address"),
    });
    if (!auth) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const service = agentServices.listAgents();
    const result = await service.execute(auth.userId);
    return c.json({ agents: result.agents });
  });

  /**
   * POST /api/agents - Create a new agent configuration
   */
  api.post("/agents", async (c: Context) => {
    try {
      const auth = await resolveAuthContext({
        headers: c.req.raw.headers,
        url: c.req.raw.url,
        remoteAddress: c.req.header("x-eragear-remote-address"),
      });
      if (!auth) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      const {
        name,
        type,
        command,
        args,
        argsInput,
        resumeCommandTemplate,
        env,
        projectId,
      } =
        await parseJsonBodyWithLimit<{
          name: string;
          type: AgentType;
          command: string;
          args?: string[];
          argsInput?: string;
          resumeCommandTemplate?: string;
          env?: Record<string, string>;
          projectId?: string | null;
        }>(c.req.raw, runtime.httpMaxBodyBytes);

      if (!(name && type && command)) {
        return c.json({ error: "name, type, and command are required" }, 400);
      }

      if (!VALID_AGENT_TYPES.includes(type)) {
        return c.json(
          { error: `type must be one of: ${VALID_AGENT_TYPES.join(", ")}` },
          400
        );
      }

      const parsedArgs = resolveAgentArgs({ args, argsInput });
      if (parsedArgs.error) {
        return c.json({ error: parsedArgs.error }, 400);
      }

      const service = agentServices.createAgent();
      const agent = await service.execute(auth.userId, {
        name,
        type,
        command,
        args: parsedArgs.args,
        resumeCommandTemplate,
        env,
        projectId,
      });

      return c.json({ ok: true, agent });
    } catch (error) {
      if (isJsonBodyParseError(error)) {
        return c.json({ error: error.message }, error.statusCode);
      }
      if (isAppError(error)) {
        return c.json({ error: error.message }, error.statusCode as 400 | 404);
      }
      logger.error("Failed to create agent", {
        error: error instanceof Error ? error.message : String(error),
      });
      return c.json({ error: "Failed to create agent" }, 500);
    }
  });

  /**
   * PUT /api/agents - Update an agent configuration
   */
  api.put("/agents", async (c: Context) => {
    try {
      const auth = await resolveAuthContext({
        headers: c.req.raw.headers,
        url: c.req.raw.url,
        remoteAddress: c.req.header("x-eragear-remote-address"),
      });
      if (!auth) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      const {
        id,
        name,
        type,
        command,
        args,
        argsInput,
        resumeCommandTemplate,
        env,
        projectId,
      } =
        await parseJsonBodyWithLimit<{
          id: string;
          name?: string;
          type?: AgentType;
          command?: string;
          args?: string[];
          argsInput?: string;
          resumeCommandTemplate?: string;
          env?: Record<string, string>;
          projectId?: string | null;
        }>(c.req.raw, runtime.httpMaxBodyBytes);

      if (!id) {
        return c.json({ error: "id is required" }, 400);
      }

      if (type && !VALID_AGENT_TYPES.includes(type)) {
        return c.json(
          { error: `type must be one of: ${VALID_AGENT_TYPES.join(", ")}` },
          400
        );
      }

      const parsedArgs = resolveAgentArgs({ args, argsInput });
      if (parsedArgs.error) {
        return c.json({ error: parsedArgs.error }, 400);
      }

      const service = agentServices.updateAgent();
      const agent = await service.execute(auth.userId, {
        id,
        name,
        type,
        command,
        args: parsedArgs.args,
        resumeCommandTemplate,
        env,
        projectId,
      });

      return c.json({ ok: true, agent });
    } catch (error) {
      if (isJsonBodyParseError(error)) {
        return c.json({ error: error.message }, error.statusCode);
      }
      if (isAppError(error)) {
        return c.json({ error: error.message }, error.statusCode as 400 | 404);
      }
      logger.error("Failed to update agent", {
        error: error instanceof Error ? error.message : String(error),
      });
      return c.json({ error: "Failed to update agent" }, 500);
    }
  });

  /**
   * DELETE /api/agents - Delete an agent configuration
   */
  api.delete("/agents", async (c: Context) => {
    try {
      const auth = await resolveAuthContext({
        headers: c.req.raw.headers,
        url: c.req.raw.url,
        remoteAddress: c.req.header("x-eragear-remote-address"),
      });
      if (!auth) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      const body = await c.req.parseBody();
      const agentId = body.agentId as string;

      if (!agentId) {
        return c.json({ error: "agentId is required" }, 400);
      }

      const service = agentServices.deleteAgent();
      await service.execute(auth.userId, agentId);

      return c.json({ ok: true });
    } catch (error) {
      if (isAppError(error)) {
        return c.json({ error: error.message }, error.statusCode as 400 | 404);
      }
      logger.error("Failed to delete agent", {
        error: error instanceof Error ? error.message : String(error),
      });
      return c.json({ error: "Failed to delete agent" }, 500);
    }
  });
}

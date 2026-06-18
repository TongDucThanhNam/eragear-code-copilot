/**
 * Agents tRPC Router
 *
 * Composition module for agent configuration procedures. The public interface
 * stays flat under `agents.*`; focused routers own procedure groups.
 *
 * @module transport/trpc/routers/agents
 */

import t from "../base";
import { agentsActiveRouter } from "./agents-active-router";
import { agentsMutationRouter } from "./agents-mutation-router";
import { agentsQueryRouter } from "./agents-query-router";

export const agentsRouter = t.mergeRouters(
  agentsQueryRouter,
  agentsMutationRouter,
  agentsActiveRouter
);

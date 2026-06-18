/**
 * Project tRPC Router
 *
 * Composition module for project management procedures. The public interface
 * stays flat at the top level; focused routers own procedure groups.
 *
 * @module transport/trpc/routers/project
 */

import t from "../base";
import { projectActiveRouter } from "./project-active-router";
import { projectMutationRouter } from "./project-mutation-router";
import { projectQueryRouter } from "./project-query-router";

export const projectRouter = t.mergeRouters(
  projectQueryRouter,
  projectMutationRouter,
  projectActiveRouter
);

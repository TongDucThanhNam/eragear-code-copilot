/**
 * Code tRPC Router
 *
 * RPC endpoints for code context operations: retrieving project context,
 * git diff, and file content. Provides read-only access to codebase information.
 *
 * @module transport/trpc/routers/code
 */

import t from "../base";
import { codeContextRouter } from "./code-context-router";
import { codeEditorBufferRouter } from "./code-editor-buffer-router";

export const codeRouter = t.mergeRouters(
  codeContextRouter,
  codeEditorBufferRouter
);

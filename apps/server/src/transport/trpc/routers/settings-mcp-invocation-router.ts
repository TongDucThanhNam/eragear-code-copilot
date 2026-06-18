import { protectedProcedure, router } from "../base";
import { resolveSettingsLocalAde } from "./settings-local-ade-resolver";
import {
  InvokeMcpToolRequestSchema,
  ReadMcpResourceRequestSchema,
} from "./settings-mcp-router-data";

export const settingsMcpInvocationRouter = router({
  /** Invoke a discovered MCP tool through the configured server transport. */
  invokeMcpTool: protectedProcedure
    .input(InvokeMcpToolRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.invokeMcpTool(userId, input)
      )
    ),

  /** Read a discovered MCP resource through the configured server transport. */
  readMcpResource: protectedProcedure
    .input(ReadMcpResourceRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.readMcpResource(userId, input)
      )
    ),
});

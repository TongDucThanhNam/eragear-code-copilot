import { protectedProcedure, router } from "../base";
import { resolveSettingsLocalAde } from "./settings-local-ade-resolver";
import {
  ProbeMcpServerRequestSchema,
  ToggleMcpServerRequestSchema,
  TrustMcpServerRequestSchema,
  UpsertMcpServerRequestSchema,
} from "./settings-mcp-router-data";

export const settingsMcpServerRouter = router({
  /** Add or update a project-local MCP server descriptor. */
  upsertMcpServer: protectedProcedure
    .input(UpsertMcpServerRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.upsertMcpServer(userId, input)
      )
    ),

  /** Toggle a project-local MCP server descriptor. */
  toggleMcpServer: protectedProcedure
    .input(ToggleMcpServerRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.toggleMcpServer(userId, input)
      )
    ),

  /** Trust the current MCP invocation fingerprint before manual tool/resource calls. */
  trustMcpServer: protectedProcedure
    .input(TrustMcpServerRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.trustMcpServer(userId, input)
      )
    ),

  /** Probe one project-local MCP server and persist a redacted probe history run. */
  probeMcpServer: protectedProcedure
    .input(ProbeMcpServerRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.probeMcpServer(userId, input)
      )
    ),
});

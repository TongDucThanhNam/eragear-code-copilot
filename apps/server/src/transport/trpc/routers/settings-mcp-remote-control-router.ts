import { protectedProcedure, router } from "../base";
import { resolveSettingsLocalAde } from "./settings-local-ade-resolver";
import {
  ConfigureMcpRemoteControlsRequestSchema,
  WatchMcpNotificationsRequestSchema,
} from "./settings-mcp-router-data";

export const settingsMcpRemoteControlRouter = router({
  /** Watch a trusted SSE MCP notification stream briefly and persist reconnect diagnostics. */
  watchMcpNotifications: protectedProcedure
    .input(WatchMcpNotificationsRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.watchMcpNotifications(userId, input)
      )
    ),

  /** Configure reviewed remote MCP operational controls. */
  configureMcpRemoteControls: protectedProcedure
    .input(ConfigureMcpRemoteControlsRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.configureMcpRemoteControls(userId, input)
      )
    ),
});

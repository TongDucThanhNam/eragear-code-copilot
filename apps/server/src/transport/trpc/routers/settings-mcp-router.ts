import t from "../base";
import { settingsMcpInvocationRouter } from "./settings-mcp-invocation-router";
import { settingsMcpRemoteControlRouter } from "./settings-mcp-remote-control-router";
import { settingsMcpServerRouter } from "./settings-mcp-server-router";

export const settingsMcpRouter = t.mergeRouters(
  settingsMcpServerRouter,
  settingsMcpInvocationRouter,
  settingsMcpRemoteControlRouter
);

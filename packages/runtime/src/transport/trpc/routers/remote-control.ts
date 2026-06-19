import t from "../base";
import { remoteControlDeviceRouter } from "./remote-control-device-router";
import { remoteControlSessionRouter } from "./remote-control-session-router";
import { remoteControlStatusRouter } from "./remote-control-status-router";

export const remoteControlRouter = t.mergeRouters(
  remoteControlStatusRouter,
  remoteControlDeviceRouter,
  remoteControlSessionRouter
);

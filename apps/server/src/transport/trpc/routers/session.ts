/**
 * Session tRPC Router
 *
 * RPC endpoints for session management: create, stop, resume, delete, get state,
 * list sessions, update metadata, get messages, and subscribe to real-time events.
 * Sessions represent active connections to AI agents.
 *
 * @module transport/trpc/routers/session
 */

import t from "../base";
import { sessionEventsRouter } from "./session-events-router";
import { sessionForkRouter } from "./session-fork-router";
import { sessionLifecycleRouter } from "./session-lifecycle-router";
import { sessionQueryRouter } from "./session-query-router";
import { sessionRecordRouter } from "./session-record-router";

export const sessionRouter = t.mergeRouters(
  sessionLifecycleRouter,
  sessionForkRouter,
  sessionRecordRouter,
  sessionEventsRouter,
  sessionQueryRouter
);

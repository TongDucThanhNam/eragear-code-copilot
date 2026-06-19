export type {
  MessageInsert,
  MessageRow,
  SessionInsert,
  SessionListRow,
  SessionRow,
} from "./session-sqlite.mapper.types";

import { SessionSqliteMapper as SessionSqliteMapperBase } from "./session-sqlite.mapper.write";

export class SessionSqliteMapper extends SessionSqliteMapperBase {}

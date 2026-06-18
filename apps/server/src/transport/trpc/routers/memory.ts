import t from "../base";
import { memoryContextRouter } from "./memory-context-router";
import { memoryPresetRouter } from "./memory-preset-router";
import { memoryQueryRouter } from "./memory-query-router";
import { memorySourceRouter } from "./memory-source-router";

export const memoryRouter = t.mergeRouters(
  memoryQueryRouter,
  memorySourceRouter,
  memoryPresetRouter,
  memoryContextRouter
);

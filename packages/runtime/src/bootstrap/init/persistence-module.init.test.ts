import { describe, expect, test } from "bun:test";
import {
  GoalIntakeSqliteRepository,
  GoalIntakeSqliteWorkerRepository,
} from "#runtime/modules/goal-intake/di";
import type { AppConfigService } from "#runtime/modules/settings";
import {
  WorkflowJournalSqliteAdapter,
  WorkflowJournalSqliteWorkerAdapter,
} from "#runtime/modules/workflow/di";
import { initializePersistenceModule } from "./persistence-module.init";

describe("initializePersistenceModule", () => {
  test("selects the workflow journal on the configured SQLite axis", () => {
    const appConfigService = {} as AppConfigService;

    expect(
      initializePersistenceModule({
        sqliteWorkerEnabled: false,
        appConfigService,
      }).workflowJournal
    ).toBeInstanceOf(WorkflowJournalSqliteAdapter);
    expect(
      initializePersistenceModule({
        sqliteWorkerEnabled: true,
        appConfigService,
      }).workflowJournal
    ).toBeInstanceOf(WorkflowJournalSqliteWorkerAdapter);
  });

  test("selects the goal intake repository on the configured SQLite axis", () => {
    const appConfigService = {} as AppConfigService;

    expect(
      initializePersistenceModule({
        sqliteWorkerEnabled: false,
        appConfigService,
      }).goalIntakeRepo
    ).toBeInstanceOf(GoalIntakeSqliteRepository);
    expect(
      initializePersistenceModule({
        sqliteWorkerEnabled: true,
        appConfigService,
      }).goalIntakeRepo
    ).toBeInstanceOf(GoalIntakeSqliteWorkerRepository);
  });
});

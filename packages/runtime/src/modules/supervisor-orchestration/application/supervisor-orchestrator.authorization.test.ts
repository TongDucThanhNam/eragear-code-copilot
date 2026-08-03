import { describe, expect, test } from "bun:test";
import { createSupervisorRunFixture } from "../domain/supervisor-run.test-fixture";
import type { SupervisorRunRepositoryPort } from "./ports/supervisor-run-repository.port";

describe("supervisor run authorization contract", () => {
  test("repository ownership prevents cross-user and cross-project reads", async () => {
    const run = createSupervisorRunFixture({
      userId: "user-1",
      projectId: "project-1",
    });
    const repository: Pick<SupervisorRunRepositoryPort, "get" | "list"> = {
      get(runId, userId) {
        return Promise.resolve(
          runId === run.runId && userId === run.userId ? run : null
        );
      },
      list(input) {
        return Promise.resolve(
          input.userId === run.userId &&
            (!input.projectId || input.projectId === run.projectId)
            ? [run]
            : []
        );
      },
    };

    expect(await repository.get(run.runId, "user-2")).toBeNull();
    expect(
      await repository.list({ userId: "user-1", projectId: "project-2" })
    ).toEqual([]);
  });
});

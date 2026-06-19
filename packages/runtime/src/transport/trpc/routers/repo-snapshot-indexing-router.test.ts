import { describe, expect, test } from "bun:test";
import { repoSnapshotIndexingRouter } from "./repo-snapshot-indexing";

describe("repoSnapshotIndexingRouter", () => {
  test("keeps extracted query procedures on the flat repo-snapshot indexing interface", () => {
    const procedures = repoSnapshotIndexingRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.getOverview).toBeDefined();
    expect(procedures.search).toBeDefined();
    expect(procedures.query).toBeUndefined();
    expect(procedures.repoSnapshotIndexingQuery).toBeUndefined();
  });

  test("keeps extracted settings procedures on the flat repo-snapshot indexing interface", () => {
    const procedures = repoSnapshotIndexingRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.updateSettings).toBeDefined();
    expect(procedures.settings).toBeUndefined();
    expect(procedures.repoSnapshotIndexingSettings).toBeUndefined();
  });

  test("keeps extracted refresh procedures on the flat repo-snapshot indexing interface", () => {
    const procedures = repoSnapshotIndexingRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.refresh).toBeDefined();
    expect(procedures.indexing).toBeUndefined();
    expect(procedures.repoSnapshotIndexingRefresh).toBeUndefined();
  });
});

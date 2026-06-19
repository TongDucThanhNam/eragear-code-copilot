import { describe, expect, test } from "bun:test";
import {
  CreateCheckpointRequestSchema,
  PreviewCheckpointRequestSchema,
  ResolveCheckpointTrackedConflictChoiceRequestSchema,
  RestoreCheckpointFilesRequestSchema,
  RestoreCheckpointHunksRequestSchema,
} from "./settings-checkpoint-router-data";

function selectedFiles(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `src/file-${index}.ts`);
}

describe("settings checkpoint request schemas", () => {
  test("accepts omitted optional checkpoint creation input", () => {
    expect(CreateCheckpointRequestSchema.parse(undefined)).toBeUndefined();
  });

  test("keeps checkpoint creation input strict and trims the optional name", () => {
    expect(
      CreateCheckpointRequestSchema.parse({
        projectId: "project-1",
        name: " before refactor ",
      })
    ).toEqual({
      projectId: "project-1",
      name: "before refactor",
    });

    expect(
      CreateCheckpointRequestSchema.safeParse({
        projectId: "project-1",
        checkpointId: "checkpoint-1",
      }).success
    ).toBe(false);
  });

  test("requires checkpoint identifiers for preview requests", () => {
    expect(
      PreviewCheckpointRequestSchema.parse({
        projectId: "project-1",
        checkpointId: " checkpoint-1 ",
      })
    ).toEqual({
      projectId: "project-1",
      checkpointId: "checkpoint-1",
    });

    expect(
      PreviewCheckpointRequestSchema.safeParse({
        projectId: "project-1",
      }).success
    ).toBe(false);
  });

  test("bounds selected checkpoint file operations at the tRPC request seam", () => {
    expect(
      RestoreCheckpointFilesRequestSchema.parse({
        checkpointId: "checkpoint-1",
        confirmation: "RESTORE checkpoi",
        files: [" src/index.ts "],
      })
    ).toEqual({
      checkpointId: "checkpoint-1",
      confirmation: "RESTORE checkpoi",
      files: ["src/index.ts"],
    });

    expect(
      RestoreCheckpointFilesRequestSchema.safeParse({
        checkpointId: "checkpoint-1",
        confirmation: "RESTORE checkpoi",
        files: [],
      }).success
    ).toBe(false);

    expect(
      RestoreCheckpointFilesRequestSchema.safeParse({
        checkpointId: "checkpoint-1",
        confirmation: "RESTORE checkpoi",
        files: selectedFiles(25),
      }).success
    ).toBe(false);
  });

  test("keeps tracked conflict resolution choices explicit", () => {
    expect(
      ResolveCheckpointTrackedConflictChoiceRequestSchema.parse({
        checkpointId: "checkpoint-1",
        confirmation: "RESTORE checkpoi",
        files: ["src/index.ts"],
        resolution: "current",
      })
    ).toEqual({
      checkpointId: "checkpoint-1",
      confirmation: "RESTORE checkpoi",
      files: ["src/index.ts"],
      resolution: "current",
    });

    expect(
      ResolveCheckpointTrackedConflictChoiceRequestSchema.safeParse({
        checkpointId: "checkpoint-1",
        confirmation: "RESTORE checkpoi",
        files: ["src/index.ts"],
        resolution: "merge",
      }).success
    ).toBe(false);
  });

  test("bounds hunk restore requests and rejects stored/internal hunk fields", () => {
    expect(
      RestoreCheckpointHunksRequestSchema.parse({
        checkpointId: "checkpoint-1",
        confirmation: "RESTORE checkpoi",
        hunks: [{ file: " src/index.ts ", hunkIndex: 0 }],
      })
    ).toEqual({
      checkpointId: "checkpoint-1",
      confirmation: "RESTORE checkpoi",
      hunks: [{ file: "src/index.ts", hunkIndex: 0 }],
    });

    expect(
      RestoreCheckpointHunksRequestSchema.safeParse({
        checkpointId: "checkpoint-1",
        confirmation: "RESTORE checkpoi",
        hunks: [{ file: "src/index.ts", hunkIndex: -1 }],
      }).success
    ).toBe(false);

    expect(
      RestoreCheckpointHunksRequestSchema.safeParse({
        checkpointId: "checkpoint-1",
        confirmation: "RESTORE checkpoi",
        hunks: [
          {
            file: "src/index.ts",
            hunkIndex: 0,
            safetyCheckpointId: "checkpoint-safety",
          },
        ],
      }).success
    ).toBe(false);
  });
});

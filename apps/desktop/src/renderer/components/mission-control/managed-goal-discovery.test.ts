import { describe, expect, test } from "bun:test";
import {
  createManagedGoalDiscoveryDraft,
  prepareManagedGoalDiscoverySubmission,
  reduceManagedGoalDiscoveryDraft,
  snapshotManagedGoalDiscoveryProject,
} from "./managed-goal-discovery";

describe("managed goal discovery state", () => {
  test("starts exhaustive discovery with both external advisors enabled", () => {
    expect(createManagedGoalDiscoveryDraft()).toEqual({
      title: "",
      seedIntent: "",
      depth: "exhaustive",
      providers: {
        chatgpt: true,
        gemini: true,
      },
    });
  });

  test("updates fields without mutating the previous draft and can reset", () => {
    const initial = createManagedGoalDiscoveryDraft();
    const titled = reduceManagedGoalDiscoveryDraft(initial, {
      type: "set_title",
      value: "Durable recovery",
    });
    const quick = reduceManagedGoalDiscoveryDraft(titled, {
      type: "set_depth",
      value: "quick",
    });
    const withoutGemini = reduceManagedGoalDiscoveryDraft(quick, {
      type: "set_provider",
      provider: "gemini",
      enabled: false,
    });

    expect(initial.title).toBe("");
    expect(initial.providers.gemini).toBe(true);
    expect(withoutGemini).toMatchObject({
      title: "Durable recovery",
      depth: "quick",
      providers: { chatgpt: true, gemini: false },
    });
    expect(
      reduceManagedGoalDiscoveryDraft(withoutGemini, { type: "reset" })
    ).toEqual(createManagedGoalDiscoveryDraft());
  });

  test("requires a title and rough outcome", () => {
    expect(
      prepareManagedGoalDiscoverySubmission(createManagedGoalDiscoveryDraft())
    ).toEqual({
      ok: false,
      errors: {
        title: "Enter a goal title.",
        seedIntent: "Describe the rough outcome you want.",
      },
    });
  });

  test("trims the submission and emits enabled providers in stable order", () => {
    const draft = {
      ...createManagedGoalDiscoveryDraft(),
      title: "  Production cutover  ",
      seedIntent: "  Reach a reviewable checkpoint without babysitting.  ",
      depth: "thorough" as const,
      providers: { chatgpt: false, gemini: true },
    };

    expect(prepareManagedGoalDiscoverySubmission(draft)).toEqual({
      ok: true,
      submission: {
        title: "Production cutover",
        seedIntent: "Reach a reviewable checkpoint without babysitting.",
        depth: "thorough",
        providers: ["gemini"],
      },
    });
  });

  test("allows discovery without external advisors", () => {
    const draft = {
      ...createManagedGoalDiscoveryDraft(),
      title: "Local-only discovery",
      seedIntent: "Keep the interview entirely local.",
      providers: { chatgpt: false, gemini: false },
    };

    const prepared = prepareManagedGoalDiscoverySubmission(draft);
    expect(prepared.ok).toBe(true);
    if (prepared.ok) {
      expect(prepared.submission.providers).toEqual([]);
    }
  });

  test("takes an immutable active-project snapshot", () => {
    const project = { id: "project-1", name: "Eragear" };
    const snapshot = snapshotManagedGoalDiscoveryProject(project);
    project.name = "Another project";

    expect(snapshot).toEqual({ id: "project-1", name: "Eragear" });
    expect(snapshot).not.toBe(project);
    expect(snapshotManagedGoalDiscoveryProject(null)).toBeNull();
  });
});

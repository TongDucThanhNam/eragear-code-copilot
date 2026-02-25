import { describe, expect, test } from "bun:test";
import { deriveResumeSessionSyncPlan } from "./use-chat-resume-sync";

describe("deriveResumeSessionSyncPlan", () => {
  test("extracts mode/model/config snapshot from resume payload", () => {
    const plan = deriveResumeSessionSyncPlan({
      ok: true,
      alreadyRunning: false,
      modes: {
        currentModeId: "code",
        availableModes: [{ id: "ask", name: "Ask" }, { id: "code", name: "Code" }],
      },
      models: {
        currentModelId: "model-2",
        availableModels: [
          { modelId: "model-1", name: "Model 1" },
          { modelId: "model-2", name: "Model 2" },
        ],
      },
      configOptions: [
        {
          id: "mode",
          name: "Mode",
          category: "mode",
          type: "select",
          currentValue: "code",
          options: [{ value: "ask", name: "Ask" }, { value: "code", name: "Code" }],
        },
      ],
      supportsModelSwitching: true,
    });

    expect(plan).toEqual({
      alreadyRunning: false,
      modes: {
        currentModeId: "code",
        availableModes: [{ id: "ask", name: "Ask" }, { id: "code", name: "Code" }],
      },
      models: {
        currentModelId: "model-2",
        availableModels: [
          { modelId: "model-1", name: "Model 1" },
          { modelId: "model-2", name: "Model 2" },
        ],
      },
      configOptions: [
        {
          id: "mode",
          name: "Mode",
          category: "mode",
          type: "select",
          currentValue: "code",
          options: [{ value: "ask", name: "Ask" }, { value: "code", name: "Code" }],
        },
      ],
      supportsModelSwitching: true,
    });
  });

  test("keeps alreadyRunning true and preserves null configOptions", () => {
    const plan = deriveResumeSessionSyncPlan({
      alreadyRunning: true,
      configOptions: null,
      supportsModelSwitching: false,
    });

    expect(plan).toEqual({
      alreadyRunning: true,
      configOptions: null,
      supportsModelSwitching: false,
    });
  });

  test("falls back safely for malformed payload", () => {
    expect(deriveResumeSessionSyncPlan("invalid")).toEqual({
      alreadyRunning: false,
    });
  });
});

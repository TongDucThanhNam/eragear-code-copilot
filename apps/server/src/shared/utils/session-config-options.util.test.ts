import { describe, expect, it } from "bun:test";
import { DEFAULT_MAX_VISIBLE_MODEL_COUNT } from "@/config/constants";
import type { SessionConfigOption } from "@/shared/types/session.types";
import { capModelList } from "./session-config-options.util";

const makeModel = (modelId: string, name?: string) => ({
  modelId,
  name: name ?? modelId,
  description: null as string | null,
});

const makeModelOption = (
  id: string,
  currentValue: string,
  options: { value: string; name?: string }[]
) => ({
  id,
  name: id,
  type: "select" as const,
  currentValue,
  options: options.map((o) => ({ value: o.value, name: o.name ?? o.value })),
  category: "model" as const,
  description: null as string | null,
});

describe("capModelList", () => {
  describe("constants", () => {
    it("DEFAULT_MAX_VISIBLE_MODEL_COUNT should be 100", () => {
      expect(DEFAULT_MAX_VISIBLE_MODEL_COUNT).toBe(100);
    });
  });

  describe("models capping", () => {
    it("AC1: 200 models → output 100, current at end included (current beyond cap)", () => {
      // 200 models with currentModelId at the 150th model
      const models = Array.from({ length: 200 }, (_, i) =>
        makeModel(`model-${i}`, `Model ${i}`)
      );
      const currentModelId = "model-149"; // 0-indexed = 150th model

      const result = capModelList({ models, currentModelId });

      expect(result.models.length).toBe(100);
      expect(result.truncated).toBe(true);
      expect(result.truncatedCount).toBe(100);
      // The current model should be at position 99 (last)
      expect(result.models[99]!.modelId).toBe(currentModelId);
    });

    it("AC2: Current in first 100 — no special repositioning needed", () => {
      const models = Array.from({ length: 200 }, (_, i) =>
        makeModel(`model-${i}`)
      );
      const currentModelId = "model-50"; // within first 100

      const result = capModelList({ models, currentModelId });

      expect(result.models.length).toBe(100);
      expect(result.truncated).toBe(true);
      expect(result.truncatedCount).toBe(100);
      // Current model should still be at position 50
      expect(result.models[50]!.modelId).toBe(currentModelId);
      // All first 100 models should be present
      expect(result.models[0]!.modelId).toBe("model-0");
      expect(result.models[99]!.modelId).toBe("model-99");
    });

    it("AC3: No current model — first 100, truncated true, truncatedCount 100", () => {
      const models = Array.from({ length: 200 }, (_, i) =>
        makeModel(`model-${i}`)
      );

      const result = capModelList({ models });

      expect(result.models.length).toBe(100);
      expect(result.truncated).toBe(true);
      expect(result.truncatedCount).toBe(100);
      expect(result.models[0]!.modelId).toBe("model-0");
      expect(result.models[99]!.modelId).toBe("model-99");
    });

    it("AC5: Nested groups are flattened into flat options array", () => {
      const modelOption: SessionConfigOption = {
        id: "model",
        name: "Model",
        type: "select",
        currentValue: "model-5",
        category: "model",
        description: null,
        options: [
          {
            group: "Provider A",
            name: "Provider A",
            options: [
              { value: "model-0", name: "Model 0" },
              { value: "model-1", name: "Model 1" },
            ],
          },
          {
            group: "Provider B",
            name: "Provider B",
            options: [{ value: "model-2", name: "Model 2" }],
          },
        ],
      };

      const result = capModelList({
        configOptions: [modelOption],
        currentModelId: "model-5",
      });

      expect(result.configOptions.length).toBe(1);
      const processed = result.configOptions[0]!;
      // Groups must be flattened into individual flat option entries
      expect(processed.options).toEqual([
        { value: "model-0", name: "Model 0", description: null },
        { value: "model-1", name: "Model 1", description: null },
        { value: "model-2", name: "Model 2", description: null },
      ]);
      // No truncation since 3 < 100
      expect(result.truncated).toBe(false);
    });

    it("AC6: No model option unchanged — if models ≤ max, return as-is (copy), truncated false", () => {
      const models = [makeModel("model-0"), makeModel("model-1")];

      const result = capModelList({ models, maxVisible: 10 });

      expect(result.models.length).toBe(2);
      expect(result.truncated).toBe(false);
      expect(result.truncatedCount).toBe(0);
    });

    it("AC7: Max larger than list — no truncation, truncated false, truncatedCount 0", () => {
      const models = Array.from({ length: 50 }, (_, i) =>
        makeModel(`model-${i}`)
      );

      const result = capModelList({ models, maxVisible: 200 });

      expect(result.models.length).toBe(50);
      expect(result.truncated).toBe(false);
      expect(result.truncatedCount).toBe(0);
    });

    it("AC8: Max = 0 — returns empty arrays", () => {
      const models = Array.from({ length: 10 }, (_, i) =>
        makeModel(`model-${i}`)
      );

      const result = capModelList({ models, maxVisible: 0 });

      expect(result.models.length).toBe(0);
      expect(result.truncated).toBe(true);
      expect(result.truncatedCount).toBe(10);
    });
  });

  describe("null/undefined inputs", () => {
    it("AC4: models: null → models: []", () => {
      const result = capModelList({ models: null });
      expect(result.models).toEqual([]);
      expect(result.truncated).toBe(false);
      expect(result.truncatedCount).toBe(0);
    });

    it("AC4: models: undefined → models: []", () => {
      const result = capModelList({ models: undefined });
      expect(result.models).toEqual([]);
      expect(result.truncated).toBe(false);
      expect(result.truncatedCount).toBe(0);
    });

    it("configOptions: null → configOptions: []", () => {
      const result = capModelList({ configOptions: null });
      expect(result.configOptions).toEqual([]);
    });

    it("configOptions: undefined → configOptions: []", () => {
      const result = capModelList({ configOptions: undefined });
      expect(result.configOptions).toEqual([]);
    });
  });

  describe("config options currentValue preservation", () => {
    it("currentValue option should be first in options array for model category", () => {
      const modelOption: SessionConfigOption = {
        id: "model",
        name: "Model",
        type: "select",
        currentValue: "model-5",
        category: "model",
        description: null,
        options: [
          { value: "model-0", name: "Model 0" },
          { value: "model-1", name: "Model 1" },
          { value: "model-2", name: "Model 2" },
          { value: "model-3", name: "Model 3" },
          { value: "model-4", name: "Model 4" },
          { value: "model-5", name: "Model 5" },
          { value: "model-6", name: "Model 6" },
          { value: "model-7", name: "Model 7" },
        ],
      };

      const result = capModelList({
        configOptions: [modelOption],
        currentModelId: "model-5",
      });

      expect(result.configOptions.length).toBe(1);
      const processed = result.configOptions[0]!;
      // The currentValue entry should come first
      expect(processed.options[0]).toEqual({
        value: "model-5",
        name: "Model 5",
        description: null,
      });
    });

    it("currentValue option should be first in options array for mode category", () => {
      const modeOption: SessionConfigOption = {
        id: "mode",
        name: "Mode",
        type: "select",
        currentValue: "fast",
        category: "mode",
        description: null,
        options: [
          { value: "slow", name: "Slow" },
          { value: "fast", name: "Fast" },
          { value: "balanced", name: "Balanced" },
        ],
      };

      const result = capModelList({ configOptions: [modeOption] });

      expect(result.configOptions.length).toBe(1);
      const processed = result.configOptions[0]!;
      expect(processed.options[0]).toEqual({
        value: "fast",
        name: "Fast",
        description: null,
      });
    });
  });

  describe("config options truncation", () => {
    it("200 model config options → capped to 100, currentValue preserved at front", () => {
      const modelOption: SessionConfigOption = {
        id: "model",
        name: "Model",
        type: "select",
        currentValue: "model-150",
        category: "model",
        description: null,
        options: Array.from({ length: 200 }, (_, i) => ({
          value: `model-${i}`,
          name: `Model ${i}`,
        })),
      };

      const result = capModelList({
        configOptions: [modelOption],
        currentModelId: "model-150",
      });

      expect(result.configOptions.length).toBe(1);
      const processed = result.configOptions[0]!;
      expect(processed.options.length).toBe(100);
      // currentValue should be first (reordered from index 150)
      expect(processed.options[0]).toEqual({
        value: "model-150",
        name: "Model 150",
        description: null,
      });
      expect(result.truncated).toBe(true);
    });

    it("no currentValue → first 100 values only", () => {
      const modelOption: SessionConfigOption = {
        id: "model",
        name: "Model",
        type: "select",
        currentValue: "",
        category: "model",
        description: null,
        options: Array.from({ length: 200 }, (_, i) => ({
          value: `model-${i}`,
          name: `Model ${i}`,
        })),
      };

      const result = capModelList({ configOptions: [modelOption] });

      expect(result.configOptions.length).toBe(1);
      const processed = result.configOptions[0]!;
      expect(processed.options.length).toBe(100);
      // First 100 values in original order
      expect(processed.options[0]).toEqual({
        value: "model-0",
        name: "Model 0",
        description: null,
      });
      expect(processed.options[99]).toEqual({
        value: "model-99",
        name: "Model 99",
        description: null,
      });
      expect(result.truncated).toBe(true);
    });

    it("currentValue in first 100 → <=100, no duplicate, reordered to front", () => {
      const modelOption: SessionConfigOption = {
        id: "model",
        name: "Model",
        type: "select",
        currentValue: "model-50",
        category: "model",
        description: null,
        options: Array.from({ length: 200 }, (_, i) => ({
          value: `model-${i}`,
          name: `Model ${i}`,
        })),
      };

      const result = capModelList({
        configOptions: [modelOption],
        currentModelId: "model-50",
      });

      expect(result.configOptions.length).toBe(1);
      const processed = result.configOptions[0]!;
      expect(processed.options.length).toBe(100);
      // currentValue moved to front from index 50
      expect(processed.options[0]).toEqual({
        value: "model-50",
        name: "Model 50",
        description: null,
      });
      // No duplicate values
      const values = processed.options.map(
        (o: { value?: string }) => o.value
      );
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(100);
      expect(result.truncated).toBe(true);
    });

    it("maxVisible=0 → empty options for model config option", () => {
      const modelOption: SessionConfigOption = {
        id: "model",
        name: "Model",
        type: "select",
        currentValue: "model-5",
        category: "model",
        description: null,
        options: Array.from({ length: 10 }, (_, i) => ({
          value: `model-${i}`,
          name: `Model ${i}`,
        })),
      };

      const result = capModelList({
        configOptions: [modelOption],
        maxVisible: 0,
      });

      expect(result.configOptions.length).toBe(1);
      const processed = result.configOptions[0]!;
      // maxVisible=0 → prefer empty (currentValue is not preserved)
      expect(processed.options.length).toBe(0);
      expect(result.truncated).toBe(true);
    });

    it("200 nested grouped model options → flattened and capped to 100", () => {
      const groupA = {
        group: "Provider A",
        name: "Provider A",
        options: Array.from({ length: 100 }, (_, i) => ({
          value: `model-a-${i}`,
          name: `Provider A Model ${i}`,
        })),
      };
      const groupB = {
        group: "Provider B",
        name: "Provider B",
        options: Array.from({ length: 100 }, (_, i) => ({
          value: `model-b-${i}`,
          name: `Provider B Model ${i}`,
        })),
      };
      const modelOption: SessionConfigOption = {
        id: "model",
        name: "Model",
        type: "select",
        currentValue: "model-b-50",
        category: "model",
        description: null,
        options: [groupA, groupB],
      };

      const result = capModelList({
        configOptions: [modelOption],
        currentModelId: "model-b-50",
      });

      expect(result.configOptions.length).toBe(1);
      const processed = result.configOptions[0]!;
      // 200 total → capped to 100
      expect(processed.options.length).toBe(100);
      // currentValue from group B should be first
      expect(processed.options[0]).toEqual({
        value: "model-b-50",
        name: "Provider B Model 50",
        description: null,
      });
      // All options should be flat (value/name/description), no group objects
      for (const opt of processed.options) {
        expect(opt).toHaveProperty("value");
        expect(typeof (opt as { value?: string }).value).toBe("string");
      }
      expect(result.truncated).toBe(true);
    });

    it("config options below maxVisible → no truncation", () => {
      const modelOption: SessionConfigOption = {
        id: "model",
        name: "Model",
        type: "select",
        currentValue: "model-5",
        category: "model",
        description: null,
        options: Array.from({ length: 50 }, (_, i) => ({
          value: `model-${i}`,
          name: `Model ${i}`,
        })),
      };

      const result = capModelList({ configOptions: [modelOption] });

      expect(result.configOptions.length).toBe(1);
      const processed = result.configOptions[0]!;
      expect(processed.options.length).toBe(50);
      expect(result.truncated).toBe(false);
    });

    it("truncated flag is true when configOptions truncated but models not", () => {
      // No models to truncate, but config options exceed cap
      const modelOption: SessionConfigOption = {
        id: "model",
        name: "Model",
        type: "select",
        currentValue: "",
        category: "model",
        description: null,
        options: Array.from({ length: 200 }, (_, i) => ({
          value: `model-${i}`,
          name: `Model ${i}`,
        })),
      };

      const result = capModelList({
        models: null,
        configOptions: [modelOption],
      });

      // Models not truncated (null), but configOptions were truncated
      expect(result.truncated).toBe(true);
      expect(result.truncatedCount).toBe(0); // models count stays 0
    });
  });

  describe("no mutation of inputs", () => {
    it("should not mutate the input models array", () => {
      const models = [
        makeModel("model-0"),
        makeModel("model-1"),
        makeModel("model-2"),
      ];
      const originalFirst = models[0]!;
      const originalSecond = models[1]!;
      const originalThird = models[2]!;

      capModelList({ models, maxVisible: 2 });

      expect(models[0]).toBe(originalFirst);
      expect(models[1]).toBe(originalSecond);
      expect(models[2]).toBe(originalThird);
    });

    it("should not mutate the input configOptions array", () => {
      const configOptions: SessionConfigOption[] = [
        makeModelOption("model", "model-1", [
          { value: "model-0" },
          { value: "model-1" },
          { value: "model-2" },
        ]),
      ];
      const originalId = configOptions[0]!.id;
      const originalCurrentValue = configOptions[0]!.currentValue;

      capModelList({ configOptions, maxVisible: 2 });

      expect(configOptions[0]!.id).toBe(originalId);
      expect(configOptions[0]!.currentValue).toBe(originalCurrentValue);
    });
  });

  describe("default maxVisible", () => {
    it("should use DEFAULT_MAX_VISIBLE_MODEL_COUNT when maxVisible not provided", () => {
      const models = Array.from({ length: 200 }, (_, i) =>
        makeModel(`model-${i}`)
      );

      const result = capModelList({ models });

      expect(result.models.length).toBe(100);
      expect(result.truncated).toBe(true);
      expect(result.truncatedCount).toBe(100);
    });
  });
});

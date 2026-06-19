import { describe, expect, test } from "bun:test";
import {
  createSessionResumeResponse,
  createSessionStartResponse,
} from "./session-router-data";

describe("createSessionStartResponse", () => {
  test("maps session start result to the client response with transport defaults", () => {
    expect(
      createSessionStartResponse({
        id: "chat-1",
        chatStatus: "ready",
        modes: {
          currentModeId: "default",
          availableModes: [{ id: "default", name: "Default" }],
        },
        promptCapabilities: { image: true },
      })
    ).toEqual({
      chatId: "chat-1",
      sessionId: undefined,
      sessionLoadMethod: null,
      chatStatus: "ready",
      modes: {
        currentModeId: "default",
        availableModes: [{ id: "default", name: "Default" }],
      },
      models: undefined,
      configOptions: null,
      sessionInfo: null,
      promptCapabilities: { image: true },
      loadSessionSupported: false,
      agentInfo: null,
    });
  });

  test("preserves session load metadata when provided", () => {
    expect(
      createSessionStartResponse({
        id: "chat-loaded",
        sessionId: "agent-session-1",
        sessionLoadMethod: "session_load",
        chatStatus: "ready",
        sessionInfo: {
          title: "Loaded session",
          updatedAt: "2026-06-17T00:00:00.000Z",
        },
        loadSessionSupported: true,
        agentInfo: { name: "Codex", version: "1.0.0" },
      })
    ).toMatchObject({
      chatId: "chat-loaded",
      sessionId: "agent-session-1",
      sessionLoadMethod: "session_load",
      sessionInfo: {
        title: "Loaded session",
        updatedAt: "2026-06-17T00:00:00.000Z",
      },
      loadSessionSupported: true,
      agentInfo: { name: "Codex", version: "1.0.0" },
    });
  });

  test("strips available model payloads and model config options for OpenCode clients", () => {
    const response = createSessionStartResponse({
      id: "chat-opencode",
      chatStatus: "ready",
      agentInfo: { name: "OpenCode", version: "1.0.0" },
      models: {
        currentModelId: "model-2",
        availableModels: [
          { modelId: "model-1", name: "Model 1" },
          { modelId: "model-2", name: "Model 2" },
        ],
      },
      configOptions: [
        {
          id: "model",
          name: "Model",
          type: "select",
          category: "model",
          currentValue: "model-2",
          options: [
            { value: "model-1", name: "Model 1" },
            { value: "model-2", name: "Model 2" },
          ],
        },
        {
          id: "approval",
          name: "Approval",
          type: "select",
          currentValue: "auto",
          options: [{ value: "auto", name: "Auto" }],
        },
      ],
    });

    expect(response.models).toEqual({
      currentModelId: "model-2",
      availableModels: [],
    });
    expect(response.configOptions).toEqual([
      {
        id: "approval",
        name: "Approval",
        type: "select",
        currentValue: "auto",
        options: [{ value: "auto", name: "Auto" }],
      },
    ]);
  });
});

describe("createSessionResumeResponse", () => {
  test("uses canonical post-resume session selection state", () => {
    const staleModels = {
      currentModelId: "old-model",
      availableModels: [{ modelId: "old-model", name: "Old Model" }],
    };
    const latestModels = {
      currentModelId: "new-model",
      availableModels: [{ modelId: "new-model", name: "New Model" }],
    };
    const staleConfigOptions = [
      {
        id: "model",
        name: "Model",
        type: "select" as const,
        currentValue: "old-model",
        options: [{ value: "old-model", name: "Old Model" }],
      },
    ];
    const latestConfigOptions = [
      {
        id: "model",
        name: "Model",
        type: "select" as const,
        currentValue: "new-model",
        options: [{ value: "new-model", name: "New Model" }],
      },
    ];

    expect(
      createSessionResumeResponse(
        {
          ok: true,
          alreadyRunning: false,
          chatId: "chat-1",
          sessionLoadMethod: "session_load" as const,
          models: staleModels,
          configOptions: staleConfigOptions,
          loadSessionSupported: true,
        },
        {
          models: latestModels,
          configOptions: latestConfigOptions,
        }
      )
    ).toEqual({
      ok: true,
      alreadyRunning: false,
      chatId: "chat-1",
      sessionLoadMethod: "session_load",
      models: latestModels,
      configOptions: latestConfigOptions,
      loadSessionSupported: true,
    });
  });

  test("preserves null canonical selection values for stopped or unavailable selection state", () => {
    expect(
      createSessionResumeResponse(
        {
          ok: true,
          alreadyRunning: true,
          sessionLoadMethod: null,
          models: {
            currentModelId: "old-model",
            availableModels: [{ modelId: "old-model", name: "Old Model" }],
          },
          configOptions: [],
        },
        { models: null, configOptions: null }
      )
    ).toEqual({
      ok: true,
      alreadyRunning: true,
      sessionLoadMethod: null,
      models: null,
      configOptions: null,
    });
  });
});

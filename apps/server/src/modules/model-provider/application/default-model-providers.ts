import type {
  ModelProviderFormat,
  ModelProviderSeed,
  ModelSupportedFormats,
} from "./contracts/model-provider.contract";

const GLM_MODELS = [
  "glm-5v-turbo",
  "glm-5.1",
  "glm-5-turbo",
  "glm-5",
  "glm-4.7",
  "glm-4.7-flash",
  "glm-4.6",
  "glm-4.5-air",
];

function formatsForModels(
  models: string[],
  formats: ModelProviderFormat[]
): ModelSupportedFormats {
  return Object.fromEntries(models.map((model) => [model, formats]));
}

export const DEFAULT_MODEL_PROVIDERS: ModelProviderSeed[] = [
  {
    id: "builtin:bigmodel-coding-plan",
    name: "Bigmodel - Coding Plan",
    endpoints: {
      anthropic: "https://open.bigmodel.cn/api/anthropic",
      openai: "https://open.bigmodel.cn/api/coding/paas/v4",
      gemini: "",
    },
    models: GLM_MODELS,
    modelSupportedFormats: formatsForModels(GLM_MODELS, [
      "anthropic",
      "openai",
    ]),
    providerMappings: {
      claude: {
        haiku: "glm-4.5-air",
        sonnet: "glm-4.7",
        opus: "glm-5.1",
        reasoning: "glm-4.7",
      },
    },
    source: "default",
    enabled: true,
  },
  {
    id: "builtin:zai-coding-plan",
    name: "Z.AI - Coding Plan",
    endpoints: {
      anthropic: "https://api.z.ai/api/anthropic",
      openai: "https://api.z.ai/api/coding/paas/v4",
      gemini: "",
    },
    models: GLM_MODELS,
    modelSupportedFormats: formatsForModels(GLM_MODELS, [
      "anthropic",
      "openai",
    ]),
    providerMappings: {
      claude: {
        haiku: "glm-4.7-flash",
        sonnet: "glm-4.7",
        opus: "glm-5.1",
        reasoning: "glm-4.7",
      },
    },
    source: "default",
    enabled: true,
  },
  {
    id: "builtin:bigmodel",
    name: "Bigmodel - API Key",
    endpoints: {
      anthropic: "https://open.bigmodel.cn/api/anthropic",
      openai: "https://open.bigmodel.cn/api/coding/paas/v4",
      gemini: "",
    },
    models: GLM_MODELS.filter((model) => model !== "glm-5v-turbo"),
    modelSupportedFormats: formatsForModels(
      GLM_MODELS.filter((model) => model !== "glm-5v-turbo"),
      ["anthropic", "openai"]
    ),
    providerMappings: {
      claude: {
        haiku: "glm-4.5-air",
        sonnet: "glm-4.7",
        opus: "glm-5.1",
        reasoning: "glm-4.7",
      },
    },
    source: "default",
    enabled: true,
  },
  {
    id: "builtin:zai",
    name: "Z.AI - API Key",
    endpoints: {
      anthropic: "https://api.z.ai/api/anthropic",
      openai: "https://api.z.ai/api/coding/paas/v4",
      gemini: "",
    },
    models: [
      "glm-5-turbo",
      "glm-5",
      "glm-5.1",
      "glm-4.7",
      "glm-4.7-flash",
      "glm-4.6",
      "glm-4.5-air",
    ],
    modelSupportedFormats: formatsForModels(
      [
        "glm-5-turbo",
        "glm-5",
        "glm-5.1",
        "glm-4.7",
        "glm-4.7-flash",
        "glm-4.6",
        "glm-4.5-air",
      ],
      ["anthropic", "openai"]
    ),
    providerMappings: {
      claude: {
        haiku: "glm-4.7-flash",
        sonnet: "glm-4.7",
        opus: "glm-5.1",
        reasoning: "glm-4.7",
      },
    },
    source: "default",
    enabled: true,
  },
  {
    id: "builtin:zapi",
    name: "ZAPI",
    endpoints: {
      anthropic: "http://192.168.6.166:8080",
      openai: "http://192.168.6.166:8080/v1",
      gemini: "",
    },
    models: [],
    modelSupportedFormats: {},
    providerMappings: {},
    source: "default",
    enabled: true,
  },
  {
    id: "default-openrouter",
    name: "openrouter",
    endpoints: {
      anthropic: "https://openrouter.ai/api/v1/chat/completions",
      openai: "https://openrouter.ai/api/v1",
      gemini: "",
    },
    apiKeyUrl: "https://openrouter.ai/workspaces/default/keys",
    models: [
      "anthropic/claude-sonnet-4.6",
      "z-ai/glm-5.1",
      "z-ai/glm-5v-turbo",
      "openai/gpt-5.4",
      "openai/gpt-5.3-codex",
      "anthropic/claude-opus-4.7",
      "anthropic/claude-opus-4.6-fast",
      "xiaomi/mimo-v2-pro",
      "google/gemini-3.1-pro-preview",
      "x-ai/grok-4.20-multi-agent",
      "x-ai/grok-4.20",
      "x-ai/grok-4.1-fast",
      "qwen/qwen3.6-plus",
      "moonshotai/kimi-k2.6",
      "minimax/minimax-m2.7",
      "z-ai/glm-5-turbo",
      "z-ai/glm-5",
      "z-ai/glm-4.7",
      "z-ai/glm-4.7-flash",
      "anthropic/claude-opus-4.6",
      "anthropic/claude-haiku-4.5",
      "google/gemini-3-pro-preview",
      "google/gemini-3-flash-preview",
      "x-ai/grok-code-fast-1",
      "deepseek/deepseek-v3.2",
    ],
    modelSupportedFormats: {},
    providerMappings: {},
    source: "default",
    enabled: true,
  },
  {
    id: "default-moonshot",
    name: "moonshot",
    endpoints: {
      anthropic: "https://api.moonshot.cn/anthropic",
      openai: "https://api.moonshot.cn/v1",
      gemini: "",
    },
    apiKeyUrl: "https://platform.moonshot.cn/console/api-keys",
    models: ["kimi-k2.6", "kimi-k2.5", "kimi-k2-turbo-preview"],
    modelSupportedFormats: {},
    providerMappings: {
      claude: {
        haiku: "kimi-k2-turbo-preview",
        sonnet: "kimi-k2.5",
        opus: "kimi-k2.6",
        reasoning: "kimi-k2-turbo-preview",
      },
    },
    source: "default",
    enabled: true,
  },
  {
    id: "default-minimax",
    name: "minimax",
    endpoints: {
      anthropic: "https://api.minimax.io/anthropic",
      openai: "https://api.minimax.io/v1",
      gemini: "",
    },
    apiKeyUrl:
      "https://platform.minimax.io/user-center/basic-information/interface-key",
    models: [
      "MiniMax-M2.7",
      "MiniMax-M2.7-highspeed",
      "MiniMax-M2.5",
      "MiniMax-M2.5-highspeed",
      "MiniMax-M3",
    ],
    modelSupportedFormats: {},
    providerMappings: {
      claude: {
        haiku: "MiniMax-M2.7",
        sonnet: "MiniMax-M2.7",
        opus: "MiniMax-M3",
        reasoning: "",
      },
    },
    source: "default",
    enabled: true,
  },
  {
    id: "default-deepseek",
    name: "deepseek",
    endpoints: {
      anthropic: "https://api.deepseek.com/anthropic",
      openai: "https://api.deepseek.com",
      gemini: "",
    },
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    models: ["deepseek-v3.2", "deepseek-chat"],
    modelSupportedFormats: {},
    providerMappings: {},
    source: "default",
    enabled: true,
  },
  {
    id: "default-mimo",
    name: "mimo",
    endpoints: {
      anthropic: "https://api.xiaomimimo.com/anthropic",
      openai: "https://api.xiaomimimo.com/v1",
      gemini: "",
    },
    apiKeyUrl: "https://platform.xiaomimimo.com/#/console/api-keys",
    models: ["mimo-v2-pro"],
    modelSupportedFormats: {},
    providerMappings: {},
    source: "default",
    enabled: true,
  },
  {
    id: "default-qwen",
    name: "Qwen",
    endpoints: {
      anthropic: "https://dashscope.aliyuncs.com/apps/anthropic",
      openai: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      gemini: "",
    },
    apiKeyUrl:
      "https://bailian.console.aliyun.com/cn-beijing?tab=model#/api-key",
    models: ["Qwen3.6-Plus", "Qwen3.5-Plus", "Qwen3.5-Flash", "Qwen3-Max"],
    modelSupportedFormats: {},
    providerMappings: {
      claude: {
        haiku: "Qwen3.5-Flash",
        sonnet: "Qwen3.5-Plus",
        opus: "Qwen3.6-Plus",
        reasoning: "Qwen3.5-Plus",
      },
    },
    source: "default",
    enabled: true,
  },
];

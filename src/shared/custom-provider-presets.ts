import type { CustomProviderModel } from "./custom-providers"

export interface CustomProviderPreset {
  id: string
  label: string
  baseUrl: string
  models: readonly CustomProviderModel[]
  hint?: string
  contextWindow?: number
  defaultApiKey?: string
}

export const CUSTOM_PROVIDER_PRESETS: readonly CustomProviderPreset[] = [
  {
    id: "glm",
    label: "GLM (Z.AI)",
    baseUrl: "https://api.z.ai/api/anthropic",
    models: [
      { id: "glm-5.3", label: "GLM-5.3" },
      { id: "glm-5.3-flash", label: "GLM-5.3 Flash" },
    ],
  },
  {
    id: "qwen",
    label: "Qwen (Alibaba Model Studio)",
    baseUrl: "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic",
    models: [
      { id: "qwen3.7-plus", label: "Qwen3.7 Plus" },
      { id: "qwen3.7-max", label: "Qwen3.7 Max" },
    ],
    hint: "Coding Plan endpoint. Pay-as-you-go uses https://{WorkspaceId}.<region>.maas.aliyuncs.com/apps/anthropic.",
  },
  {
    id: "kimi",
    label: "Kimi (Moonshot)",
    baseUrl: "https://api.moonshot.ai/anthropic",
    models: [
      { id: "kimi-k3", label: "Kimi K3" },
      { id: "kimi-k2.7-code", label: "Kimi K2.7 Code" },
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/anthropic",
    models: [
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
      { id: "deepseek-flash", label: "DeepSeek Flash" },
    ],
  },
  {
    id: "minimax",
    label: "MiniMax",
    baseUrl: "https://api.minimax.io/anthropic",
    models: [{ id: "MiniMax-M3.1", label: "MiniMax M3.1" }],
    hint: "Mainland China: https://api.minimaxi.com/anthropic",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    baseUrl: "http://localhost:11434",
    models: [],
    contextWindow: 65536,
    defaultApiKey: "ollama",
    hint: "Runs on this machine. Ollama ignores the API key, so any value works. Add the exact model names from `ollama list`, and set Context window to your OLLAMA_CONTEXT_LENGTH.",
  },
]

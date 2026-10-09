import { loadOAuthCredentials } from "../../../lib/oauth";
import {
  DEFAULT_RESPONSE_START_TIMEOUT_SECONDS,
  normalizeResponseStartTimeoutSeconds,
} from "../../../lib/request-timeout";

export type ThinkingLevel = "none" | "low" | "medium" | "high";

export interface ByokProviderConfig {
  mode: "byok";
  provider: string;
  apiKey: string;
  model: string;
  useProxy: boolean;
  proxyUrl: string;
  thinking: ThinkingLevel;
  followMode: boolean;
  authMethod?: "apikey" | "oauth";
  apiType?: string;
  customBaseUrl?: string;
  responseStartTimeoutSeconds: number;
}

export interface GatewayProviderConfig {
  mode: "gateway";
  gatewayUrl: string;
  model: string;
  thinking: ThinkingLevel;
  followMode: boolean;
  responseStartTimeoutSeconds: number;
}

export type ProviderConfig = ByokProviderConfig | GatewayProviderConfig;

export const APP_MODE: ProviderConfig["mode"] = __OPENEXCEL_MODE__;

export const API_TYPES = [
  {
    id: "openai-completions",
    name: "OpenAI Completions",
    hint: "Most compatible — Ollama, vLLM, LMStudio, etc.",
  },
  {
    id: "openai-responses",
    name: "OpenAI Responses",
    hint: "Newer OpenAI API format",
  },
  { id: "anthropic-messages", name: "Anthropic Messages", hint: "Claude API" },
  {
    id: "google-generative-ai",
    name: "Google Generative AI",
    hint: "Gemini API",
  },
  {
    id: "azure-openai-responses",
    name: "Azure OpenAI Responses",
    hint: "Azure-hosted OpenAI",
  },
  {
    id: "openai-codex-responses",
    name: "OpenAI Codex Responses",
    hint: "ChatGPT subscription models",
  },
  {
    id: "google-gemini-cli",
    name: "Google Gemini CLI",
    hint: "Cloud Code Assist",
  },
  { id: "google-vertex", name: "Google Vertex AI", hint: "Vertex AI endpoint" },
] as const;

const BYOK_STORAGE_KEY = "openexcel-provider-config";
const GATEWAY_STORAGE_KEY = "openexcel-gateway-config";

function parseThinkingLevel(value: unknown): ThinkingLevel {
  return value === "low" || value === "medium" || value === "high" ? value : "none";
}

export function loadSavedConfig(): ProviderConfig | null {
  try {
    const storageKey = APP_MODE === "gateway" ? GATEWAY_STORAGE_KEY : BYOK_STORAGE_KEY;
    const saved = localStorage.getItem(storageKey);
    if (!saved) return null;

    const parsed = JSON.parse(saved) as Record<string, unknown>;

    if (APP_MODE === "gateway") {
      return {
        mode: "gateway",
        gatewayUrl: typeof parsed.gatewayUrl === "string" ? parsed.gatewayUrl : "",
        model: typeof parsed.model === "string" ? parsed.model : "",
        thinking: parseThinkingLevel(parsed.thinking),
        followMode: typeof parsed.followMode === "boolean" ? parsed.followMode : true,
        responseStartTimeoutSeconds: normalizeResponseStartTimeoutSeconds(
          parsed.responseStartTimeoutSeconds ?? DEFAULT_RESPONSE_START_TIMEOUT_SECONDS,
        ),
      };
    }

    const provider = typeof parsed.provider === "string" ? parsed.provider : "";
    const authMethod = parsed.authMethod === "oauth" ? "oauth" : "apikey";
    let apiKey = typeof parsed.apiKey === "string" ? parsed.apiKey : "";
    if (authMethod === "oauth" && provider) {
      const creds = loadOAuthCredentials(provider);
      if (creds) apiKey = creds.access;
    }

    return {
      mode: "byok",
      provider,
      apiKey,
      model: typeof parsed.model === "string" ? parsed.model : "",
      useProxy: parsed.useProxy !== false,
      proxyUrl: typeof parsed.proxyUrl === "string" ? parsed.proxyUrl : "",
      thinking: parseThinkingLevel(parsed.thinking),
      followMode: typeof parsed.followMode === "boolean" ? parsed.followMode : true,
      authMethod,
      apiType: typeof parsed.apiType === "string" ? parsed.apiType : "openai-completions",
      customBaseUrl: typeof parsed.customBaseUrl === "string" ? parsed.customBaseUrl : "",
      responseStartTimeoutSeconds: normalizeResponseStartTimeoutSeconds(
        parsed.responseStartTimeoutSeconds ?? DEFAULT_RESPONSE_START_TIMEOUT_SECONDS,
      ),
    };
  } catch {
    return null;
  }
}

export function saveConfig(config: ProviderConfig): void {
  const storageKey = config.mode === "gateway" ? GATEWAY_STORAGE_KEY : BYOK_STORAGE_KEY;
  localStorage.setItem(storageKey, JSON.stringify(config));
}

export function isConfigReady(config: ProviderConfig | null): config is ProviderConfig {
  if (!config?.model) return false;
  if (config.mode === "gateway") return config.gatewayUrl.trim().length > 0;
  if (config.provider === "custom") {
    return Boolean(config.apiType?.trim() && config.customBaseUrl?.trim());
  }
  return config.provider.trim().length > 0 && config.apiKey.trim().length > 0;
}

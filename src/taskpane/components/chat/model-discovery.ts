import { getModel, getModels, type Model } from "@mariozechner/pi-ai";
import type { ByokProviderConfig, GatewayProviderConfig, ProviderConfig } from "./config";

export interface DiscoveredModel {
  id: string;
  name: string;
  contextWindow?: number;
  maxTokens?: number;
}

export interface ModelDiscoveryResult {
  models: DiscoveredModel[];
  source: "live" | "fallback";
  message?: string;
}

type JsonRecord = Record<string, unknown>;

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const GATEWAY_COMPAT_API_KEY = "openexcel-gateway-no-auth";

const DEFAULT_API_PREFERENCE = [
  "openai-responses",
  "openai-completions",
  "anthropic-messages",
  "google-generative-ai",
  "mistral-conversations",
];

const PROVIDER_API_PREFERENCE: Record<string, string[]> = {
  openai: ["openai-responses", "openai-completions"],
  anthropic: ["anthropic-messages"],
  google: ["google-generative-ai"],
  mistral: ["mistral-conversations", "openai-completions"],
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function normalizeGatewayBaseUrl(value: string): string {
  const trimmed = trimTrailingSlash(value.trim());
  if (!trimmed) return "";
  return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

function applyCorsProxy(url: string, config: ByokProviderConfig): string {
  if (!config.useProxy || !config.proxyUrl.trim()) return url;
  return `${trimTrailingSlash(config.proxyUrl.trim())}/?url=${encodeURIComponent(url)}`;
}

function builtInModels(provider: string): Model<any>[] {
  try {
    return getModels(provider as never) as Model<any>[];
  } catch {
    return [];
  }
}

function builtInModel(provider: string, modelId: string): Model<any> | null {
  try {
    return (getModel(provider as never, modelId as never) as Model<any>) ?? null;
  } catch {
    return null;
  }
}

function providerTemplate(provider: string): Model<any> | null {
  const models = builtInModels(provider);
  const preferredApis = PROVIDER_API_PREFERENCE[provider] ?? DEFAULT_API_PREFERENCE;

  for (const api of preferredApis) {
    const match = models.find((model) => model.api === api);
    if (match) return match;
  }

  return models[0] ?? null;
}

function fallbackModels(provider: string): ModelDiscoveryResult {
  const models = builtInModels(provider).map((model) => ({ id: model.id, name: model.name }));
  return {
    models,
    source: "fallback",
    message: "This provider does not expose a compatible live model-list endpoint here. Using the built-in catalog.",
  };
}

function isClearlyUnsupportedModel(id: string, name: string): boolean {
  const value = `${id} ${name}`.toLowerCase();
  return [
    "embedding",
    "embed-",
    "moderation",
    "whisper",
    "transcrib",
    "text-to-speech",
    "tts-",
    "dall-e",
    "image-generation",
  ].some((token) => value.includes(token));
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" ? (value as JsonRecord) : null;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseOpenAICompatibleModels(payload: unknown, filterUnsupported = true): DiscoveredModel[] {
  const root = asRecord(payload);
  const data = Array.isArray(root?.data) ? root.data : [];

  return data
    .map((item): DiscoveredModel | null => {
      const record = asRecord(item);
      const id = typeof record?.id === "string" ? record.id : "";
      if (!id) return null;
      const name =
        typeof record?.display_name === "string"
          ? record.display_name
          : typeof record?.name === "string"
            ? record.name
            : id;
      if (filterUnsupported && isClearlyUnsupportedModel(id, name)) return null;
      return {
        id,
        name,
        contextWindow: numberValue(record?.context_window ?? record?.context_length),
        maxTokens: numberValue(record?.max_tokens ?? record?.max_output_tokens),
      };
    })
    .filter((model): model is DiscoveredModel => model !== null);
}

function parseGoogleModels(payload: unknown): DiscoveredModel[] {
  const root = asRecord(payload);
  const models = Array.isArray(root?.models) ? root.models : [];

  return models
    .map((item): DiscoveredModel | null => {
      const record = asRecord(item);
      const rawName = typeof record?.name === "string" ? record.name : "";
      const id = rawName.replace(/^models\//, "");
      if (!id) return null;

      const supportedMethods = Array.isArray(record?.supportedGenerationMethods)
        ? record.supportedGenerationMethods.filter((value): value is string => typeof value === "string")
        : [];
      if (!supportedMethods.includes("generateContent")) return null;

      const name = typeof record?.displayName === "string" ? record.displayName : id;
      if (isClearlyUnsupportedModel(id, name)) return null;

      return {
        id,
        name,
        contextWindow: numberValue(record?.inputTokenLimit),
        maxTokens: numberValue(record?.outputTokenLimit),
      };
    })
    .filter((model): model is DiscoveredModel => model !== null);
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, { method: "GET", headers });
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.text();
      detail = body ? `: ${body.slice(0, 300)}` : "";
    } catch {}
    throw new Error(`Model discovery failed (${response.status} ${response.statusText})${detail}`);
  }
  return response.json();
}

export async function discoverByokModels(config: ByokProviderConfig): Promise<ModelDiscoveryResult> {
  const template = providerTemplate(config.provider);
  if (!template?.baseUrl) return fallbackModels(config.provider);

  const baseUrl = trimTrailingSlash(template.baseUrl);
  let targetUrl = "";
  const headers: Record<string, string> = { Accept: "application/json" };
  let parser: "google" | "openai" = "openai";

  if (config.provider === "google" && template.api === "google-generative-ai") {
    targetUrl = `${baseUrl}/models?key=${encodeURIComponent(config.apiKey)}`;
    parser = "google";
  } else if (config.provider === "anthropic" && template.api === "anthropic-messages") {
    targetUrl = `${baseUrl}/models`;
    headers["anthropic-version"] = "2023-06-01";
    if (config.apiKey.startsWith("sk-ant-oat")) {
      headers.Authorization = `Bearer ${config.apiKey}`;
      headers["anthropic-beta"] = "oauth-2025-04-20";
    } else {
      headers["x-api-key"] = config.apiKey;
    }
  } else if (
    template.api === "openai-completions" ||
    template.api === "openai-responses" ||
    template.api === "mistral-conversations"
  ) {
    targetUrl = `${baseUrl}/models`;
    headers.Authorization = `Bearer ${config.apiKey}`;
  } else {
    return fallbackModels(config.provider);
  }

  const payload = await fetchJson(applyCorsProxy(targetUrl, config), headers);
  const models = parser === "google" ? parseGoogleModels(payload) : parseOpenAICompatibleModels(payload);

  if (models.length === 0) {
    throw new Error("The provider returned no compatible chat models.");
  }

  return { models, source: "live" };
}

export async function discoverGatewayModels(gatewayUrl: string): Promise<ModelDiscoveryResult> {
  const baseUrl = normalizeGatewayBaseUrl(gatewayUrl);
  if (!baseUrl) throw new Error("Enter a Gateway URL first.");

  const payload = await fetchJson(`${baseUrl}/models`, { Accept: "application/json" });
  const models = parseOpenAICompatibleModels(payload, false);
  if (models.length === 0) throw new Error("The Gateway returned no models.");
  return { models, source: "live" };
}

function createUnknownByokModel(config: ByokProviderConfig): Model<any> {
  const template = providerTemplate(config.provider);
  if (!template) throw new Error(`No model template is available for provider ${config.provider}.`);

  return {
    ...template,
    id: config.model,
    name: config.model,
    reasoning: false,
    input: ["text"],
    cost: ZERO_COST,
  } as Model<any>;
}

function createGatewayModel(config: GatewayProviderConfig): Model<any> {
  const baseUrl = normalizeGatewayBaseUrl(config.gatewayUrl);
  if (!baseUrl) throw new Error("Gateway URL is missing.");

  return {
    id: config.model,
    name: config.model,
    api: "openai-completions",
    provider: "openexcel-gateway",
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: ZERO_COST,
    contextWindow: 128000,
    maxTokens: 16384,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: true,
      supportsStrictMode: true,
    },
  } as Model<any>;
}

export function resolveConfiguredModel(config: ProviderConfig): Model<any> {
  if (config.mode === "gateway") return createGatewayModel(config);
  return builtInModel(config.provider, config.model) ?? createUnknownByokModel(config);
}

export function apiKeyForConfig(config: ProviderConfig): string {
  return config.mode === "byok" ? config.apiKey : GATEWAY_COMPAT_API_KEY;
}

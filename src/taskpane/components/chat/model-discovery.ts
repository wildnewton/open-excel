import { getModel, getModels, type Model } from "@earendil-works/pi-ai/compat";
import { buildCorsProxyUrl, createCorsProxyFetch } from "../../../lib/cors-proxy";
import { loadOAuthCredentials, refreshOAuthToken } from "../../../lib/oauth";
import { DEFAULT_RESPONSE_START_TIMEOUT_SECONDS, fetchWithResponseStartTimeout } from "../../../lib/request-timeout";
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

export interface ModelDiscoveryOptions {
  signal?: AbortSignal;
}

type JsonRecord = Record<string, unknown>;

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const GATEWAY_COMPAT_API_KEY = "openexcel-gateway-no-auth";
const CHATGPT_CODEX_MODELS_URL = "https://chatgpt.com/backend-api/codex/models";
const AMBIENT_FETCH_APIS = new Set(["google-generative-ai", "google-vertex"]);

// ChatGPT's Codex model catalog requires the Codex client_version query parameter.
// Keep this isolated so it can be updated when the upstream contract changes; it
// is not a model allowlist and the returned account-scoped catalog remains the
// source of truth. This matches the current stable Codex release line.
const CHATGPT_CODEX_DISCOVERY_CLIENT_VERSION = "0.162.0";

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

class ModelDiscoveryHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ModelDiscoveryHttpError";
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function normalizeGatewayBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Gateway URL must be a valid absolute HTTP or HTTPS URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Gateway URL must use HTTP or HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Gateway URL must not contain embedded credentials.");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("Gateway URL must not contain a query string or fragment.");
  }

  const pathname = trimTrailingSlash(parsed.pathname);
  parsed.pathname = /\/v1$/i.test(pathname) ? pathname : `${pathname}/v1`;
  return parsed.toString();
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

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function decodeJwtPayload(token: string): JsonRecord | null {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) return null;

  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return asRecord(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

function extractChatGptAccountId(accessToken: string): string | undefined {
  const claims = decodeJwtPayload(accessToken);
  if (!claims) return undefined;

  const direct = stringValue(claims.chatgpt_account_id);
  if (direct) return direct;

  const authClaims = asRecord(claims["https://api.openai.com/auth"]);
  return stringValue(authClaims?.chatgpt_account_id);
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

function parseChatGptCodexModels(payload: unknown): DiscoveredModel[] {
  const root = asRecord(payload);
  const models = Array.isArray(root?.models) ? root.models : [];

  return models
    .map((item): DiscoveredModel | null => {
      const record = asRecord(item);
      if (!record) return null;

      const id = stringValue(record.slug) ?? stringValue(record.id);
      if (!id) return null;

      // In ChatGPT/Codex mode, picker visibility is authoritative. A model can be
      // available to a ChatGPT subscription even when supported_in_api is false.
      const visibility = stringValue(record.visibility);
      if (visibility && visibility !== "list") return null;

      const name = stringValue(record.display_name) ?? stringValue(record.name) ?? id;
      return {
        id,
        name,
        contextWindow: numberValue(record.context_window ?? record.max_context_window),
        maxTokens: numberValue(record.max_tokens ?? record.max_output_tokens),
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

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  responseStartTimeoutSeconds: number = DEFAULT_RESPONSE_START_TIMEOUT_SECONDS,
  signal?: AbortSignal,
  fetchImpl?: typeof globalThis.fetch,
): Promise<unknown> {
  const response = fetchImpl
    ? await fetchImpl(url, { method: "GET", headers, signal })
    : await fetchWithResponseStartTimeout(
        url,
        { method: "GET", headers, signal },
        responseStartTimeoutSeconds,
      );
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.text();
      detail = body ? `: ${body.slice(0, 300)}` : "";
    } catch {}
    throw new ModelDiscoveryHttpError(
      response.status,
      `Model discovery failed (${response.status} ${response.statusText})${detail}`,
    );
  }
  return response.json();
}

function isUnsupportedModelListError(error: unknown): boolean {
  return error instanceof ModelDiscoveryHttpError && [404, 405, 501].includes(error.status);
}

async function configWithFreshOAuthToken(
  config: ByokProviderConfig,
  options: ModelDiscoveryOptions,
): Promise<ByokProviderConfig> {
  if (config.authMethod !== "oauth") return config;

  const stored = loadOAuthCredentials(config.provider);
  if (!stored) throw new Error("OAuth session is no longer available. Please sign in again.");
  if (Date.now() < stored.expires) return { ...config, apiKey: stored.access };

  const refreshed = await refreshOAuthToken(config.provider, stored.refresh, config.proxyUrl, config.useProxy, {
    responseStartTimeoutSeconds: config.responseStartTimeoutSeconds,
    signal: options.signal,
  });
  return { ...config, apiKey: refreshed.access };
}

async function discoverChatGptCodexModels(
  config: ByokProviderConfig,
  options: ModelDiscoveryOptions,
): Promise<ModelDiscoveryResult> {
  if (config.authMethod !== "oauth") {
    throw new Error("OpenAI (ChatGPT) model discovery requires the existing OAuth sign-in flow.");
  }

  const url = `${CHATGPT_CODEX_MODELS_URL}?client_version=${encodeURIComponent(CHATGPT_CODEX_DISCOVERY_CLIENT_VERSION)}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${config.apiKey}`,
    originator: "pi",
    version: CHATGPT_CODEX_DISCOVERY_CLIENT_VERSION,
  };

  const accountId = extractChatGptAccountId(config.apiKey);
  if (accountId) headers["ChatGPT-Account-ID"] = accountId;

  const payload = await fetchJson(
    buildCorsProxyUrl(url, config),
    headers,
    config.responseStartTimeoutSeconds,
    options.signal,
  );
  const models = parseChatGptCodexModels(payload);
  if (models.length === 0) {
    throw new Error("ChatGPT returned no selectable Codex models for this account.");
  }

  return {
    models,
    source: "live",
    message: "Models loaded live from your ChatGPT account.",
  };
}

export async function discoverByokModels(
  config: ByokProviderConfig,
  options: ModelDiscoveryOptions = {},
): Promise<ModelDiscoveryResult> {
  const activeConfig = await configWithFreshOAuthToken(config, options);

  if (activeConfig.provider === "openai-codex") {
    if (activeConfig.authMethod === "oauth") {
      return discoverChatGptCodexModels(activeConfig, options);
    }
    // The account-scoped ChatGPT catalog is OAuth-only. Preserve the existing
    // API-key/manual path rather than forcing API-key users through OAuth.
    return fallbackModels(activeConfig.provider);
  }

  const template = providerTemplate(activeConfig.provider);
  if (!template?.baseUrl) return fallbackModels(activeConfig.provider);

  const baseUrl = trimTrailingSlash(template.baseUrl);
  let targetUrl = "";
  const headers: Record<string, string> = { Accept: "application/json" };
  let parser: "google" | "openai" = "openai";

  if (activeConfig.provider === "google" && template.api === "google-generative-ai") {
    targetUrl = `${baseUrl}/models?key=${encodeURIComponent(activeConfig.apiKey)}`;
    parser = "google";
  } else if (activeConfig.provider === "anthropic" && template.api === "anthropic-messages") {
    targetUrl = `${baseUrl}/models`;
    headers["anthropic-version"] = "2023-06-01";
    if (activeConfig.authMethod === "oauth") {
      headers.Authorization = `Bearer ${activeConfig.apiKey}`;
      headers["anthropic-beta"] = "oauth-2025-04-20";
    } else {
      headers["x-api-key"] = activeConfig.apiKey;
    }
  } else if (
    template.api === "openai-completions" ||
    template.api === "openai-responses" ||
    template.api === "mistral-conversations"
  ) {
    targetUrl = `${baseUrl}/models`;
    headers.Authorization = `Bearer ${activeConfig.apiKey}`;
  } else {
    return fallbackModels(activeConfig.provider);
  }

  let payload: unknown;
  try {
    payload = await fetchJson(
      buildCorsProxyUrl(targetUrl, activeConfig),
      headers,
      activeConfig.responseStartTimeoutSeconds,
      options.signal,
    );
  } catch (error) {
    if (isUnsupportedModelListError(error)) {
      return fallbackModels(activeConfig.provider);
    }
    throw error;
  }

  const models = parser === "google" ? parseGoogleModels(payload) : parseOpenAICompatibleModels(payload);
  if (models.length === 0) {
    throw new Error("The provider returned no compatible chat models.");
  }

  return { models, source: "live" };
}

export async function discoverGatewayModels(
  gatewayUrl: string,
  responseStartTimeoutSeconds: number = DEFAULT_RESPONSE_START_TIMEOUT_SECONDS,
  options: ModelDiscoveryOptions = {},
): Promise<ModelDiscoveryResult> {
  const baseUrl = normalizeGatewayBaseUrl(gatewayUrl);
  if (!baseUrl) throw new Error("Enter a Gateway URL first.");

  const gatewayFetch = createCorsProxyFetch(
    {
      useProxy: false,
      proxyUrl: "",
      responseStartTimeoutSeconds,
    },
    { gatewayEndpoint: true, omitAuthentication: true },
  );
  const payload = await fetchJson(
    `${baseUrl}/models`,
    { Accept: "application/json" },
    responseStartTimeoutSeconds,
    options.signal,
    gatewayFetch,
  );
  const models = parseOpenAICompatibleModels(payload, false);
  if (models.length === 0) throw new Error("The Gateway returned no models.");
  return { models, source: "live" };
}

export function usesAmbientFetchTransport(config: ByokProviderConfig): boolean {
  if (config.provider === "google" || config.provider === "google-vertex") return true;
  return config.provider === "custom" && AMBIENT_FETCH_APIS.has(config.apiType ?? "");
}

export function getRuntimeTransportIssue(config: ByokProviderConfig): string | null {
  if (!usesAmbientFetchTransport(config)) return null;

  if (config.useProxy) {
    return "Google Generative AI / Vertex requires the adapter's native fetch, so runtime CORS proxying is not supported. Turn CORS Proxy off before applying this model.";
  }

  if (config.provider !== "custom") return null;

  if (!config.apiKey.trim()) {
    return "Google Generative AI / Vertex custom endpoints cannot use no-auth mode because the adapter requires its native authenticated transport.";
  }

  try {
    const parsed = new URL(config.customBaseUrl?.trim() || "");
    if (parsed.protocol !== "https:") {
      return "Google Generative AI / Vertex custom endpoints must use direct HTTPS; HTTP/local-bridge transport is not supported by this adapter.";
    }
  } catch {
    return "Google Generative AI / Vertex custom endpoints require a valid absolute HTTPS Base URL.";
  }

  return null;
}

function createCustomByokModel(config: ByokProviderConfig): Model<any> {
  if (!config.apiType?.trim() || !config.customBaseUrl?.trim() || !config.model.trim()) {
    throw new Error("Custom endpoint requires API type, Base URL, and Model ID.");
  }

  return {
    id: config.model,
    name: config.model,
    api: config.apiType as any,
    provider: "custom",
    baseUrl: trimTrailingSlash(config.customBaseUrl.trim()),
    reasoning: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: config.modelContextWindow ?? 128000,
    maxTokens: config.modelMaxTokens ?? 32000,
  } as Model<any>;
}

function createUnknownByokModel(config: ByokProviderConfig): Model<any> {
  const template = providerTemplate(config.provider);
  if (!template) throw new Error(`No model template is available for provider ${config.provider}.`);

  return {
    ...template,
    id: config.model,
    name: config.model,
    reasoning: template.reasoning,
    input: template.input,
    cost: ZERO_COST,
    contextWindow: config.modelContextWindow ?? template.contextWindow,
    maxTokens: config.modelMaxTokens ?? template.maxTokens,
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
    contextWindow: config.modelContextWindow ?? 128000,
    maxTokens: config.modelMaxTokens ?? 16384,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: false,
      supportsStrictMode: false,
    },
  } as Model<any>;
}

export function resolveConfiguredModel(config: ProviderConfig): Model<any> {
  if (config.mode === "gateway") return createGatewayModel(config);

  const transportIssue = getRuntimeTransportIssue(config);
  if (transportIssue) throw new Error(transportIssue);

  if (config.provider === "custom") return createCustomByokModel(config);

  const known = builtInModel(config.provider, config.model);
  if (known) {
    return {
      ...known,
      contextWindow: config.modelContextWindow ?? known.contextWindow,
      maxTokens: config.modelMaxTokens ?? known.maxTokens,
    } as Model<any>;
  }
  return createUnknownByokModel(config);
}

export function apiKeyForConfig(config: ProviderConfig): string {
  return config.mode === "byok" ? config.apiKey : GATEWAY_COMPAT_API_KEY;
}

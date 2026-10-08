import { loadOAuthCredentials } from "../../../lib/oauth";

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
}

export interface GatewayProviderConfig {
  mode: "gateway";
  gatewayUrl: string;
  model: string;
  thinking: ThinkingLevel;
  followMode: boolean;
}

export type ProviderConfig = ByokProviderConfig | GatewayProviderConfig;

export const APP_MODE: ProviderConfig["mode"] = __OPENEXCEL_MODE__;

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
  return config.provider.trim().length > 0 && config.apiKey.trim().length > 0;
}

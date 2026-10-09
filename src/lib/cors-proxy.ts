export interface CorsProxyOptions {
  useProxy: boolean;
  proxyUrl: string;
}

export const LOCAL_CORS_BRIDGE_PATH = "/__openexcel_bridge";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isLocalDevelopmentHost(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

export function buildCorsProxyUrl(targetUrl: string, options: CorsProxyOptions): string {
  if (!options.useProxy) return targetUrl;

  const customProxy = options.proxyUrl.trim();
  if (customProxy) {
    return `${trimTrailingSlash(customProxy)}/?url=${encodeURIComponent(targetUrl)}`;
  }

  if (isLocalDevelopmentHost()) {
    return `${window.location.origin}${LOCAL_CORS_BRIDGE_PATH}?url=${encodeURIComponent(targetUrl)}`;
  }

  return targetUrl;
}

export function isUsingBuiltInLocalBridge(options: CorsProxyOptions): boolean {
  return options.useProxy && !options.proxyUrl.trim() && isLocalDevelopmentHost();
}

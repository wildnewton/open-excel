import { fetchWithResponseStartTimeout, normalizeResponseStartTimeoutSeconds } from "./request-timeout";

export interface CorsProxyOptions {
  useProxy: boolean;
  proxyUrl: string;
  responseStartTimeoutSeconds?: number;
}

export interface CorsProxyFetchBehavior {
  customEndpoint?: boolean;
  omitAuthentication?: boolean;
}

export const LOCAL_CORS_BRIDGE_PATH = "/__openexcel_bridge";
const CUSTOM_ENDPOINT_HEADER = "X-OpenExcel-Custom-Endpoint";
const NO_AUTH_API_KEY = "openexcel-custom-no-auth";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isLocalDevelopmentHost(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

function localBridgeUrl(targetUrl: string, timeoutSeconds: unknown): string {
  const timeoutMs = normalizeResponseStartTimeoutSeconds(timeoutSeconds) * 1000;
  return `${window.location.origin}${LOCAL_CORS_BRIDGE_PATH}?url=${encodeURIComponent(targetUrl)}&timeout_ms=${timeoutMs}`;
}

function isHttpUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "http:";
  } catch {
    return false;
  }
}

function resolveProxyRoute(
  targetUrl: string,
  options: CorsProxyOptions,
  behavior: CorsProxyFetchBehavior = {},
): { url: string; builtInBridge: boolean } {
  if (options.useProxy) {
    const customProxy = options.proxyUrl.trim();
    if (customProxy) {
      return {
        url: `${trimTrailingSlash(customProxy)}/?url=${encodeURIComponent(targetUrl)}`,
        builtInBridge: false,
      };
    }

    if (isLocalDevelopmentHost()) {
      return { url: localBridgeUrl(targetUrl, options.responseStartTimeoutSeconds), builtInBridge: true };
    }
  }

  // Excel's taskpane is HTTPS. A direct HTTP Custom Endpoint request is mixed
  // content and will be blocked before it reaches the server, so route it through
  // our same-origin local bridge automatically. This is not a system proxy.
  if (
    behavior.customEndpoint &&
    isLocalDevelopmentHost() &&
    typeof window !== "undefined" &&
    window.location.protocol === "https:" &&
    isHttpUrl(targetUrl)
  ) {
    return { url: localBridgeUrl(targetUrl, options.responseStartTimeoutSeconds), builtInBridge: true };
  }

  return { url: targetUrl, builtInBridge: false };
}

export function buildCorsProxyUrl(targetUrl: string, options: CorsProxyOptions): string {
  return resolveProxyRoute(targetUrl, options).url;
}

function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export function createCorsProxyFetch(
  options: CorsProxyOptions,
  behavior: CorsProxyFetchBehavior = {},
): typeof globalThis.fetch {
  const proxyFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    let targetUrl = inputUrl(request);
    const headers = new Headers(request.headers);

    if (behavior.omitAuthentication) {
      headers.delete("authorization");
      headers.delete("api-key");
      headers.delete("x-api-key");

      // Some adapters put API keys in the query string rather than headers.
      try {
        const parsed = new URL(targetUrl);
        if (parsed.searchParams.get("key") === NO_AUTH_API_KEY) {
          parsed.searchParams.delete("key");
          targetUrl = parsed.toString();
        }
      } catch {
        // The provider SDK will surface malformed URLs; do not mask that error here.
      }
    }

    const route = resolveProxyRoute(targetUrl, options, behavior);
    if (route.builtInBridge && behavior.customEndpoint) {
      headers.set(CUSTOM_ENDPOINT_HEADER, "1");
    }

    const method = request.method.toUpperCase();
    const body = method === "GET" || method === "HEAD" ? undefined : await request.clone().arrayBuffer();

    return fetchWithResponseStartTimeout(
      route.url,
      {
        method: request.method,
        headers,
        body,
        cache: request.cache,
        credentials: request.credentials,
        integrity: request.integrity,
        keepalive: request.keepalive,
        mode: route.builtInBridge ? "same-origin" : request.mode,
        redirect: request.redirect,
        referrerPolicy: request.referrerPolicy,
        signal: request.signal,
      },
      options.responseStartTimeoutSeconds,
    );
  };

  return proxyFetch as typeof globalThis.fetch;
}

export function isUsingBuiltInLocalBridge(options: CorsProxyOptions): boolean {
  return options.useProxy && !options.proxyUrl.trim() && isLocalDevelopmentHost();
}

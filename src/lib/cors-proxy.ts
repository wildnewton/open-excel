import { createDebugTrace, DEBUG_TRACE_HEADER, debugTrace } from "./debug-trace";
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
export const LOCAL_BRIDGE_RESPONSE_START_GRACE_SECONDS = 10;
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

function requiresAmbientFetch(options: CorsProxyOptions): boolean {
  // pi-ai's Google Generative AI and Google Vertex adapters explicitly reject a
  // custom fetch function. The BYOK config reaches this helper structurally, so
  // use its provider/API hints when present and return the exact ambient fetch.
  const details = options as CorsProxyOptions & { provider?: string; apiType?: string };
  return (
    details.provider === "google" ||
    details.provider === "google-vertex" ||
    details.apiType === "google-generative-ai" ||
    details.apiType === "google-vertex"
  );
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
  if (requiresAmbientFetch(options)) return globalThis.fetch;

  const proxyFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const trace = createDebugTrace();
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
    const routeKind = route.builtInBridge
      ? "local-bridge"
      : options.useProxy && options.proxyUrl.trim()
        ? "external-proxy"
        : "direct";

    if (route.builtInBridge && behavior.customEndpoint) {
      headers.set(CUSTOM_ENDPOINT_HEADER, "1");
    }
    // The trace ID is sent only to OpenExcel's same-origin local bridge. It is
    // explicitly stripped there and is never forwarded to the configured endpoint.
    if (route.builtInBridge && trace) {
      headers.set(DEBUG_TRACE_HEADER, trace.id);
    }

    debugTrace(trace, "client.request-prepared", {
      method: request.method,
      route: routeKind,
    });

    const method = request.method.toUpperCase();
    const body = method === "GET" || method === "HEAD" ? undefined : await request.clone().arrayBuffer();
    debugTrace(trace, "client.body-ready", { bytes: body?.byteLength ?? 0 });

    try {
      debugTrace(trace, "client.fetch-start");
      // The bridge owns the configured upstream-header deadline. Give its 504 a
      // small window to reach the WebView instead of racing an identical client
      // timer. Direct/external-proxy requests keep the configured deadline.
      const clientTimeoutSeconds = route.builtInBridge
        ? normalizeResponseStartTimeoutSeconds(options.responseStartTimeoutSeconds) +
          LOCAL_BRIDGE_RESPONSE_START_GRACE_SECONDS
        : options.responseStartTimeoutSeconds;
      const response = await fetchWithResponseStartTimeout(
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
        clientTimeoutSeconds,
      );
      debugTrace(trace, "client.response-headers", {
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
      });
      return response;
    } catch (error) {
      debugTrace(trace, "client.fetch-error", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  return proxyFetch as typeof globalThis.fetch;
}

export function isUsingBuiltInLocalBridge(options: CorsProxyOptions): boolean {
  return options.useProxy && !options.proxyUrl.trim() && isLocalDevelopmentHost();
}

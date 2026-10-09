from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"Expected pattern not found in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))

# Shared timeout utility.
Path("src/lib/request-timeout.ts").write_text('''export const DEFAULT_RESPONSE_START_TIMEOUT_SECONDS = 180;\nexport const MIN_RESPONSE_START_TIMEOUT_SECONDS = 1;\nexport const MAX_RESPONSE_START_TIMEOUT_SECONDS = 3600;\n\nexport function normalizeResponseStartTimeoutSeconds(value: unknown): number {\n  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;\n  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RESPONSE_START_TIMEOUT_SECONDS;\n  return Math.min(MAX_RESPONSE_START_TIMEOUT_SECONDS, Math.max(MIN_RESPONSE_START_TIMEOUT_SECONDS, Math.round(parsed)));\n}\n\nexport async function fetchWithResponseStartTimeout(\n  input: RequestInfo | URL,\n  init: RequestInit | undefined,\n  timeoutSeconds: unknown,\n  fetchImpl: typeof globalThis.fetch = globalThis.fetch,\n): Promise<Response> {\n  const seconds = normalizeResponseStartTimeoutSeconds(timeoutSeconds);\n  const request = new Request(input, init);\n  const controller = new AbortController();\n  let timedOut = false;\n\n  const abortFromCaller = () => controller.abort();\n  if (request.signal.aborted) {\n    controller.abort();\n  } else {\n    request.signal.addEventListener("abort", abortFromCaller, { once: true });\n  }\n\n  const timer = globalThis.setTimeout(() => {\n    timedOut = true;\n    controller.abort();\n  }, seconds * 1000);\n\n  try {\n    // fetch() resolves when response headers are available. Clearing the timer\n    // immediately after this await means long-running SSE streams are not capped.\n    return await fetchImpl(request, { signal: controller.signal });\n  } catch (error) {\n    if (timedOut) {\n      throw new Error(`Timed out waiting for response to start after ${seconds} seconds`);\n    }\n    throw error;\n  } finally {\n    globalThis.clearTimeout(timer);\n    request.signal.removeEventListener("abort", abortFromCaller);\n  }\n}\n\nexport function createResponseStartTimeoutFetch(timeoutSeconds: unknown): typeof globalThis.fetch {\n  return ((input: RequestInfo | URL, init?: RequestInit) =>\n    fetchWithResponseStartTimeout(input, init, timeoutSeconds)) as typeof globalThis.fetch;\n}\n''')

# Config: persist the parameter in both modes, defaulting old configs to 180s.
replace_once(
    "src/taskpane/components/chat/config.ts",
    'import { loadOAuthCredentials } from "../../../lib/oauth";\n',
    'import { loadOAuthCredentials } from "../../../lib/oauth";\nimport { DEFAULT_RESPONSE_START_TIMEOUT_SECONDS, normalizeResponseStartTimeoutSeconds } from "../../../lib/request-timeout";\n',
)
replace_once(
    "src/taskpane/components/chat/config.ts",
    '  customBaseUrl?: string;\n}',
    '  customBaseUrl?: string;\n  responseStartTimeoutSeconds: number;\n}',
)
replace_once(
    "src/taskpane/components/chat/config.ts",
    '  followMode: boolean;\n}\n\nexport type ProviderConfig',
    '  followMode: boolean;\n  responseStartTimeoutSeconds: number;\n}\n\nexport type ProviderConfig',
)
replace_once(
    "src/taskpane/components/chat/config.ts",
    '        followMode: typeof parsed.followMode === "boolean" ? parsed.followMode : true,\n      };',
    '        followMode: typeof parsed.followMode === "boolean" ? parsed.followMode : true,\n        responseStartTimeoutSeconds: normalizeResponseStartTimeoutSeconds(\n          parsed.responseStartTimeoutSeconds ?? DEFAULT_RESPONSE_START_TIMEOUT_SECONDS,\n        ),\n      };',
)
replace_once(
    "src/taskpane/components/chat/config.ts",
    '      customBaseUrl: typeof parsed.customBaseUrl === "string" ? parsed.customBaseUrl : "",\n    };',
    '      customBaseUrl: typeof parsed.customBaseUrl === "string" ? parsed.customBaseUrl : "",\n      responseStartTimeoutSeconds: normalizeResponseStartTimeoutSeconds(\n        parsed.responseStartTimeoutSeconds ?? DEFAULT_RESPONSE_START_TIMEOUT_SECONDS,\n      ),\n    };',
)

# CORS bridge client: carry timeout to the local bridge and enforce it client-side too.
replace_once(
    "src/lib/cors-proxy.ts",
    'export interface CorsProxyOptions {\n',
    'import { fetchWithResponseStartTimeout, normalizeResponseStartTimeoutSeconds } from "./request-timeout";\n\nexport interface CorsProxyOptions {\n',
)
replace_once(
    "src/lib/cors-proxy.ts",
    '  proxyUrl: string;\n}',
    '  proxyUrl: string;\n  responseStartTimeoutSeconds?: number;\n}',
)
replace_once(
    "src/lib/cors-proxy.ts",
    'function localBridgeUrl(targetUrl: string): string {\n  return `${window.location.origin}${LOCAL_CORS_BRIDGE_PATH}?url=${encodeURIComponent(targetUrl)}`;\n}',
    'function localBridgeUrl(targetUrl: string, timeoutSeconds: unknown): string {\n  const timeoutMs = normalizeResponseStartTimeoutSeconds(timeoutSeconds) * 1000;\n  return `${window.location.origin}${LOCAL_CORS_BRIDGE_PATH}?url=${encodeURIComponent(targetUrl)}&timeout_ms=${timeoutMs}`;\n}',
)
text_path = Path("src/lib/cors-proxy.ts")
text = text_path.read_text().replace('localBridgeUrl(targetUrl)', 'localBridgeUrl(targetUrl, options.responseStartTimeoutSeconds)')
text_path.write_text(text)
replace_once(
    "src/lib/cors-proxy.ts",
    '    return globalThis.fetch(route.url, {\n',
    '    return fetchWithResponseStartTimeout(route.url, {\n',
)
replace_once(
    "src/lib/cors-proxy.ts",
    '      signal: request.signal,\n    });',
    '      signal: request.signal,\n    }, options.responseStartTimeoutSeconds);',
)

# Chat transport: enforce response-start timeout in every mode. Custom Endpoint
# keeps its specialized bridge fetch wrapper.
replace_once(
    "src/taskpane/components/chat/chat-context.tsx",
    'import { buildCorsProxyUrl, createCorsProxyFetch } from "../../../lib/cors-proxy";\n',
    'import { buildCorsProxyUrl, createCorsProxyFetch } from "../../../lib/cors-proxy";\nimport { createResponseStartTimeoutFetch } from "../../../lib/request-timeout";\n',
)
replace_once(
    "src/taskpane/components/chat/chat-context.tsx",
    '          const streamOptions: Record<string, unknown> = { ...options, apiKey };\n\n          if (cfg.mode === "byok" && cfg.provider === "custom") {',
    '          const streamOptions: Record<string, unknown> = {\n            ...options,\n            apiKey,\n            fetch: createResponseStartTimeoutFetch(cfg.responseStartTimeoutSeconds),\n          };\n\n          if (cfg.mode === "byok" && cfg.provider === "custom") {',
)

# Discovery uses the same response-start timeout.
replace_once(
    "src/taskpane/components/chat/model-discovery.ts",
    'import { buildCorsProxyUrl } from "../../../lib/cors-proxy";\n',
    'import { buildCorsProxyUrl } from "../../../lib/cors-proxy";\nimport { DEFAULT_RESPONSE_START_TIMEOUT_SECONDS, fetchWithResponseStartTimeout } from "../../../lib/request-timeout";\n',
)
replace_once(
    "src/taskpane/components/chat/model-discovery.ts",
    'async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {\n  const response = await fetch(url, { method: "GET", headers });',
    'async function fetchJson(\n  url: string,\n  headers: Record<string, string>,\n  responseStartTimeoutSeconds: number = DEFAULT_RESPONSE_START_TIMEOUT_SECONDS,\n): Promise<unknown> {\n  const response = await fetchWithResponseStartTimeout(\n    url,\n    { method: "GET", headers },\n    responseStartTimeoutSeconds,\n  );',
)
# BYOK fetchJson calls.
md = Path("src/taskpane/components/chat/model-discovery.ts")
text = md.read_text()
text = text.replace('fetchJson(buildCorsProxyUrl(url, config), headers);', 'fetchJson(buildCorsProxyUrl(url, config), headers, config.responseStartTimeoutSeconds);')
text = text.replace('fetchJson(buildCorsProxyUrl(targetUrl, config), headers);', 'fetchJson(buildCorsProxyUrl(targetUrl, config), headers, config.responseStartTimeoutSeconds);')
text = text.replace(
    'export async function discoverGatewayModels(gatewayUrl: string): Promise<ModelDiscoveryResult> {',
    'export async function discoverGatewayModels(\n  gatewayUrl: string,\n  responseStartTimeoutSeconds: number = DEFAULT_RESPONSE_START_TIMEOUT_SECONDS,\n): Promise<ModelDiscoveryResult> {',
)
text = text.replace(
    'const payload = await fetchJson(`${baseUrl}/models`, { Accept: "application/json" });',
    'const payload = await fetchJson(\n    `${baseUrl}/models`,\n    { Accept: "application/json" },\n    responseStartTimeoutSeconds,\n  );',
)
md.write_text(text)

# Settings UI and config construction.
replace_once(
    "src/taskpane/components/chat/settings-panel.tsx",
    'import { useChat } from "./chat-context";\n',
    'import { DEFAULT_RESPONSE_START_TIMEOUT_SECONDS } from "../../../lib/request-timeout";\nimport { useChat } from "./chat-context";\n',
)
replace_once(
    "src/taskpane/components/chat/settings-panel.tsx",
    '  const [customBaseUrl, setCustomBaseUrl] = useState(() => savedByok?.customBaseUrl || "");\n',
    '  const [customBaseUrl, setCustomBaseUrl] = useState(() => savedByok?.customBaseUrl || "");\n  const [responseStartTimeoutSeconds, setResponseStartTimeoutSeconds] = useState(\n    () => savedByok?.responseStartTimeoutSeconds ?? DEFAULT_RESPONSE_START_TIMEOUT_SECONDS,\n  );\n',
)
# Insert field into BYOK config construction occurrences (useEffect, discovery, apply custom).
sp = Path("src/taskpane/components/chat/settings-panel.tsx")
text = sp.read_text()
text = text.replace('      customBaseUrl,\n    };', '      customBaseUrl,\n      responseStartTimeoutSeconds,\n    };', 1)
text = text.replace('    customBaseUrl,\n    setProviderConfig,', '    customBaseUrl,\n    responseStartTimeoutSeconds,\n    setProviderConfig,', 1)
text = text.replace('        customBaseUrl,\n      });', '        customBaseUrl,\n        responseStartTimeoutSeconds,\n      });', 1)
text = text.replace('      customBaseUrl: customBaseUrl.trim(),\n    };', '      customBaseUrl: customBaseUrl.trim(),\n      responseStartTimeoutSeconds,\n    };', 1)
text = text.replace(
    '    (!isCustom || (activeConfig.apiType === apiType && activeConfig.customBaseUrl === customBaseUrl));',
    '    activeConfig.responseStartTimeoutSeconds === responseStartTimeoutSeconds &&\n    (!isCustom || (activeConfig.apiType === apiType && activeConfig.customBaseUrl === customBaseUrl));',
    1,
)
# BYOK timeout field before model discovery.
marker = '          {!isCustom && (\n'
byok_timeout_ui = '''          <label className="block">\n            <span className="block text-xs text-(--chat-text-secondary) mb-1.5">Response Start Timeout (seconds)</span>\n            <input\n              type="number"\n              min={1}\n              max={3600}\n              step={1}\n              value={responseStartTimeoutSeconds}\n              onChange={(e) => {\n                const next = Number.parseInt(e.target.value, 10);\n                if (!Number.isFinite(next) || next < 1) return;\n                if (isCustom) clearProviderConfig();\n                setResponseStartTimeoutSeconds(Math.min(3600, next));\n              }}\n              className="w-full bg-(--chat-input-bg) text-(--chat-text-primary) text-sm px-3 py-2 border border-(--chat-border) focus:outline-none focus:border-(--chat-border-active)"\n              style={inputStyle}\n            />\n            <p className="text-[10px] text-(--chat-text-muted) mt-1">\n              Maximum wait for response headers / streaming to start. Default 180 seconds. Once streaming starts, this timeout no longer applies.\n            </p>\n          </label>\n\n'''
if marker not in text:
    raise SystemExit('BYOK model discovery marker not found')
text = text.replace(marker, byok_timeout_ui + marker, 1)
# Gateway state/config/discovery/activation.
text = text.replace(
    '  const [thinking, setThinking] = useState<ThinkingLevel>(() => savedGateway?.thinking || "none");\n',
    '  const [thinking, setThinking] = useState<ThinkingLevel>(() => savedGateway?.thinking || "none");\n  const [responseStartTimeoutSeconds, setResponseStartTimeoutSeconds] = useState(\n    () => savedGateway?.responseStartTimeoutSeconds ?? DEFAULT_RESPONSE_START_TIMEOUT_SECONDS,\n  );\n',
    1,
)
text = text.replace(
    '      followMode,\n    };\n    if (gatewayUrl || model)',
    '      followMode,\n      responseStartTimeoutSeconds,\n    };\n    if (gatewayUrl || model)',
    1,
)
text = text.replace(
    '  }, [gatewayUrl, model, thinking, followMode, setProviderConfig]);',
    '  }, [gatewayUrl, model, thinking, followMode, responseStartTimeoutSeconds, setProviderConfig]);',
    1,
)
text = text.replace(
    '      const result = await discoverGatewayModels(gatewayUrl);',
    '      const result = await discoverGatewayModels(gatewayUrl, responseStartTimeoutSeconds);',
    1,
)
text = text.replace(
    '    activeConfig?.mode === "gateway" && activeConfig.gatewayUrl === gatewayUrl.trim() && activeConfig.model === model;',
    '    activeConfig?.mode === "gateway" &&\n    activeConfig.gatewayUrl === gatewayUrl.trim() &&\n    activeConfig.model === model &&\n    activeConfig.responseStartTimeoutSeconds === responseStartTimeoutSeconds;',
    1,
)
gateway_thinking = '          <ThinkingSelector value={thinking} onChange={setThinking} />\n'
gateway_timeout_ui = '''          <label className="block">\n            <span className="block text-xs text-(--chat-text-secondary) mb-1.5">Response Start Timeout (seconds)</span>\n            <input\n              type="number"\n              min={1}\n              max={3600}\n              step={1}\n              value={responseStartTimeoutSeconds}\n              onChange={(e) => {\n                const next = Number.parseInt(e.target.value, 10);\n                if (!Number.isFinite(next) || next < 1) return;\n                setResponseStartTimeoutSeconds(Math.min(3600, next));\n              }}\n              className="w-full bg-(--chat-input-bg) text-(--chat-text-primary) text-sm px-3 py-2 border border-(--chat-border) focus:outline-none focus:border-(--chat-border-active)"\n              style={inputStyle}\n            />\n            <p className="text-[10px] text-(--chat-text-muted) mt-1">\n              Maximum wait for response headers / streaming to start. Default 180 seconds. Once streaming starts, this timeout no longer applies.\n            </p>\n          </label>\n\n'''
if gateway_thinking not in text:
    raise SystemExit('Gateway thinking selector marker not found')
text = text.replace(gateway_thinking, gateway_timeout_ui + gateway_thinking, 1)
sp.write_text(text)

# Local Node bridge: default 3 minutes, per-request override from the UI.
replace_once(
    "scripts/local-cors-bridge.js",
    'const UPSTREAM_HEADER_TIMEOUT_MS = 60000;\n',
    'const DEFAULT_UPSTREAM_HEADER_TIMEOUT_MS = 180000;\nconst MIN_UPSTREAM_HEADER_TIMEOUT_MS = 1000;\nconst MAX_UPSTREAM_HEADER_TIMEOUT_MS = 3600000;\n',
)
insert_after = '''function createRequestId() {\n  return Math.random().toString(36).slice(2, 8);\n}\n'''
insert_timeout = insert_after + '''\nfunction parseUpstreamHeaderTimeoutMs(requestUrl) {\n  const raw = Number.parseInt(requestUrl.searchParams.get("timeout_ms") || "", 10);\n  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_UPSTREAM_HEADER_TIMEOUT_MS;\n  return Math.min(MAX_UPSTREAM_HEADER_TIMEOUT_MS, Math.max(MIN_UPSTREAM_HEADER_TIMEOUT_MS, raw));\n}\n'''
replace_once("scripts/local-cors-bridge.js", insert_after, insert_timeout)
replace_once(
    "scripts/local-cors-bridge.js",
    '      const rawTarget = requestUrl.searchParams.get("url");\n',
    '      const upstreamHeaderTimeoutMs = parseUpstreamHeaderTimeoutMs(requestUrl);\n      const rawTarget = requestUrl.searchParams.get("url");\n',
)
replace_once(
    "scripts/local-cors-bridge.js",
    '        `[OpenExcel bridge:${requestId}] start method=${method} protocol=${target.protocol.slice(0, -1)} custom=${trustedCustomEndpoint ? "yes" : "no"} route=${route}`,',
    '        `[OpenExcel bridge:${requestId}] start method=${method} protocol=${target.protocol.slice(0, -1)} custom=${trustedCustomEndpoint ? "yes" : "no"} route=${route} responseStartTimeout=${upstreamHeaderTimeoutMs}ms`,',
)
bridge = Path("scripts/local-cors-bridge.js")
text = bridge.read_text()
text = text.replace('after ${UPSTREAM_HEADER_TIMEOUT_MS}ms', 'after ${upstreamHeaderTimeoutMs}ms')
text = text.replace('}, UPSTREAM_HEADER_TIMEOUT_MS);', '}, upstreamHeaderTimeoutMs);')
text = text.replace(
    '  BRIDGE_PATH,\n  createLocalCorsBridgeMiddleware,',
    '  BRIDGE_PATH,\n  DEFAULT_UPSTREAM_HEADER_TIMEOUT_MS,\n  createLocalCorsBridgeMiddleware,\n  parseUpstreamHeaderTimeoutMs,',
)
bridge.write_text(text)

# Bridge smoke test validates default and user override parsing.
replace_once(
    "scripts/test-local-cors-bridge.js",
    'const { BRIDGE_PATH, createLocalCorsBridgeMiddleware } = require("./local-cors-bridge");',
    'const {\n  BRIDGE_PATH,\n  DEFAULT_UPSTREAM_HEADER_TIMEOUT_MS,\n  createLocalCorsBridgeMiddleware,\n  parseUpstreamHeaderTimeoutMs,\n} = require("./local-cors-bridge");',
)
replace_once(
    "scripts/test-local-cors-bridge.js",
    'async function main() {\n',
    'async function main() {\n  assert.equal(DEFAULT_UPSTREAM_HEADER_TIMEOUT_MS, 180000);\n  assert.equal(parseUpstreamHeaderTimeoutMs(new URL("https://localhost/__openexcel_bridge")), 180000);\n  assert.equal(\n    parseUpstreamHeaderTimeoutMs(new URL("https://localhost/__openexcel_bridge?timeout_ms=240000")),\n    240000,\n  );\n\n',
)

print("Response-start timeout patch applied")

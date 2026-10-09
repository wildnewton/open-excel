from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}: {old[:120]!r}")
    target.write_text(text.replace(old, new, 1))


def replace_all(path: str, old: str, new: str, expected: int) -> None:
    target = ROOT / path
    text = target.read_text()
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} matches, found {count}: {old[:120]!r}")
    target.write_text(text.replace(old, new))


# ---------------------------------------------------------------------------
# Settings: drafts never overwrite last successful config, and stale model
# discovery responses cannot write back after the user changes settings.
# ---------------------------------------------------------------------------
settings = "src/taskpane/components/chat/settings-panel.tsx"
replace_once(
    settings,
    'import { useEffect, useState } from "react";',
    'import { useEffect, useRef, useState } from "react";',
)
replace_once(settings, '  saveConfig,\n', '')
replace_once(
    settings,
    '  const [manualModel, setManualModel] = useState("");\n\n  const followMode',
    '  const [manualModel, setManualModel] = useState("");\n  const discoveryGenerationRef = useRef(0);\n\n  const followMode',
)
replace_once(
    settings,
    '''    if (provider === "custom") return;\n\n    if (provider || apiKey || model) saveConfig(config);\n    if (provider && apiKey && model) setProviderConfig(config);''',
    '''    if (provider === "custom") return;\n    if (provider && apiKey && model) setProviderConfig(config);''',
)
replace_once(
    settings,
    '''  const invalidateDiscovery = () => {\n    setModels([]);\n    setModel("");\n    setDiscoverySource(null);\n    setDiscoveryMessage(null);\n    setDiscoveryError(null);\n    setManualModel("");\n  };''',
    '''  const cancelDiscovery = () => {\n    discoveryGenerationRef.current += 1;\n    setIsDiscovering(false);\n  };\n\n  const invalidateDiscovery = () => {\n    cancelDiscovery();\n    setModels([]);\n    setModel("");\n    setDiscoverySource(null);\n    setDiscoveryMessage(null);\n    setDiscoveryError(null);\n    setManualModel("");\n  };''',
)
replace_once(
    settings,
    '''  const handleDiscoverModels = async () => {\n    setIsDiscovering(true);\n    setDiscoveryError(null);\n    setDiscoveryMessage(null);\n\n    try {\n      const result = await discoverByokModels({\n        mode: "byok",\n        provider,\n        apiKey,\n        model,\n        useProxy,\n        proxyUrl,\n        thinking,\n        followMode,\n        authMethod,\n        apiType,\n        customBaseUrl,\n        responseStartTimeoutSeconds,\n      });\n      setModels(result.models);\n      setDiscoverySource(result.source);\n      setDiscoveryMessage(result.message ?? null);\n      if (!result.models.some((item) => item.id === model)) {\n        setModel(result.models[0]?.id ?? "");\n      }\n    } catch (err) {\n      setDiscoveryError(err instanceof Error ? err.message : "Unable to discover models.");\n    } finally {\n      setIsDiscovering(false);\n    }\n  };''',
    '''  const handleDiscoverModels = async () => {\n    const generation = discoveryGenerationRef.current + 1;\n    discoveryGenerationRef.current = generation;\n    setIsDiscovering(true);\n    setDiscoveryError(null);\n    setDiscoveryMessage(null);\n\n    try {\n      const result = await discoverByokModels({\n        mode: "byok",\n        provider,\n        apiKey,\n        model,\n        useProxy,\n        proxyUrl,\n        thinking,\n        followMode,\n        authMethod,\n        apiType,\n        customBaseUrl,\n        responseStartTimeoutSeconds,\n      });\n      if (generation !== discoveryGenerationRef.current) return;\n      setModels(result.models);\n      setDiscoverySource(result.source);\n      setDiscoveryMessage(result.message ?? null);\n      if (!result.models.some((item) => item.id === model)) {\n        setModel(result.models[0]?.id ?? "");\n      }\n    } catch (err) {\n      if (generation !== discoveryGenerationRef.current) return;\n      setDiscoveryError(err instanceof Error ? err.message : "Unable to discover models.");\n    } finally {\n      if (generation === discoveryGenerationRef.current) setIsDiscovering(false);\n    }\n  };''',
)
replace_once(
    settings,
    '''    saveConfig(config);\n    setProviderConfig(config);''',
    '''    setProviderConfig(config);''',
)
replace_once(
    settings,
    '''  const toggleProxy = () => {\n    if (isCustom) clearProviderConfig();\n    setUseProxy((current) => !current);\n  };\n\n  const changeProxyUrl = (value: string) => {\n    if (isCustom) clearProviderConfig();\n    setProxyUrl(value);\n  };''',
    '''  const toggleProxy = () => {\n    cancelDiscovery();\n    if (isCustom) clearProviderConfig();\n    setUseProxy((current) => !current);\n  };\n\n  const changeProxyUrl = (value: string) => {\n    cancelDiscovery();\n    if (isCustom) clearProviderConfig();\n    setProxyUrl(value);\n  };''',
)
replace_once(
    settings,
    '''                if (!Number.isFinite(next) || next < 1) return;\n                if (isCustom) clearProviderConfig();\n                setResponseStartTimeoutSeconds(Math.min(3600, next));''',
    '''                if (!Number.isFinite(next) || next < 1) return;\n                cancelDiscovery();\n                if (isCustom) clearProviderConfig();\n                setResponseStartTimeoutSeconds(Math.min(3600, next));''',
)
replace_once(
    settings,
    '''  const [discoverySource, setDiscoverySource] = useState<"live" | "fallback" | null>(null);\n  const followMode = state.providerConfig?.followMode ?? savedGateway?.followMode ?? true;''',
    '''  const [discoverySource, setDiscoverySource] = useState<"live" | "fallback" | null>(null);\n  const discoveryGenerationRef = useRef(0);\n  const followMode = state.providerConfig?.followMode ?? savedGateway?.followMode ?? true;''',
)
replace_once(
    settings,
    '''    if (gatewayUrl || model) saveConfig(config);\n    if (gatewayUrl.trim() && model) setProviderConfig(config);''',
    '''    if (gatewayUrl.trim() && model) setProviderConfig(config);''',
)
replace_once(
    settings,
    '''  const handleGatewayUrlChange = (value: string) => {\n    clearProviderConfig();\n    setGatewayUrl(value);\n    setModels([]);\n    setModel("");\n    setDiscoverySource(null);\n    setDiscoveryError(null);\n  };''',
    '''  const cancelDiscovery = () => {\n    discoveryGenerationRef.current += 1;\n    setIsDiscovering(false);\n  };\n\n  const handleGatewayUrlChange = (value: string) => {\n    cancelDiscovery();\n    clearProviderConfig();\n    setGatewayUrl(value);\n    setModels([]);\n    setModel("");\n    setDiscoverySource(null);\n    setDiscoveryError(null);\n  };''',
)
replace_once(
    settings,
    '''  const handleDiscoverModels = async () => {\n    setIsDiscovering(true);\n    setDiscoveryError(null);\n    try {\n      const result = await discoverGatewayModels(gatewayUrl, responseStartTimeoutSeconds);\n      setModels(result.models);\n      setDiscoverySource(result.source);\n      if (!result.models.some((item) => item.id === model)) setModel(result.models[0]?.id ?? "");\n    } catch (err) {\n      setDiscoveryError(err instanceof Error ? err.message : "Unable to discover models.");\n    } finally {\n      setIsDiscovering(false);\n    }\n  };''',
    '''  const handleDiscoverModels = async () => {\n    const generation = discoveryGenerationRef.current + 1;\n    discoveryGenerationRef.current = generation;\n    setIsDiscovering(true);\n    setDiscoveryError(null);\n    try {\n      const result = await discoverGatewayModels(gatewayUrl, responseStartTimeoutSeconds);\n      if (generation !== discoveryGenerationRef.current) return;\n      setModels(result.models);\n      setDiscoverySource(result.source);\n      if (!result.models.some((item) => item.id === model)) setModel(result.models[0]?.id ?? "");\n    } catch (err) {\n      if (generation !== discoveryGenerationRef.current) return;\n      setDiscoveryError(err instanceof Error ? err.message : "Unable to discover models.");\n    } finally {\n      if (generation === discoveryGenerationRef.current) setIsDiscovering(false);\n    }\n  };''',
)
replace_once(
    settings,
    '''                if (!Number.isFinite(next) || next < 1) return;\n                setResponseStartTimeoutSeconds(Math.min(3600, next));\n              }}\n              className="w-full bg-(--chat-input-bg) text-(--chat-text-primary) text-sm px-3 py-2 border border-(--chat-border) focus:outline-none focus:border-(--chat-border-active)"\n              style={inputStyle}\n            />\n            <p className="text-[10px] text-(--chat-text-muted) mt-1">\n              Maximum wait for response headers / streaming to start. Default 180 seconds. Once streaming starts, this\n              timeout no longer applies.\n            </p>\n          </label>\n        </div>\n      </div>\n\n      <div className="border-t border-(--chat-border) pt-4">''',
    '''                if (!Number.isFinite(next) || next < 1) return;\n                cancelDiscovery();\n                setResponseStartTimeoutSeconds(Math.min(3600, next));\n              }}\n              className="w-full bg-(--chat-input-bg) text-(--chat-text-primary) text-sm px-3 py-2 border border-(--chat-border) focus:outline-none focus:border-(--chat-border-active)"\n              style={inputStyle}\n            />\n            <p className="text-[10px] text-(--chat-text-muted) mt-1">\n              Maximum wait for response headers / streaming to start. Default 180 seconds. Once streaming starts, this\n              timeout no longer applies.\n            </p>\n          </label>\n        </div>\n      </div>\n\n      <div className="border-t border-(--chat-border) pt-4">''',
)

# ---------------------------------------------------------------------------
# Storage: persist the provider-native Agent transcript alongside UI messages.
# Existing IndexedDB rows remain readable because normalization supplies [].
# ---------------------------------------------------------------------------
storage = "src/lib/storage/db.ts"
replace_once(
    storage,
    'import Dexie, { type Table } from "dexie";\n',
    'import type { AgentMessage } from "@earendil-works/pi-agent-core";\nimport Dexie, { type Table } from "dexie";\n',
)
replace_once(
    storage,
    '''  messages: ChatMessage[];\n  createdAt: number;''',
    '''  messages: ChatMessage[];\n  agentMessages: AgentMessage[];\n  createdAt: number;''',
)
replace_once(
    storage,
    '''const db = new OpenExcelDB();\n\nexport { db };''',
    '''const db = new OpenExcelDB();\n\nfunction normalizeSession(session: ChatSession | undefined): ChatSession | undefined {\n  if (!session) return undefined;\n  return {\n    ...session,\n    agentMessages: Array.isArray(session.agentMessages) ? session.agentMessages : [],\n  };\n}\n\nexport { db };''',
)
replace_once(
    storage,
    '''export async function listSessions(workbookId: string): Promise<ChatSession[]> {\n  return db.sessions.where("workbookId").equals(workbookId).reverse().sortBy("updatedAt");\n}''',
    '''export async function listSessions(workbookId: string): Promise<ChatSession[]> {\n  const sessions = await db.sessions.where("workbookId").equals(workbookId).reverse().sortBy("updatedAt");\n  return sessions.map((session) => normalizeSession(session) as ChatSession);\n}''',
)
replace_once(
    storage,
    '''    messages: [],\n    createdAt: now,''',
    '''    messages: [],\n    agentMessages: [],\n    createdAt: now,''',
)
replace_once(
    storage,
    '''export async function getSession(sessionId: string): Promise<ChatSession | undefined> {\n  return db.sessions.get(sessionId);\n}''',
    '''export async function getSession(sessionId: string): Promise<ChatSession | undefined> {\n  return normalizeSession(await db.sessions.get(sessionId));\n}''',
)
replace_once(
    storage,
    '''export async function saveSession(sessionId: string, messages: ChatMessage[]): Promise<void> {\n  console.log("[DB] saveSession:", sessionId, "messages:", messages.length);\n  const session = await db.sessions.get(sessionId);''',
    '''export async function saveSession(\n  sessionId: string,\n  messages: ChatMessage[],\n  agentMessages?: AgentMessage[],\n): Promise<void> {\n  const session = normalizeSession(await db.sessions.get(sessionId));''',
)
replace_once(
    storage,
    '''    messages,\n    name,\n    updatedAt: Date.now(),\n  });\n  console.log("[DB] saveSession complete");''',
    '''    messages,\n    agentMessages: agentMessages ?? session.agentMessages,\n    name,\n    updatedAt: Date.now(),\n  });''',
)

# ---------------------------------------------------------------------------
# Chat runtime: keep transcript when config is invalidated, wait for Agent idle
# before reset, persist/restore native transcript, and remove sensitive logs.
# ---------------------------------------------------------------------------
chat = "src/taskpane/components/chat/chat-context.tsx"
replace_once(
    chat,
    '''  const currentSessionIdRef = useRef<string | null>(null);\n  const followModeRef = useRef(state.providerConfig?.followMode ?? true);''',
    '''  const currentSessionIdRef = useRef<string | null>(null);\n  const followModeRef = useRef(state.providerConfig?.followMode ?? true);\n  const restoredAgentMessagesRef = useRef<AgentMessage[]>([]);''',
)
replace_once(chat, '    console.log("[Chat] Agent event:", event.type, event);\n', '')
replace_once(
    chat,
    '''          console.log("[Chat] Assistant message result:", event.message);\n          console.log("[Chat] Usage:", assistantMsg.usage);\n          console.log("[Chat] stopReason:", assistantMsg.stopReason, "errorMessage:", assistantMsg.errorMessage);\n\n''',
    '',
)
replace_once(
    chat,
    '''      case "agent_end": {\n        isStreamingRef.current = false;\n        setState((prev) => ({ ...prev, isStreaming: false }));\n        streamingMessageIdRef.current = null;\n        break;\n      }''',
    '''      case "agent_end": {\n        isStreamingRef.current = false;\n        if (agentRef.current) {\n          restoredAgentMessagesRef.current = [...agentRef.current.state.messages];\n        }\n        setState((prev) => ({ ...prev, isStreaming: false }));\n        streamingMessageIdRef.current = null;\n        break;\n      }''',
)
replace_all(chat, '    console.log("[Chat] Refreshing OAuth token before API call...");\n', '', 1)
replace_all(chat, '    console.log("[Chat] OAuth token refreshed");\n', '', 1)
replace_once(
    chat,
    '''      configRef.current = config;\n      const existingMessages = agentRef.current?.state.messages ?? [];''',
    '''      configRef.current = config;\n      const existingMessages = agentRef.current?.state.messages ?? restoredAgentMessagesRef.current;''',
)
replace_once(
    chat,
    '''      followModeRef.current = config.followMode ?? true;\n\n      console.log("[Chat] Model info:", {\n        id: baseModel.id,\n        contextWindow: baseModel.contextWindow,\n        maxTokens: baseModel.maxTokens,\n        cost: baseModel.cost,\n        reasoning: baseModel.reasoning,\n      });\n\n      setState((prev) => ({''',
    '''      followModeRef.current = config.followMode ?? true;\n      restoredAgentMessagesRef.current = [...existingMessages];\n      saveConfig(config);\n\n      setState((prev) => ({''',
)
replace_once(
    chat,
    '''  const clearProviderConfig = useCallback(() => {\n    agentRef.current?.abort();\n    agentRef.current = null;\n    configRef.current = null;\n    pendingConfigRef.current = null;\n    isStreamingRef.current = false;\n    setState((prev) => ({\n      ...prev,\n      providerConfig: null,\n      isStreaming: false,\n      error: null,\n      sessionStats: { ...prev.sessionStats, contextWindow: 0 },\n    }));\n  }, []);\n\n  const abort = useCallback(() => {\n    agentRef.current?.abort();\n    isStreamingRef.current = false;\n    setState((prev) => ({ ...prev, isStreaming: false }));\n  }, []);''',
    '''  const clearProviderConfig = useCallback(() => {\n    if (agentRef.current) {\n      restoredAgentMessagesRef.current = [...agentRef.current.state.messages];\n      agentRef.current.abort();\n    }\n    configRef.current = null;\n    pendingConfigRef.current = null;\n    setState((prev) => ({\n      ...prev,\n      providerConfig: null,\n      error: null,\n      sessionStats: { ...prev.sessionStats, contextWindow: 0 },\n    }));\n  }, []);\n\n  const abort = useCallback(() => {\n    agentRef.current?.abort();\n  }, []);''',
)
replace_once(chat, '          console.log("[Chat] Fetching workbook metadata...");\n', '')
replace_once(chat, '          console.log("[Chat] Workbook metadata:", metadata);\n', '')
replace_once(chat, '        console.log("[Chat] Full context:", agent.state.messages);\n', '')
replace_once(
    chat,
    '''  const clearMessages = useCallback(() => {\n    abort();\n    agentRef.current?.reset();\n    if (currentSessionIdRef.current) {\n      saveSession(currentSessionIdRef.current, []).catch(console.error);\n    }\n    setState((prev) => ({ ...prev, messages: [], error: null, sessionStats: INITIAL_STATS }));\n  }, [abort]);''',
    '''  const clearMessages = useCallback(() => {\n    const clear = async () => {\n      const agent = agentRef.current;\n      if (agent && isStreamingRef.current) {\n        agent.abort();\n        await agent.waitForIdle();\n      }\n\n      if (agentRef.current) {\n        agentRef.current.reset();\n        restoredAgentMessagesRef.current = [...agentRef.current.state.messages];\n      } else {\n        restoredAgentMessagesRef.current = [];\n      }\n\n      isStreamingRef.current = false;\n      if (currentSessionIdRef.current) {\n        await saveSession(currentSessionIdRef.current, [], restoredAgentMessagesRef.current);\n      }\n      setState((prev) => ({\n        ...prev,\n        messages: [],\n        isStreaming: false,\n        error: null,\n        sessionStats: INITIAL_STATS,\n      }));\n    };\n\n    void clear().catch((err) => {\n      console.error("[Chat] Failed to clear messages:", err);\n    });\n  }, []);''',
)
replace_once(
    chat,
    '''    const sessions = await listSessions(workbookIdRef.current);\n    console.log(\n      "[Chat] refreshSessions:",\n      sessions.map((s) => ({ id: s.id, name: s.name, msgs: s.messages.length })),\n    );\n    setState((prev) => ({ ...prev, sessions }));''',
    '''    const sessions = await listSessions(workbookIdRef.current);\n    setState((prev) => ({ ...prev, sessions }));''',
)
replace_once(chat, '    console.log("[Chat] newSession called, workbookId:", workbookIdRef.current);\n', '')
replace_once(chat, '      console.log("[Chat] newSession blocked: streaming in progress");\n', '')
replace_once(chat, '      console.log("[Chat] Created new session:", session.id);\n', '')
replace_once(
    chat,
    '''      agentRef.current?.reset();\n      const session = await createSession(workbookIdRef.current);''',
    '''      agentRef.current?.reset();\n      restoredAgentMessagesRef.current = agentRef.current ? [...agentRef.current.state.messages] : [];\n      const session = await createSession(workbookIdRef.current);''',
)
replace_once(chat, '    console.log("[Chat] switchSession called:", sessionId, "current:", currentSessionIdRef.current);\n', '')
replace_once(chat, '      console.log("[Chat] switchSession blocked: streaming in progress");\n', '')
replace_once(chat, '      console.log("[Chat] Got session:", session?.id, "messages:", session?.messages.length);\n', '')
replace_once(
    chat,
    '''      currentSessionIdRef.current = session.id;\n      setState((prev) => ({\n        ...prev,\n        messages: session.messages,\n        currentSession: session,''',
    '''      currentSessionIdRef.current = session.id;\n      restoredAgentMessagesRef.current = [...session.agentMessages];\n      if (agentRef.current) {\n        agentRef.current.state.messages = restoredAgentMessagesRef.current;\n      }\n      setState((prev) => ({\n        ...prev,\n        messages: session.messages,\n        currentSession: session,''',
)
replace_once(chat, '      console.log("[Chat] deleteCurrentSession blocked: streaming in progress");\n', '')
replace_once(
    chat,
    '''    const session = await getOrCreateCurrentSession(workbookIdRef.current);\n    currentSessionIdRef.current = session.id;\n    await refreshSessions();\n    setState((prev) => ({''',
    '''    const session = await getOrCreateCurrentSession(workbookIdRef.current);\n    currentSessionIdRef.current = session.id;\n    restoredAgentMessagesRef.current = [...session.agentMessages];\n    if (agentRef.current) {\n      agentRef.current.state.messages = restoredAgentMessagesRef.current;\n    }\n    await refreshSessions();\n    setState((prev) => ({''',
)
replace_once(
    chat,
    '''      const sessionId = currentSessionIdRef.current;\n      saveSession(sessionId, state.messages)''',
    '''      const sessionId = currentSessionIdRef.current;\n      const agentMessages = agentRef.current ? [...agentRef.current.state.messages] : restoredAgentMessagesRef.current;\n      restoredAgentMessagesRef.current = agentMessages;\n      saveSession(sessionId, state.messages, agentMessages)''',
)
replace_once(chat, '        console.log("[Chat] Workbook ID:", id);\n', '')
replace_once(chat, '        console.log("[Chat] Loaded session:", session.id, "with", session.messages.length, "messages");\n', '')
replace_once(
    chat,
    '''        const sessions = await listSessions(id);\n        setState((prev) => ({''',
    '''        const sessions = await listSessions(id);\n        restoredAgentMessagesRef.current = [...session.agentMessages];\n        if (agentRef.current && !isStreamingRef.current) {\n          agentRef.current.state.messages = restoredAgentMessagesRef.current;\n        }\n        setState((prev) => ({''',
)
replace_once(
    chat,
    '''      const newFollowMode = !prev.providerConfig.followMode;\n      followModeRef.current = newFollowMode;\n      const newConfig = { ...prev.providerConfig, followMode: newFollowMode };\n      saveConfig(newConfig);\n      return { ...prev, providerConfig: newConfig };''',
    '''      const newFollowMode = !prev.providerConfig.followMode;\n      followModeRef.current = newFollowMode;\n      const newConfig = { ...prev.providerConfig, followMode: newFollowMode };\n      if (pendingConfigRef.current) {\n        pendingConfigRef.current = { ...pendingConfigRef.current, followMode: newFollowMode };\n      }\n      if (configRef.current) {\n        configRef.current = { ...configRef.current, followMode: newFollowMode };\n        saveConfig(configRef.current);\n      }\n      return { ...prev, providerConfig: newConfig };''',
)

# ---------------------------------------------------------------------------
# Packaging: do not put the BYOK production manifest into dist-gateway.
# ---------------------------------------------------------------------------
webpack = "webpack.config.js"
replace_once(
    webpack,
    '''      new CopyWebpackPlugin({\n        patterns: [\n          {\n            from: "assets/*",\n            to: "assets/[name][ext][query]",\n          },\n          {\n            from: "manifest*.xml",\n            to: "[name]" + "[ext]",\n            transform(content) {\n              if (dev) {\n                return content;\n              } else {\n                return content.toString().replace(new RegExp(urlDev, "g"), urlProd);\n              }\n            },\n          },\n        ],\n      }),''',
    '''      new CopyWebpackPlugin({\n        patterns: [\n          {\n            from: "assets/*",\n            to: "assets/[name][ext][query]",\n          },\n          ...(dev || openExcelMode === "byok"\n            ? [\n                {\n                  from: "manifest*.xml",\n                  to: "[name]" + "[ext]",\n                  transform(content) {\n                    if (dev) {\n                      return content;\n                    }\n                    return content.toString().replace(new RegExp(urlDev, "g"), urlProd);\n                  },\n                },\n              ]\n            : []),\n        ],\n      }),''',
)

# ---------------------------------------------------------------------------
# Targeted source regression checks. These complement (not replace) typecheck,
# lint, builds, and the streaming bridge smoke test.
# ---------------------------------------------------------------------------
regression_test = ROOT / "scripts/test-review-regressions.js"
regression_test.write_text(r'''const assert = require("assert");
const fs = require("fs");

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

const settings = read("src/taskpane/components/chat/settings-panel.tsx");
const chat = read("src/taskpane/components/chat/chat-context.tsx");
const storage = read("src/lib/storage/db.ts");
const discovery = read("src/taskpane/components/chat/model-discovery.ts");
const webpackConfig = read("webpack.config.js");

assert.equal(settings.includes("saveConfig("), false, "Settings drafts must not persist directly");
assert.match(settings, /discoveryGenerationRef = useRef\(0\)/, "Discovery needs stale-response generation guards");
assert.match(chat, /restoredAgentMessagesRef/, "Chat runtime must retain native agent transcript");
assert.match(chat, /saveConfig\(config\);/, "Only applied runtime config should become the saved config");

const clearProvider = section(chat, "const clearProviderConfig", "const abort");
assert.equal(clearProvider.includes("agentRef.current = null"), false, "Invalidating config must not discard transcript");
assert.equal(clearProvider.includes("isStreamingRef.current = false"), false, "Invalidating config must not fake Agent idle");

const abortSection = section(chat, "const abort", "const sendMessage");
assert.equal(abortSection.includes("isStreamingRef.current = false"), false, "Abort must wait for agent_end");
assert.match(chat, /waitForIdle\(\)/, "Reset after abort must wait for the Agent to become idle");

assert.match(storage, /agentMessages: AgentMessage\[\]/, "Sessions must persist provider-native agent messages");
assert.match(discovery, /reasoning: true,[\s\S]*input: \["text", "image"\]/, "Custom Endpoint capabilities regressed");
assert.equal(discovery.includes("record.supported_in_api === false"), false, "ChatGPT picker must not filter by public API support");
assert.match(discovery, /\[404, 405, 501\]/, "Unsupported /models endpoints must fall back deliberately");
assert.match(discovery, /Gateway URL must use HTTPS/, "Gateway URL must enforce HTTPS");
assert.match(webpackConfig, /dev \|\| openExcelMode === "byok"/, "Gateway production build must not package BYOK manifests");

console.log("Review regression checks passed");
''')

package = "package.json"
replace_once(
    package,
    '''    "test:bridge": "node scripts/test-local-cors-bridge.js",\n    "lint":''',
    '''    "test:bridge": "node scripts/test-local-cors-bridge.js",\n    "test:review-regressions": "node scripts/test-review-regressions.js",\n    "lint":''',
)

ci = ".github/workflows/ci.yml"
replace_once(
    ci,
    '''      - name: Local bridge smoke test\n        run: pnpm test:bridge\n\n      - name: Type check''',
    '''      - name: Local bridge smoke test\n        run: pnpm test:bridge\n\n      - name: Review regression checks\n        run: pnpm test:review-regressions\n\n      - name: Type check''',
)

print("Applied review fixes")

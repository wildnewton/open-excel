from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}: {old[:180]!r}")
    p.write_text(text.replace(old, new, 1))


# chat-context.tsx: expose an explicit way to deactivate the current runtime model.
path = "src/taskpane/components/chat/chat-context.tsx"
replace_once(
    path,
    '''  setProviderConfig: (config: ProviderConfig) => void;\n  clearMessages: () => void;''',
    '''  setProviderConfig: (config: ProviderConfig) => void;\n  clearProviderConfig: () => void;\n  clearMessages: () => void;''',
)
replace_once(
    path,
    '''  const abort = useCallback(() => {\n    agentRef.current?.abort();\n    isStreamingRef.current = false;\n    setState((prev) => ({ ...prev, isStreaming: false }));\n  }, []);''',
    '''  const clearProviderConfig = useCallback(() => {\n    agentRef.current?.abort();\n    agentRef.current = null;\n    configRef.current = null;\n    pendingConfigRef.current = null;\n    isStreamingRef.current = false;\n    setState((prev) => ({\n      ...prev,\n      providerConfig: null,\n      isStreaming: false,\n      error: null,\n      sessionStats: { ...prev.sessionStats, contextWindow: 0 },\n    }));\n  }, []);\n\n  const abort = useCallback(() => {\n    agentRef.current?.abort();\n    isStreamingRef.current = false;\n    setState((prev) => ({ ...prev, isStreaming: false }));\n  }, []);''',
)
replace_once(
    path,
    '''        setProviderConfig,\n        clearMessages,''',
    '''        setProviderConfig,\n        clearProviderConfig,\n        clearMessages,''',
)

# settings-panel.tsx: Custom Endpoint becomes explicit apply semantics.
path = "src/taskpane/components/chat/settings-panel.tsx"
replace_once(
    path,
    '''  const { state, setProviderConfig, availableProviders } = useChat();''',
    '''  const { state, setProviderConfig, clearProviderConfig, availableProviders } = useChat();''',
)

replace_once(
    path,
    '''    // Persist settings even before the configuration is complete.\n    if (provider || apiKey || model || customBaseUrl) saveConfig(config);\n    const ready =\n      provider === "custom"\n        ? Boolean(apiKey && model && apiType && customBaseUrl.trim())\n        : Boolean(provider && apiKey && model);\n    if (ready) setProviderConfig(config);''',
    '''    // Built-in providers keep their existing automatic activation once\n    // authentication and a model are ready. Custom Endpoint is different:\n    // editing its fields is only a draft until the user explicitly applies it.\n    if (provider === "custom") return;\n\n    if (provider || apiKey || model) saveConfig(config);\n    if (provider && apiKey && model) setProviderConfig(config);''',
)

replace_once(
    path,
    '''  const handleProviderChange = (newProvider: string) => {\n    setProvider(newProvider);''',
    '''  const handleProviderChange = (newProvider: string) => {\n    // Never leave the previous provider/model active while the user is\n    // configuring a different provider.\n    clearProviderConfig();\n    setProvider(newProvider);''',
)

replace_once(
    path,
    '''  const handleAuthMethodChange = (newMethod: "apikey" | "oauth") => {\n    invalidateDiscovery();''',
    '''  const handleAuthMethodChange = (newMethod: "apikey" | "oauth") => {\n    clearProviderConfig();\n    invalidateDiscovery();''',
)

replace_once(
    path,
    '''  const handleApiKeyChange = (newApiKey: string) => {\n    setApiKey(newApiKey);\n    if (!isCustom) invalidateDiscovery();\n  };''',
    '''  const handleApiKeyChange = (newApiKey: string) => {\n    clearProviderConfig();\n    setApiKey(newApiKey);\n    if (!isCustom) invalidateDiscovery();\n  };''',
)

replace_once(
    path,
    '''  const activeConfig = state.providerConfig;\n  const isConfigured =''',
    '''  const customReady = Boolean(apiKey.trim() && model.trim() && apiType.trim() && customBaseUrl.trim());\n\n  const applyCustomEndpoint = () => {\n    if (!customReady) return;\n    const config: ByokProviderConfig = {\n      mode: "byok",\n      provider: "custom",\n      apiKey,\n      model: model.trim(),\n      useProxy,\n      proxyUrl,\n      thinking,\n      followMode,\n      authMethod: "apikey",\n      apiType,\n      customBaseUrl: customBaseUrl.trim(),\n    };\n    saveConfig(config);\n    setProviderConfig(config);\n  };\n\n  const activeConfig = state.providerConfig;\n  const isConfigured =''',
)

replace_once(
    path,
    '''                  value={apiType}\n                  onChange={(e) => setApiType(e.target.value)}''',
    '''                  value={apiType}\n                  onChange={(e) => {\n                    clearProviderConfig();\n                    setApiType(e.target.value);\n                  }}''',
)
replace_once(
    path,
    '''                  value={customBaseUrl}\n                  onChange={(e) => setCustomBaseUrl(e.target.value)}''',
    '''                  value={customBaseUrl}\n                  onChange={(e) => {\n                    clearProviderConfig();\n                    setCustomBaseUrl(e.target.value);\n                  }}''',
)
replace_once(
    path,
    '''                  value={model}\n                  onChange={(e) => setModel(e.target.value)}\n                  placeholder="gpt-4o"''',
    '''                  value={model}\n                  onChange={(e) => {\n                    clearProviderConfig();\n                    setModel(e.target.value);\n                  }}\n                  placeholder="gpt-4o"''',
)

replace_once(
    path,
    '''          <ThinkingSelector value={thinking} onChange={setThinking} />''',
    '''          <ThinkingSelector\n            value={thinking}\n            onChange={(value) => {\n              if (isCustom) clearProviderConfig();\n              setThinking(value);\n            }}\n          />\n\n          {isCustom && (\n            <button\n              type="button"\n              onClick={applyCustomEndpoint}\n              disabled={!customReady || isConfigured}\n              className="w-full flex items-center justify-center gap-2 bg-(--chat-accent) text-white text-xs px-3 py-2\n                         disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"\n              style={inputStyle}\n            >\n              {isConfigured ? "Custom Endpoint Active" : "Apply Custom Endpoint"}\n            </button>\n          )}''',
)

replace_once(
    path,
    '''              {isCustom ? "Enter endpoint, model, and API key" : "Authenticate, connect, and select a model"}''',
    '''              {isCustom\n                ? customReady\n                  ? "Custom Endpoint is not active yet — click Apply Custom Endpoint"\n                  : "Enter endpoint, model, and API key"\n                : "Authenticate, connect, and select a model"}''',
)

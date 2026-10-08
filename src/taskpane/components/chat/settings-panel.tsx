import { Check, Eye, EyeOff, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useChat } from "./chat-context";
import {
  APP_MODE,
  type ByokProviderConfig,
  loadSavedConfig,
  type ProviderConfig,
  saveConfig,
  type ThinkingLevel,
} from "./config";
import { type DiscoveredModel, discoverByokModels, discoverGatewayModels } from "./model-discovery";

const THINKING_LEVELS: { value: ThinkingLevel; label: string }[] = [
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export function SettingsPanel() {
  const { state, setProviderConfig, availableProviders } = useChat();
  const [saved] = useState(loadSavedConfig);
  const savedByok = saved?.mode === "byok" ? saved : null;
  const savedGateway = saved?.mode === "gateway" ? saved : null;

  const [provider, setProvider] = useState(() => savedByok?.provider || "");
  const [apiKey, setApiKey] = useState(() => savedByok?.apiKey || "");
  const [gatewayUrl, setGatewayUrl] = useState(() => savedGateway?.gatewayUrl || "");
  const [model, setModel] = useState(() => saved?.model || "");
  const [models, setModels] = useState<DiscoveredModel[]>(() =>
    saved?.model ? [{ id: saved.model, name: saved.model }] : [],
  );
  const [showKey, setShowKey] = useState(false);
  const [useProxy, setUseProxy] = useState(() => savedByok?.useProxy !== false);
  const [proxyUrl, setProxyUrl] = useState(() => savedByok?.proxyUrl || "");
  const [thinking, setThinking] = useState<ThinkingLevel>(() => saved?.thinking || "none");
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoverySource, setDiscoverySource] = useState<"live" | "fallback" | null>(null);
  const [discoveryMessage, setDiscoveryMessage] = useState<string | null>(null);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [manualModel, setManualModel] = useState("");

  const followMode = state.providerConfig?.followMode ?? saved?.followMode ?? true;

  useEffect(() => {
    let config: ProviderConfig | null = null;

    if (APP_MODE === "gateway") {
      if (gatewayUrl.trim() && model) {
        config = {
          mode: "gateway",
          gatewayUrl: gatewayUrl.trim(),
          model,
          thinking,
          followMode,
        };
      }
    } else if (provider && apiKey && model) {
      config = {
        mode: "byok",
        provider,
        apiKey,
        model,
        useProxy,
        proxyUrl,
        thinking,
        followMode,
      };
    }

    if (config) {
      saveConfig(config);
      setProviderConfig(config);
    }
  }, [provider, apiKey, gatewayUrl, model, useProxy, proxyUrl, thinking, followMode, setProviderConfig]);

  const invalidateDiscovery = () => {
    setModels([]);
    setModel("");
    setDiscoverySource(null);
    setDiscoveryMessage(null);
    setDiscoveryError(null);
    setManualModel("");
  };

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    invalidateDiscovery();
  };

  const handleApiKeyChange = (newApiKey: string) => {
    setApiKey(newApiKey);
    invalidateDiscovery();
  };

  const handleGatewayUrlChange = (newGatewayUrl: string) => {
    setGatewayUrl(newGatewayUrl);
    invalidateDiscovery();
  };

  const handleDiscoverModels = async () => {
    setIsDiscovering(true);
    setDiscoveryError(null);
    setDiscoveryMessage(null);

    try {
      const result =
        APP_MODE === "gateway"
          ? await discoverGatewayModels(gatewayUrl)
          : await discoverByokModels({
              mode: "byok",
              provider,
              apiKey,
              model,
              useProxy,
              proxyUrl,
              thinking,
              followMode,
            } satisfies ByokProviderConfig);

      setModels(result.models);
      setDiscoverySource(result.source);
      setDiscoveryMessage(result.message ?? null);

      if (!result.models.some((item) => item.id === model)) {
        setModel(result.models[0]?.id ?? "");
      }
    } catch (err) {
      setDiscoveryError(err instanceof Error ? err.message : "Unable to discover models.");
    } finally {
      setIsDiscovering(false);
    }
  };

  const useManualModel = () => {
    const id = manualModel.trim();
    if (!id) return;
    if (!models.some((item) => item.id === id)) {
      setModels((current) => [...current, { id, name: id }]);
    }
    setModel(id);
  };

  const activeConfig = state.providerConfig;
  const isConfigured =
    APP_MODE === "gateway"
      ? activeConfig?.mode === "gateway" &&
        activeConfig.gatewayUrl === gatewayUrl.trim() &&
        activeConfig.model === model
      : activeConfig?.mode === "byok" &&
        activeConfig.provider === provider &&
        activeConfig.apiKey === apiKey &&
        activeConfig.model === model;

  const canDiscover = APP_MODE === "gateway" ? gatewayUrl.trim().length > 0 : provider.length > 0 && apiKey.length > 0;

  const inputStyle = {
    borderRadius: "var(--chat-radius)",
    fontFamily: "var(--chat-font-mono)",
  };

  const connectLabel = models.length > 0 || discoverySource ? "Refresh Models" : "Connect";

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6" style={{ fontFamily: "var(--chat-font-mono)" }}>
      <div>
        <div className="text-[10px] uppercase tracking-widest text-(--chat-text-muted) mb-4">
          {APP_MODE === "gateway" ? "gateway configuration" : "api configuration"}
        </div>

        <div className="space-y-4">
          {APP_MODE === "gateway" ? (
            <label className="block">
              <span className="block text-xs text-(--chat-text-secondary) mb-1.5">Gateway URL</span>
              <input
                type="url"
                value={gatewayUrl}
                onChange={(e) => handleGatewayUrlChange(e.target.value)}
                placeholder="https://ai.company.internal/v1"
                className="w-full bg-(--chat-input-bg) text-(--chat-text-primary)
                           text-sm px-3 py-2 border border-(--chat-border)
                           placeholder:text-(--chat-text-muted)
                           focus:outline-none focus:border-(--chat-border-active)"
                style={inputStyle}
              />
              <p className="text-[10px] text-(--chat-text-muted) mt-1">
                OpenAI-compatible endpoint. If /v1 is omitted, OpenExcel adds it automatically.
              </p>
            </label>
          ) : (
            <>
              <label className="block">
                <span className="block text-xs text-(--chat-text-secondary) mb-1.5">Provider</span>
                <select
                  value={provider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  className="w-full bg-(--chat-input-bg) text-(--chat-text-primary)
                             text-sm px-3 py-2 border border-(--chat-border)
                             focus:outline-none focus:border-(--chat-border-active)"
                  style={inputStyle}
                >
                  <option value="">Select provider...</option>
                  {availableProviders.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="block text-xs text-(--chat-text-secondary) mb-1.5">API Key / Token</span>
                <div className="relative">
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => handleApiKeyChange(e.target.value)}
                    placeholder="Enter your credential"
                    className="w-full bg-(--chat-input-bg) text-(--chat-text-primary)
                               text-sm px-3 py-2 pr-10 border border-(--chat-border)
                               placeholder:text-(--chat-text-muted)
                               focus:outline-none focus:border-(--chat-border-active)"
                    style={inputStyle}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-(--chat-text-muted)
                               hover:text-(--chat-text-secondary)"
                  >
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </label>

              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs text-(--chat-text-secondary)">CORS Proxy</span>
                  <p className="text-[10px] text-(--chat-text-muted) mt-0.5">
                    Required for Anthropic and some providers
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setUseProxy(!useProxy)}
                  className={`
                    w-10 h-5 rounded-full transition-colors relative
                    ${useProxy ? "bg-(--chat-accent)" : "bg-(--chat-border)"}
                  `}
                >
                  <span
                    className={`
                      absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform
                      ${useProxy ? "left-5" : "left-0.5"}
                    `}
                  />
                </button>
              </div>

              {useProxy && (
                <label className="block">
                  <span className="block text-xs text-(--chat-text-secondary) mb-1.5">Proxy URL</span>
                  <input
                    type="text"
                    value={proxyUrl}
                    onChange={(e) => setProxyUrl(e.target.value)}
                    placeholder="https://your-proxy.com/proxy"
                    className="w-full bg-(--chat-input-bg) text-(--chat-text-primary)
                               text-sm px-3 py-2 border border-(--chat-border)
                               placeholder:text-(--chat-text-muted)
                               focus:outline-none focus:border-(--chat-border-active)"
                    style={inputStyle}
                  />
                  <p className="text-[10px] text-(--chat-text-muted) mt-1">
                    Your proxy should accept ?url=encoded_url format
                  </p>
                </label>
              )}
            </>
          )}

          <button
            type="button"
            disabled={!canDiscover || isDiscovering}
            onClick={handleDiscoverModels}
            className="w-full flex items-center justify-center gap-2 bg-(--chat-accent) text-white text-xs px-3 py-2
                       disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            style={inputStyle}
          >
            <RefreshCw size={13} className={isDiscovering ? "animate-spin" : ""} />
            {isDiscovering ? "Connecting..." : connectLabel}
          </button>

          {discoveryError && <p className="text-xs text-(--chat-error)">{discoveryError}</p>}
          {discoveryMessage && <p className="text-[10px] text-(--chat-text-muted)">{discoveryMessage}</p>}

          <label className="block">
            <span className="block text-xs text-(--chat-text-secondary) mb-1.5">Model</span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={models.length === 0}
              className="w-full bg-(--chat-input-bg) text-(--chat-text-primary)
                         text-sm px-3 py-2 border border-(--chat-border)
                         focus:outline-none focus:border-(--chat-border-active)
                         disabled:opacity-50 disabled:cursor-not-allowed"
              style={inputStyle}
            >
              <option value="">Select model...</option>
              {models.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            {discoverySource === "live" && (
              <p className="text-[10px] text-(--chat-text-muted) mt-1">
                Models loaded live from the configured endpoint.
              </p>
            )}
          </label>

          {APP_MODE === "byok" && discoverySource === "fallback" && (
            <div>
              <span className="block text-xs text-(--chat-text-secondary) mb-1.5">Manual Model ID</span>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualModel}
                  onChange={(e) => setManualModel(e.target.value)}
                  placeholder="provider-model-id"
                  className="min-w-0 flex-1 bg-(--chat-input-bg) text-(--chat-text-primary)
                             text-sm px-3 py-2 border border-(--chat-border)
                             placeholder:text-(--chat-text-muted)
                             focus:outline-none focus:border-(--chat-border-active)"
                  style={inputStyle}
                />
                <button
                  type="button"
                  onClick={useManualModel}
                  disabled={!manualModel.trim()}
                  className="px-3 py-2 text-xs border border-(--chat-border) text-(--chat-text-secondary)
                             hover:border-(--chat-border-active) disabled:opacity-50 disabled:cursor-not-allowed"
                  style={inputStyle}
                >
                  Use
                </button>
              </div>
            </div>
          )}

          <div>
            <span className="block text-xs text-(--chat-text-secondary) mb-1.5">Thinking Level</span>
            <div className="flex gap-1">
              {THINKING_LEVELS.map((level) => (
                <button
                  key={level.value}
                  type="button"
                  onClick={() => setThinking(level.value)}
                  className={`
                    flex-1 py-1.5 text-xs border transition-colors
                    ${
                      thinking === level.value
                        ? "bg-(--chat-accent) border-(--chat-accent) text-white"
                        : "bg-(--chat-input-bg) border-(--chat-border) text-(--chat-text-secondary) hover:border-(--chat-border-active)"
                    }
                  `}
                  style={{ borderRadius: "var(--chat-radius)" }}
                >
                  {level.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-(--chat-text-muted) mt-1">Extended thinking for supported models</p>
          </div>
        </div>
      </div>

      <div className="border-t border-(--chat-border) pt-4">
        <div className="flex items-center gap-2 text-xs">
          {isConfigured ? (
            <>
              <Check size={12} className="text-(--chat-success)" />
              <span className="text-(--chat-text-secondary)">
                Using {APP_MODE === "gateway" ? model : `${provider} / ${model}`}
              </span>
            </>
          ) : (
            <span className="text-(--chat-text-muted)">
              {APP_MODE === "gateway"
                ? "Enter the Gateway URL, connect, and select a model"
                : "Choose a provider, enter credentials, connect, and select a model"}
            </span>
          )}
        </div>
      </div>

      <div className="border-t border-(--chat-border) pt-4">
        <div className="text-[10px] uppercase tracking-widest text-(--chat-text-muted) mb-2">about</div>
        {APP_MODE === "gateway" ? (
          <p className="text-xs text-(--chat-text-secondary) leading-relaxed">
            Gateway mode sends requests to your OpenAI-compatible enterprise gateway. Provider selection and credentials
            are controlled by the gateway, not by this add-in.
          </p>
        ) : (
          <>
            <p className="text-xs text-(--chat-text-secondary) leading-relaxed">
              OpenExcel uses your existing provider credentials. Models are discovered after you connect instead of
              relying only on the bundled model catalog.
            </p>
            {useProxy && (
              <p className="text-xs text-(--chat-text-muted) leading-relaxed mt-2">
                CORS Proxy: Requests route through your proxy to bypass browser CORS restrictions.
              </p>
            )}
          </>
        )}
        <p className="text-[10px] text-(--chat-text-muted) mt-3">
          {APP_MODE === "gateway" ? "Gateway" : "BYOK"} build · v{__APP_VERSION__}
        </p>
      </div>
    </div>
  );
}

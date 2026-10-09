import { Check, ExternalLink, Eye, EyeOff, LogOut, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import {
  buildAuthorizationUrl,
  exchangeOAuthCode,
  generatePKCE,
  loadOAuthCredentials,
  OAUTH_PROVIDERS,
  type OAuthFlowState,
  removeOAuthCredentials,
  saveOAuthCredentials,
} from "../../../lib/oauth";
import { DEFAULT_RESPONSE_START_TIMEOUT_SECONDS } from "../../../lib/request-timeout";
import { useChat } from "./chat-context";
import {
  API_TYPES,
  APP_MODE,
  type ByokProviderConfig,
  type GatewayProviderConfig,
  loadSavedConfig,
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

const inputStyle = {
  borderRadius: "var(--chat-radius)",
  fontFamily: "var(--chat-font-mono)",
};

function ThinkingSelector({ value, onChange }: { value: ThinkingLevel; onChange: (value: ThinkingLevel) => void }) {
  return (
    <div>
      <span className="block text-xs text-(--chat-text-secondary) mb-1.5">Thinking Level</span>
      <div className="flex gap-1">
        {THINKING_LEVELS.map((level) => (
          <button
            key={level.value}
            type="button"
            onClick={() => onChange(level.value)}
            className={`
              flex-1 py-1.5 text-xs border transition-colors
              ${
                value === level.value
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
  );
}

function ByokSettingsPanel() {
  const { state, setProviderConfig, clearProviderConfig, availableProviders } = useChat();
  const [saved] = useState(loadSavedConfig);
  const savedByok = saved?.mode === "byok" ? saved : null;

  const [provider, setProvider] = useState(() => savedByok?.provider || "");
  const [apiKey, setApiKey] = useState(() => savedByok?.apiKey || "");
  const [model, setModel] = useState(() => savedByok?.model || "");
  const [models, setModels] = useState<DiscoveredModel[]>(() =>
    savedByok?.model ? [{ id: savedByok.model, name: savedByok.model }] : [],
  );
  const [showKey, setShowKey] = useState(false);
  const [useProxy, setUseProxy] = useState(() => savedByok?.useProxy !== false);
  const [proxyUrl, setProxyUrl] = useState(() => savedByok?.proxyUrl || "");
  const [thinking, setThinking] = useState<ThinkingLevel>(() => savedByok?.thinking || "none");
  const [authMethod, setAuthMethod] = useState<"apikey" | "oauth">(() => savedByok?.authMethod || "apikey");
  const [apiType, setApiType] = useState(() => savedByok?.apiType || "openai-completions");
  const [customBaseUrl, setCustomBaseUrl] = useState(() => savedByok?.customBaseUrl || "");
  const [responseStartTimeoutSeconds, setResponseStartTimeoutSeconds] = useState(
    () => savedByok?.responseStartTimeoutSeconds ?? DEFAULT_RESPONSE_START_TIMEOUT_SECONDS,
  );

  // OAuth flow state — restored from the upstream BYOK implementation.
  const [oauthFlow, setOauthFlow] = useState<OAuthFlowState>(() => {
    if (savedByok?.authMethod === "oauth") {
      const creds = loadOAuthCredentials(savedByok.provider);
      return creds ? { step: "connected" } : { step: "idle" };
    }
    return { step: "idle" };
  });
  const [oauthCodeInput, setOauthCodeInput] = useState("");

  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoverySource, setDiscoverySource] = useState<"live" | "fallback" | null>(null);
  const [discoveryMessage, setDiscoveryMessage] = useState<string | null>(null);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [manualModel, setManualModel] = useState("");

  const followMode = state.providerConfig?.followMode ?? savedByok?.followMode ?? true;
  const isCustom = provider === "custom";
  const hasOAuth = provider in OAUTH_PROVIDERS;
  const showApiKeyInput = !(hasOAuth && authMethod === "oauth");

  useEffect(() => {
    const config: ByokProviderConfig = {
      mode: "byok",
      provider,
      apiKey,
      model,
      useProxy,
      proxyUrl,
      thinking,
      followMode,
      authMethod,
      apiType,
      customBaseUrl,
      responseStartTimeoutSeconds,
    };

    // Built-in providers keep their existing automatic activation once
    // authentication and a model are ready. Custom Endpoint is different:
    // editing its fields is only a draft until the user explicitly applies it.
    if (provider === "custom") return;

    if (provider || apiKey || model) saveConfig(config);
    if (provider && apiKey && model) setProviderConfig(config);
  }, [
    provider,
    apiKey,
    model,
    useProxy,
    proxyUrl,
    thinking,
    followMode,
    authMethod,
    apiType,
    customBaseUrl,
    responseStartTimeoutSeconds,
    setProviderConfig,
  ]);

  const invalidateDiscovery = () => {
    setModels([]);
    setModel("");
    setDiscoverySource(null);
    setDiscoveryMessage(null);
    setDiscoveryError(null);
    setManualModel("");
  };

  const handleProviderChange = (newProvider: string) => {
    // Never leave the previous provider/model active while the user is
    // configuring a different provider.
    clearProviderConfig();
    setProvider(newProvider);
    invalidateDiscovery();

    if (newProvider === "custom") {
      setAuthMethod("apikey");
      setApiKey("");
      setOauthFlow({ step: "idle" });
      return;
    }

    const keepOAuth = newProvider in OAUTH_PROVIDERS ? authMethod : "apikey";
    setAuthMethod(keepOAuth);

    if (!(newProvider in OAUTH_PROVIDERS)) {
      setOauthFlow({ step: "idle" });
    } else if (keepOAuth === "oauth") {
      const creds = loadOAuthCredentials(newProvider);
      if (creds) {
        setApiKey(creds.access);
        setOauthFlow({ step: "connected" });
      } else {
        setOauthFlow({ step: "idle" });
      }
    }
  };

  // Authentication behavior below mirrors the upstream BYOK OAuth flow.
  const handleAuthMethodChange = (newMethod: "apikey" | "oauth") => {
    clearProviderConfig();
    invalidateDiscovery();
    if (newMethod === "oauth") {
      const creds = loadOAuthCredentials(provider);
      if (creds) {
        setOauthFlow({ step: "connected" });
        setAuthMethod("oauth");
        setApiKey(creds.access);
      } else {
        setAuthMethod("oauth");
        setOauthFlow({ step: "idle" });
      }
    } else {
      setOauthFlow({ step: "idle" });
      setAuthMethod("apikey");
      setApiKey("");
    }
  };

  const startOAuthLogin = async () => {
    try {
      const { verifier, challenge } = await generatePKCE();
      const { url, oauthState } = buildAuthorizationUrl(provider, challenge, verifier);
      window.open(url, "_blank");
      setOauthFlow({ step: "awaiting-code", verifier, oauthState });
    } catch (err) {
      setOauthFlow({ step: "error", message: err instanceof Error ? err.message : "Failed to start OAuth" });
    }
  };

  const submitOAuthCode = async () => {
    if (oauthFlow.step !== "awaiting-code" || !oauthCodeInput.trim()) return;
    const { verifier } = oauthFlow;
    setOauthFlow({ step: "exchanging" });

    try {
      const creds = await exchangeOAuthCode({
        provider,
        rawInput: oauthCodeInput.trim(),
        verifier,
        expectedState: oauthFlow.oauthState,
        useProxy,
        proxyUrl,
      });
      saveOAuthCredentials(provider, creds);
      setOauthFlow({ step: "connected" });
      setOauthCodeInput("");
      setApiKey(creds.access);
      setAuthMethod("oauth");
      invalidateDiscovery();
    } catch (err) {
      setOauthFlow({ step: "error", message: err instanceof Error ? err.message : "OAuth failed" });
    }
  };

  const logoutOAuth = () => {
    removeOAuthCredentials(provider);
    setOauthFlow({ step: "idle" });
    setAuthMethod("apikey");
    setApiKey("");
    invalidateDiscovery();
  };

  const handleApiKeyChange = (newApiKey: string) => {
    clearProviderConfig();
    setApiKey(newApiKey);
    if (!isCustom) invalidateDiscovery();
  };

  const handleDiscoverModels = async () => {
    setIsDiscovering(true);
    setDiscoveryError(null);
    setDiscoveryMessage(null);

    try {
      const result = await discoverByokModels({
        mode: "byok",
        provider,
        apiKey,
        model,
        useProxy,
        proxyUrl,
        thinking,
        followMode,
        authMethod,
        apiType,
        customBaseUrl,
        responseStartTimeoutSeconds,
      });
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

  const customReady = Boolean(model.trim() && apiType.trim() && customBaseUrl.trim());

  const applyCustomEndpoint = () => {
    if (!customReady) return;
    const config: ByokProviderConfig = {
      mode: "byok",
      provider: "custom",
      apiKey,
      model: model.trim(),
      useProxy,
      proxyUrl,
      thinking,
      followMode,
      authMethod: "apikey",
      apiType,
      customBaseUrl: customBaseUrl.trim(),
      responseStartTimeoutSeconds,
    };
    saveConfig(config);
    setProviderConfig(config);
  };

  const activeConfig = state.providerConfig;
  const isConfigured =
    activeConfig?.mode === "byok" &&
    activeConfig.provider === provider &&
    activeConfig.apiKey === apiKey &&
    activeConfig.model === model &&
    activeConfig.responseStartTimeoutSeconds === responseStartTimeoutSeconds &&
    (!isCustom || (activeConfig.apiType === apiType && activeConfig.customBaseUrl === customBaseUrl));
  const canDiscover = !isCustom && provider.length > 0 && apiKey.length > 0;
  const connectLabel = models.length > 0 || discoverySource ? "Refresh Models" : "Connect";

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6" style={{ fontFamily: "var(--chat-font-mono)" }}>
      <div>
        <div className="text-[10px] uppercase tracking-widest text-(--chat-text-muted) mb-4">api configuration</div>

        <div className="space-y-4">
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
              <option disabled>──────────</option>
              <option value="custom">Custom Endpoint</option>
            </select>
          </label>

          {isCustom && (
            <>
              <label className="block">
                <span className="block text-xs text-(--chat-text-secondary) mb-1.5">API Type</span>
                <select
                  value={apiType}
                  onChange={(e) => {
                    clearProviderConfig();
                    setApiType(e.target.value);
                  }}
                  className="w-full bg-(--chat-input-bg) text-(--chat-text-primary) text-sm px-3 py-2 border border-(--chat-border) focus:outline-none focus:border-(--chat-border-active)"
                  style={inputStyle}
                >
                  {API_TYPES.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-(--chat-text-muted) mt-1">
                  {API_TYPES.find((type) => type.id === apiType)?.hint}
                </p>
              </label>

              <label className="block">
                <span className="block text-xs text-(--chat-text-secondary) mb-1.5">Base URL</span>
                <input
                  type="text"
                  value={customBaseUrl}
                  onChange={(e) => {
                    clearProviderConfig();
                    setCustomBaseUrl(e.target.value);
                  }}
                  placeholder="https://api.openai.com/v1"
                  className="w-full bg-(--chat-input-bg) text-(--chat-text-primary) text-sm px-3 py-2 border border-(--chat-border) placeholder:text-(--chat-text-muted) focus:outline-none focus:border-(--chat-border-active)"
                  style={inputStyle}
                />
                <p className="text-[10px] text-(--chat-text-muted) mt-1">The API endpoint URL for your provider</p>
              </label>

              <label className="block">
                <span className="block text-xs text-(--chat-text-secondary) mb-1.5">Model ID</span>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => {
                    clearProviderConfig();
                    setModel(e.target.value);
                  }}
                  placeholder="gpt-4o"
                  className="w-full bg-(--chat-input-bg) text-(--chat-text-primary) text-sm px-3 py-2 border border-(--chat-border) placeholder:text-(--chat-text-muted) focus:outline-none focus:border-(--chat-border-active)"
                  style={inputStyle}
                />
              </label>
            </>
          )}

          {/* Auth method toggle — unchanged BYOK behavior for OAuth-capable providers. */}
          {hasOAuth && (
            <div>
              <span className="block text-xs text-(--chat-text-secondary) mb-1.5">Authentication</span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => handleAuthMethodChange("apikey")}
                  className={`flex-1 py-1.5 text-xs border transition-colors ${
                    authMethod === "apikey"
                      ? "bg-(--chat-accent) border-(--chat-accent) text-white"
                      : "bg-(--chat-input-bg) border-(--chat-border) text-(--chat-text-secondary) hover:border-(--chat-border-active)"
                  }`}
                  style={{ borderRadius: "var(--chat-radius)" }}
                >
                  API Key
                </button>
                <button
                  type="button"
                  onClick={() => handleAuthMethodChange("oauth")}
                  className={`flex-1 py-1.5 text-xs border transition-colors ${
                    authMethod === "oauth"
                      ? "bg-(--chat-accent) border-(--chat-accent) text-white"
                      : "bg-(--chat-input-bg) border-(--chat-border) text-(--chat-text-secondary) hover:border-(--chat-border-active)"
                  }`}
                  style={{ borderRadius: "var(--chat-radius)" }}
                >
                  {OAUTH_PROVIDERS[provider]?.label ?? "OAuth"}
                </button>
              </div>
            </div>
          )}

          {/* OAuth flow — click-to-login, restored from upstream. */}
          {hasOAuth && authMethod === "oauth" && (
            <div className="space-y-2">
              {oauthFlow.step === "idle" && (
                <button
                  type="button"
                  onClick={startOAuthLogin}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-xs
                             bg-(--chat-input-bg) border border-(--chat-border) text-(--chat-text-primary)
                             hover:border-(--chat-accent) hover:text-(--chat-accent) transition-colors"
                  style={{ borderRadius: "var(--chat-radius)" }}
                >
                  <ExternalLink size={12} />
                  {OAUTH_PROVIDERS[provider]?.buttonText ?? "Login"}
                </button>
              )}

              {oauthFlow.step === "awaiting-code" && (
                <div className="space-y-2">
                  <p className="text-[10px] text-(--chat-text-muted)">
                    {provider === "openai-codex"
                      ? "Complete login in the opened tab. The page will redirect to localhost and fail — copy the full URL from your browser's address bar and paste it below:"
                      : "Authorize in the opened tab, then paste the code shown on the redirect page:"}
                  </p>
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={oauthCodeInput}
                      onChange={(e) => setOauthCodeInput(e.target.value)}
                      placeholder={
                        provider === "openai-codex" ? "Paste the full redirect URL here" : "Paste code#state here"
                      }
                      className="flex-1 bg-(--chat-input-bg) text-(--chat-text-primary)
                                 text-sm px-3 py-2 border border-(--chat-border)
                                 placeholder:text-(--chat-text-muted)
                                 focus:outline-none focus:border-(--chat-border-active)"
                      style={inputStyle}
                      onKeyDown={(e) => e.key === "Enter" && submitOAuthCode()}
                    />
                    <button
                      type="button"
                      onClick={submitOAuthCode}
                      disabled={!oauthCodeInput.trim()}
                      className="px-3 py-2 text-xs bg-(--chat-accent) text-white border border-(--chat-accent)
                                 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      style={{ borderRadius: "var(--chat-radius)" }}
                    >
                      Submit
                    </button>
                  </div>
                  <p className="text-[10px] text-(--chat-text-muted)">
                    Requires CORS proxy to be enabled for token exchange.
                  </p>
                </div>
              )}

              {oauthFlow.step === "exchanging" && (
                <div
                  className="px-3 py-2.5 text-xs text-(--chat-text-muted) bg-(--chat-input-bg) border border-(--chat-border)"
                  style={{ borderRadius: "var(--chat-radius)" }}
                >
                  Exchanging authorization code…
                </div>
              )}

              {oauthFlow.step === "connected" && (
                <div
                  className="flex items-center justify-between px-3 py-2.5 bg-(--chat-input-bg) border border-(--chat-border)"
                  style={{ borderRadius: "var(--chat-radius)" }}
                >
                  <div className="flex items-center gap-2 text-xs">
                    <Check size={12} className="text-(--chat-success)" />
                    <span className="text-(--chat-text-secondary)">Connected via OAuth</span>
                  </div>
                  <button
                    type="button"
                    onClick={logoutOAuth}
                    className="flex items-center gap-1 text-[10px] text-(--chat-text-muted) hover:text-(--chat-error) transition-colors"
                  >
                    <LogOut size={10} />
                    Logout
                  </button>
                </div>
              )}

              {oauthFlow.step === "error" && (
                <div className="space-y-2">
                  <div
                    className="px-3 py-2 text-xs text-(--chat-error) bg-(--chat-input-bg) border border-(--chat-error)/30"
                    style={{ borderRadius: "var(--chat-radius)" }}
                  >
                    {oauthFlow.message}
                  </div>
                  <button
                    type="button"
                    onClick={() => setOauthFlow({ step: "idle" })}
                    className="text-[10px] text-(--chat-text-muted) hover:text-(--chat-text-secondary) transition-colors"
                  >
                    Try again
                  </button>
                </div>
              )}
            </div>
          )}

          {/* API Key input — hidden when using OAuth, matching upstream. */}
          {showApiKeyInput && (
            <label className="block">
              <span className="block text-xs text-(--chat-text-secondary) mb-1.5">
                API Key{isCustom ? " (optional)" : ""}
              </span>
              <div className="relative">
                <input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => handleApiKeyChange(e.target.value)}
                  placeholder={
                    isCustom ? "Optional — leave blank if the endpoint does not require auth" : "Enter your API key"
                  }
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
          )}

          {/* CORS Proxy — stays part of the original BYOK auth path. */}
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-(--chat-text-secondary)">CORS Proxy</span>
              <p className="text-[10px] text-(--chat-text-muted) mt-0.5">
                Leave custom URL blank on localhost to use the built-in bridge
              </p>
            </div>
            <button
              type="button"
              onClick={() => setUseProxy(!useProxy)}
              className={`w-10 h-5 rounded-full transition-colors relative ${
                useProxy ? "bg-(--chat-accent)" : "bg-(--chat-border)"
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  useProxy ? "left-5" : "left-0.5"
                }`}
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
                placeholder="Optional custom CORS proxy URL"
                className="w-full bg-(--chat-input-bg) text-(--chat-text-primary)
                           text-sm px-3 py-2 border border-(--chat-border)
                           placeholder:text-(--chat-text-muted)
                           focus:outline-none focus:border-(--chat-border-active)"
                style={inputStyle}
              />
              <p className="text-[10px] text-(--chat-text-muted) mt-1">
                Not a system/Clash proxy. Leave blank for the local development bridge.
              </p>
              {isCustom && (
                <p className="text-[10px] text-(--chat-text-muted) mt-1">
                  HTTP Custom Endpoints use the local bridge automatically in local development to avoid Excel/WebView
                  mixed-content blocking.
                </p>
              )}
            </label>
          )}

          <label className="block">
            <span className="block text-xs text-(--chat-text-secondary) mb-1.5">Response Start Timeout (seconds)</span>
            <input
              type="number"
              min={1}
              max={3600}
              step={1}
              value={responseStartTimeoutSeconds}
              onChange={(e) => {
                const next = Number.parseInt(e.target.value, 10);
                if (!Number.isFinite(next) || next < 1) return;
                if (isCustom) clearProviderConfig();
                setResponseStartTimeoutSeconds(Math.min(3600, next));
              }}
              className="w-full bg-(--chat-input-bg) text-(--chat-text-primary) text-sm px-3 py-2 border border-(--chat-border) focus:outline-none focus:border-(--chat-border-active)"
              style={inputStyle}
            />
            <p className="text-[10px] text-(--chat-text-muted) mt-1">
              Maximum wait for response headers / streaming to start. Default 180 seconds. Once streaming starts, this
              timeout no longer applies.
            </p>
          </label>

          {!isCustom && (
            <>
              {/* Model discovery is deliberately downstream of authentication. */}
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

              {discoverySource === "fallback" && (
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
            </>
          )}

          <ThinkingSelector
            value={thinking}
            onChange={(value) => {
              if (isCustom) clearProviderConfig();
              setThinking(value);
            }}
          />

          {isCustom && (
            <button
              type="button"
              onClick={applyCustomEndpoint}
              disabled={!customReady || isConfigured}
              className="w-full flex items-center justify-center gap-2 bg-(--chat-accent) text-white text-xs px-3 py-2
                         disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
              style={inputStyle}
            >
              {isConfigured ? "Custom Endpoint Active" : "Apply Custom Endpoint"}
            </button>
          )}
        </div>
      </div>

      <div className="border-t border-(--chat-border) pt-4">
        <div className="flex items-center gap-2 text-xs">
          {isConfigured ? (
            <>
              <Check size={12} className="text-(--chat-success)" />
              <span className="text-(--chat-text-secondary)">
                Using {provider} / {model}
              </span>
            </>
          ) : (
            <span className="text-(--chat-text-muted)">
              {isCustom
                ? customReady
                  ? "Custom Endpoint is not active yet — click Apply Custom Endpoint"
                  : "Enter endpoint and model (API key is optional)"
                : "Authenticate, connect, and select a model"}
            </span>
          )}
        </div>
      </div>

      <div className="border-t border-(--chat-border) pt-4">
        <div className="text-[10px] uppercase tracking-widest text-(--chat-text-muted) mb-2">about</div>
        <p className="text-xs text-(--chat-text-secondary) leading-relaxed">
          OpenExcel uses your existing provider authentication. Models are discovered only after your API key or OAuth
          login is ready.
        </p>
        {useProxy && (
          <p className="text-xs text-(--chat-text-muted) leading-relaxed mt-2">
            CORS Proxy: Requests route through your proxy to bypass browser CORS restrictions. Required for OAuth token
            exchange and providers that block browser requests.
          </p>
        )}
        <p className="text-[10px] text-(--chat-text-muted) mt-3">BYOK build · v{__APP_VERSION__}</p>
      </div>
    </div>
  );
}

function GatewaySettingsPanel() {
  const { state, setProviderConfig } = useChat();
  const [saved] = useState(loadSavedConfig);
  const savedGateway = saved?.mode === "gateway" ? saved : null;
  const [gatewayUrl, setGatewayUrl] = useState(() => savedGateway?.gatewayUrl || "");
  const [model, setModel] = useState(() => savedGateway?.model || "");
  const [models, setModels] = useState<DiscoveredModel[]>(() =>
    savedGateway?.model ? [{ id: savedGateway.model, name: savedGateway.model }] : [],
  );
  const [thinking, setThinking] = useState<ThinkingLevel>(() => savedGateway?.thinking || "none");
  const [responseStartTimeoutSeconds, setResponseStartTimeoutSeconds] = useState(
    () => savedGateway?.responseStartTimeoutSeconds ?? DEFAULT_RESPONSE_START_TIMEOUT_SECONDS,
  );
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [discoverySource, setDiscoverySource] = useState<"live" | "fallback" | null>(null);
  const followMode = state.providerConfig?.followMode ?? savedGateway?.followMode ?? true;

  useEffect(() => {
    const config: GatewayProviderConfig = {
      mode: "gateway",
      gatewayUrl: gatewayUrl.trim(),
      model,
      thinking,
      followMode,
      responseStartTimeoutSeconds,
    };
    if (gatewayUrl || model) saveConfig(config);
    if (gatewayUrl.trim() && model) setProviderConfig(config);
  }, [gatewayUrl, model, thinking, followMode, responseStartTimeoutSeconds, setProviderConfig]);

  const handleGatewayUrlChange = (value: string) => {
    setGatewayUrl(value);
    setModels([]);
    setModel("");
    setDiscoverySource(null);
    setDiscoveryError(null);
  };

  const handleDiscoverModels = async () => {
    setIsDiscovering(true);
    setDiscoveryError(null);
    try {
      const result = await discoverGatewayModels(gatewayUrl, responseStartTimeoutSeconds);
      setModels(result.models);
      setDiscoverySource(result.source);
      if (!result.models.some((item) => item.id === model)) setModel(result.models[0]?.id ?? "");
    } catch (err) {
      setDiscoveryError(err instanceof Error ? err.message : "Unable to discover models.");
    } finally {
      setIsDiscovering(false);
    }
  };

  const activeConfig = state.providerConfig;
  const isConfigured =
    activeConfig?.mode === "gateway" &&
    activeConfig.gatewayUrl === gatewayUrl.trim() &&
    activeConfig.model === model &&
    activeConfig.responseStartTimeoutSeconds === responseStartTimeoutSeconds;
  const connectLabel = models.length > 0 || discoverySource ? "Refresh Models" : "Connect";

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6" style={{ fontFamily: "var(--chat-font-mono)" }}>
      <div>
        <div className="text-[10px] uppercase tracking-widest text-(--chat-text-muted) mb-4">gateway configuration</div>
        <div className="space-y-4">
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

          <button
            type="button"
            disabled={!gatewayUrl.trim() || isDiscovering}
            onClick={handleDiscoverModels}
            className="w-full flex items-center justify-center gap-2 bg-(--chat-accent) text-white text-xs px-3 py-2
                       disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            style={inputStyle}
          >
            <RefreshCw size={13} className={isDiscovering ? "animate-spin" : ""} />
            {isDiscovering ? "Connecting..." : connectLabel}
          </button>

          {discoveryError && <p className="text-xs text-(--chat-error)">{discoveryError}</p>}

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
              <p className="text-[10px] text-(--chat-text-muted) mt-1">Models loaded live from the Gateway.</p>
            )}
          </label>

          <label className="block">
            <span className="block text-xs text-(--chat-text-secondary) mb-1.5">Response Start Timeout (seconds)</span>
            <input
              type="number"
              min={1}
              max={3600}
              step={1}
              value={responseStartTimeoutSeconds}
              onChange={(e) => {
                const next = Number.parseInt(e.target.value, 10);
                if (!Number.isFinite(next) || next < 1) return;
                setResponseStartTimeoutSeconds(Math.min(3600, next));
              }}
              className="w-full bg-(--chat-input-bg) text-(--chat-text-primary) text-sm px-3 py-2 border border-(--chat-border) focus:outline-none focus:border-(--chat-border-active)"
              style={inputStyle}
            />
            <p className="text-[10px] text-(--chat-text-muted) mt-1">
              Maximum wait for response headers / streaming to start. Default 180 seconds. Once streaming starts, this
              timeout no longer applies.
            </p>
          </label>

          <ThinkingSelector value={thinking} onChange={setThinking} />
        </div>
      </div>

      <div className="border-t border-(--chat-border) pt-4">
        <div className="flex items-center gap-2 text-xs">
          {isConfigured ? (
            <>
              <Check size={12} className="text-(--chat-success)" />
              <span className="text-(--chat-text-secondary)">Using {model}</span>
            </>
          ) : (
            <span className="text-(--chat-text-muted)">Enter the Gateway URL, connect, and select a model</span>
          )}
        </div>
      </div>

      <div className="border-t border-(--chat-border) pt-4">
        <div className="text-[10px] uppercase tracking-widest text-(--chat-text-muted) mb-2">about</div>
        <p className="text-xs text-(--chat-text-secondary) leading-relaxed">
          Gateway mode sends requests to your OpenAI-compatible enterprise gateway. Provider selection and credentials
          are controlled by the gateway, not by this add-in.
        </p>
        <p className="text-[10px] text-(--chat-text-muted) mt-3">Gateway build · v{__APP_VERSION__}</p>
      </div>
    </div>
  );
}

export function SettingsPanel() {
  return APP_MODE === "gateway" ? <GatewaySettingsPanel /> : <ByokSettingsPanel />;
}

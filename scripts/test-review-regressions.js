const assert = require("assert");
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
const corsProxy = read("src/lib/cors-proxy.ts");
const oauth = read("src/lib/oauth/index.ts");
const bridge = read("scripts/local-cors-bridge.js");
const webpackConfig = read("webpack.config.js");

assert.equal(settings.includes("saveConfig("), false, "Settings drafts must not persist directly");
assert.match(settings, /discoveryGenerationRef = useRef\(0\)/, "Discovery needs stale-response generation guards");
assert.match(chat, /restoredAgentMessagesRef/, "Chat runtime must retain native agent transcript");
assert.match(chat, /saveConfig\(config\);/, "Only applied runtime config should become the saved config");

const clearProvider = section(chat, "const clearProviderConfig", "const abort");
assert.equal(clearProvider.includes("agentRef.current = null"), false, "Invalidating config must not discard transcript");
assert.equal(clearProvider.includes("isStreamingRef.current = false"), false, "Invalidating config must not fake Agent idle");
assert.equal(clearProvider.includes("agentRef.current.abort()"), false, "Editing settings must not abort an active request");
assert.equal(
  settings.includes(
    'cancelDiscovery();\n                if (isCustom) clearProviderConfig();\n                setResponseStartTimeoutSeconds',
  ),
  false,
  "Editing Custom Endpoint response-start timeout must not abort the active request",
);
assert.match(settings, /if \(provider === "custom"\) return;/, "Custom Endpoint drafts must not auto-apply");
const customApply = section(settings, "const applyCustomEndpoint", "const activeConfig");
assert.match(customApply, /setProviderConfig\(config\);/, "Apply Custom Endpoint must be the explicit runtime commit point");
const customApiKeyChange = section(settings, "const handleApiKeyChange", "const handleDiscoverModels");
assert.match(
  customApiKeyChange,
  /if \(!isCustom\) clearProviderConfig\(\);/,
  "Non-custom credential edits should still invalidate the active provider",
);
for (const setter of ["setApiType", "setCustomBaseUrl", "setModel"]) {
  assert.equal(
    new RegExp(`clearProviderConfig\\(\\);\\s*${setter}\\(`).test(settings),
    false,
    `${setter} must remain draft-only for Custom Endpoint edits`,
  );
}
const customProxyDraft = section(settings, "const toggleProxy", "return (");
assert.equal(customProxyDraft.includes("clearProviderConfig"), false, "Custom Endpoint proxy edits must remain draft-only");
assert.equal(
  settings.includes("if (isCustom) clearProviderConfig();"),
  false,
  "Custom Endpoint field edits must never clear the applied runtime config",
);
assert.match(
  settings,
  /<ThinkingSelector value=\{thinking\} onChange=\{setThinking\} \/>/,
  "Custom Endpoint thinking edits must remain draft-only",
);

const abortSection = section(chat, "const abort", "const sendMessage");
assert.equal(abortSection.includes("isStreamingRef.current = false"), false, "Abort must wait for agent_end");
assert.match(chat, /getActiveApiKey\(cfg, options\?\.signal\)/, "OAuth refresh must inherit the Agent abort signal");
assert.match(chat, /waitForIdle\(\)/, "Reset after abort must wait for the Agent to become idle");
assert.match(chat, /suppressNextSessionSaveRef/, "Clear must suppress the stale post-abort autosave race");
assert.match(chat, /restoreSessionAgentMessages/, "Legacy or empty sessions must preserve the Agent system baseline");
assert.match(chat, /agentMessages\[agentMessages.length - 1\] === event.message/, "Error/aborted UI and Agent histories must stay aligned");
const newSessionSection = section(chat, "const newSession", "const switchSession");
assert.ok(
  newSessionSection.indexOf("createSession(") < newSessionSection.indexOf("agentRef.current?.reset()"),
  "New-session storage must succeed before clearing the active transcript",
);
const deleteSessionSection = section(chat, "const deleteCurrentSession", "const prevStreamingRef");
assert.equal(
  deleteSessionSection.includes("agentRef.current?.reset()"),
  false,
  "Delete must not clear the active transcript before storage succeeds",
);

assert.match(storage, /agentMessages: AgentMessage\[\]/, "Sessions must persist provider-native agent messages");
assert.match(discovery, /reasoning: true,[\s\S]*input: \["text", "image"\]/, "Custom Endpoint capabilities regressed");
assert.equal(discovery.includes("record.supported_in_api === false"), false, "ChatGPT picker must not filter by public API support");
assert.match(discovery, /\[404, 405, 501\]/, "Unsupported /models endpoints must fall back deliberately");
assert.match(discovery, /Gateway URL must use HTTPS/, "Gateway URL must enforce HTTPS");

assert.match(corsProxy, /requiresAmbientFetch/, "Runtime fetch injection must be adapter-aware");
assert.match(corsProxy, /details\.provider === "google"/, "Google Generative AI must retain ambient fetch");
assert.match(corsProxy, /details\.provider === "google-vertex"/, "Google Vertex must retain ambient fetch");
assert.match(corsProxy, /return globalThis\.fetch/, "Unsupported custom-fetch adapters must receive the ambient fetch identity");
assert.match(
  corsProxy,
  /LOCAL_BRIDGE_RESPONSE_START_GRACE_SECONDS/,
  "Browser bridge timeout needs grace beyond the bridge upstream deadline",
);
assert.match(bridge, /isTrustedTaskpaneRequest/, "Local bridge must enforce same-origin taskpane trust");
assert.match(bridge, /response\.flushHeaders\(\)/, "Local bridge must expose upstream headers before delayed SSE body bytes");
assert.match(oauth, /createCorsProxyFetch/, "OAuth refresh must use the bounded/cancellable fetch path");
assert.match(oauth, /signal: options\.signal/, "OAuth refresh must honor caller cancellation");
assert.match(webpackConfig, /dev \|\| openExcelMode === "byok"/, "Gateway production build must not package BYOK manifests");

console.log("Review regression checks passed");

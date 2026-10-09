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
assert.match(chat, /suppressNextSessionSaveRef/, "Clear must suppress the stale post-abort autosave race");
assert.match(chat, /restoreSessionAgentMessages/, "Legacy or empty sessions must preserve the Agent system baseline");
assert.match(chat, /agentMessages\[agentMessages.length - 1\] === event.message/, "Error/aborted UI and Agent histories must stay aligned");

assert.match(storage, /agentMessages: AgentMessage\[\]/, "Sessions must persist provider-native agent messages");
assert.match(discovery, /reasoning: true,[\s\S]*input: \["text", "image"\]/, "Custom Endpoint capabilities regressed");
assert.equal(discovery.includes("record.supported_in_api === false"), false, "ChatGPT picker must not filter by public API support");
assert.match(discovery, /\[404, 405, 501\]/, "Unsupported /models endpoints must fall back deliberately");
assert.match(discovery, /Gateway URL must use HTTPS/, "Gateway URL must enforce HTTPS");
assert.match(webpackConfig, /dev \|\| openExcelMode === "byok"/, "Gateway production build must not package BYOK manifests");

console.log("Review regression checks passed");

import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type ThinkingLevel as AgentThinkingLevel,
} from "@earendil-works/pi-agent-core";
import {
  type AssistantMessage,
  getProviders,
  type Model,
  streamSimple,
  type Usage,
} from "@earendil-works/pi-ai/compat";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createCorsProxyFetch } from "../../../lib/cors-proxy";
import type { DirtyRange } from "../../../lib/dirty-tracker";
import { getWorkbookMetadata, navigateTo } from "../../../lib/excel/api";
import { loadOAuthCredentials, refreshOAuthToken } from "../../../lib/oauth";
import {
  type ChatSession,
  createSession,
  deleteSession,
  getOrCreateCurrentSession,
  getOrCreateWorkbookId,
  getSession,
  listSessions,
  saveSession,
} from "../../../lib/storage";
import { EXCEL_TOOLS } from "../../../lib/tools";
import { isConfigReady, loadSavedConfig, type ProviderConfig, saveConfig, type ThinkingLevel } from "./config";
import { apiKeyForConfig, resolveConfiguredModel } from "./model-discovery";

export type ToolCallStatus = "pending" | "running" | "complete" | "error";

export type MessagePart =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | {
      type: "toolCall";
      id: string;
      name: string;
      args: Record<string, unknown>;
      status: ToolCallStatus;
      result?: string;
    };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
  timestamp: number;
}

export interface SessionStats {
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  totalCost: number;
  contextWindow: number;
  lastUsage: Usage | null;
}

function parseDirtyRanges(result: string | undefined): DirtyRange[] | null {
  if (!result) return null;
  try {
    const parsed = JSON.parse(result);
    if (parsed._dirtyRanges && Array.isArray(parsed._dirtyRanges)) {
      return parsed._dirtyRanges;
    }
  } catch {
    // Not valid JSON or no dirty ranges
  }
  return null;
}

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  providerConfig: ProviderConfig | null;
  sessionStats: SessionStats;
  currentSession: ChatSession | null;
  sessions: ChatSession[];
  sheetNames: Record<number, string>;
}

const INITIAL_STATS: SessionStats = {
  inputTokens: 0,
  outputTokens: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalCost: 0,
  contextWindow: 0,
  lastUsage: null,
};

interface ChatContextValue {
  state: ChatState;
  sendMessage: (content: string) => Promise<void>;
  setProviderConfig: (config: ProviderConfig) => void;
  clearProviderConfig: () => void;
  clearMessages: () => void;
  abort: () => void;
  availableProviders: string[];
  newSession: () => Promise<void>;
  switchSession: (sessionId: string) => Promise<void>;
  deleteCurrentSession: () => Promise<void>;
  getSheetName: (sheetId: number) => string | undefined;
  toggleFollowMode: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

const SYSTEM_PROMPT = `You are an AI assistant integrated into Microsoft Excel with full access to read and modify spreadsheet data.

Available tools:
READ:
- get_cell_ranges: Read cell values, formulas, and formatting
- get_range_as_csv: Get data as CSV (great for analysis)
- search_data: Find text across the spreadsheet
- get_all_objects: List charts, pivot tables, etc.

WRITE:
- set_cell_range: Write values, formulas, and formatting
- clear_cell_range: Clear contents or formatting
- copy_to: Copy ranges with formula translation
- modify_sheet_structure: Insert/delete/hide rows/columns, freeze panes
- modify_workbook_structure: Create/delete/rename sheets
- resize_range: Adjust column widths and row heights
- modify_object: Create/update/delete charts and pivot tables

Citations: Use markdown links with #cite: hash to reference sheets/cells. Clicking navigates there.
- Sheet only: [Sheet Name](#cite:sheetId)
- Cell/range: [A1:B10](#cite:sheetId!A1:B10)
Example: [Exchange Ratio](#cite:3) or [see cell B5](#cite:3!B5)

When the user asks about their data, read it first. Be concise. Use A1 notation for cell references.`;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function thinkingLevelToAgent(level: ThinkingLevel): AgentThinkingLevel {
  return level === "none" ? "off" : level;
}

function extractPartsFromAssistantMessage(message: AgentMessage, existingParts: MessagePart[] = []): MessagePart[] {
  if (message.role !== "assistant") return existingParts;

  const assistantMsg = message as AssistantMessage;
  const existingToolCalls = new Map<string, MessagePart>();
  for (const part of existingParts) {
    if (part.type === "toolCall") {
      existingToolCalls.set(part.id, part);
    }
  }

  return assistantMsg.content.map((block): MessagePart => {
    if (block.type === "text") {
      return { type: "text", text: block.text };
    }
    if (block.type === "thinking") {
      return { type: "thinking", thinking: block.thinking };
    }
    const existing = existingToolCalls.get(block.id);
    return {
      type: "toolCall",
      id: block.id,
      name: block.name,
      args: block.arguments as Record<string, unknown>,
      status: existing?.type === "toolCall" ? existing.status : "pending",
      result: existing?.type === "toolCall" ? existing.result : undefined,
    };
  });
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ChatState>(() => ({
    messages: [],
    isStreaming: false,
    error: null,
    // Do not enable input from synchronous localStorage before the matching
    // IndexedDB session/native Agent transcript has been restored.
    providerConfig: null,
    sessionStats: INITIAL_STATS,
    currentSession: null,
    sessions: [],
    sheetNames: {},
  }));

  const agentRef = useRef<Agent | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);
  const isStreamingRef = useRef(false);
  const pendingConfigRef = useRef<ProviderConfig | null>(null);
  const workbookIdRef = useRef<string | null>(null);
  const sessionLoadedRef = useRef(false);
  const currentSessionIdRef = useRef<string | null>(null);
  const followModeRef = useRef(true);
  const restoredAgentMessagesRef = useRef<AgentMessage[]>([]);
  const suppressNextSessionSaveRef = useRef(false);

  const availableProviders = getProviders();

  const handleAgentEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case "message_start": {
        if (event.message.role === "assistant") {
          const id = generateId();
          streamingMessageIdRef.current = id;
          const parts = extractPartsFromAssistantMessage(event.message);
          const chatMessage: ChatMessage = {
            id,
            role: "assistant",
            parts,
            timestamp: event.message.timestamp,
          };
          setState((prev) => ({
            ...prev,
            messages: [...prev.messages, chatMessage],
          }));
        }
        break;
      }
      case "message_update": {
        const messageId = streamingMessageIdRef.current;
        if (event.message.role === "assistant" && messageId) {
          setState((prev) => {
            const messages = [...prev.messages];
            const idx = messages.findIndex((m) => m.id === messageId);
            if (idx !== -1) {
              const parts = extractPartsFromAssistantMessage(event.message, messages[idx].parts);
              messages[idx] = { ...messages[idx], parts };
            }
            return { ...prev, messages };
          });
        }
        break;
      }
      case "message_end": {
        if (event.message.role === "assistant") {
          const messageId = streamingMessageIdRef.current;
          const assistantMsg = event.message as AssistantMessage;
          const isError = assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted";
          if (isError && agentRef.current) {
            const agentMessages = agentRef.current.state.messages;
            if (agentMessages[agentMessages.length - 1] === event.message) {
              agentRef.current.state.messages = agentMessages.slice(0, -1);
            }
          }
          setState((prev) => {
            const messages = [...prev.messages];
            const idx = messageId ? messages.findIndex((m) => m.id === messageId) : -1;

            if (isError) {
              if (idx !== -1) messages.splice(idx, 1);
            } else if (idx !== -1) {
              const parts = extractPartsFromAssistantMessage(event.message, messages[idx].parts);
              messages[idx] = { ...messages[idx], parts };
            }

            return {
              ...prev,
              messages,
              error: isError ? assistantMsg.errorMessage || "Request failed" : prev.error,
              sessionStats: isError
                ? prev.sessionStats
                : {
                    inputTokens: prev.sessionStats.inputTokens + assistantMsg.usage.input,
                    outputTokens: prev.sessionStats.outputTokens + assistantMsg.usage.output,
                    cacheRead: prev.sessionStats.cacheRead + assistantMsg.usage.cacheRead,
                    cacheWrite: prev.sessionStats.cacheWrite + assistantMsg.usage.cacheWrite,
                    totalCost: prev.sessionStats.totalCost + assistantMsg.usage.cost.total,
                    contextWindow: prev.sessionStats.contextWindow,
                    lastUsage: assistantMsg.usage,
                  },
            };
          });
          streamingMessageIdRef.current = null;
        }
        break;
      }
      case "tool_execution_start": {
        setState((prev) => {
          const messages = [...prev.messages];
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            const partIdx = msg.parts.findIndex((p) => p.type === "toolCall" && p.id === event.toolCallId);
            if (partIdx !== -1) {
              const parts = [...msg.parts];
              const part = parts[partIdx];
              if (part.type === "toolCall") {
                parts[partIdx] = { ...part, status: "running" };
                messages[i] = { ...msg, parts };
              }
              break;
            }
          }
          return { ...prev, messages };
        });
        break;
      }
      case "tool_execution_update": {
        setState((prev) => {
          const messages = [...prev.messages];
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            const partIdx = msg.parts.findIndex((p) => p.type === "toolCall" && p.id === event.toolCallId);
            if (partIdx !== -1) {
              const parts = [...msg.parts];
              const part = parts[partIdx];
              if (part.type === "toolCall") {
                let partialText: string;
                if (typeof event.partialResult === "string") {
                  partialText = event.partialResult;
                } else if (event.partialResult?.content && Array.isArray(event.partialResult.content)) {
                  partialText = event.partialResult.content
                    .filter((c: { type: string }) => c.type === "text")
                    .map((c: { text: string }) => c.text)
                    .join("\n");
                } else {
                  partialText = JSON.stringify(event.partialResult, null, 2);
                }
                parts[partIdx] = { ...part, result: partialText };
                messages[i] = { ...msg, parts };
              }
              break;
            }
          }
          return { ...prev, messages };
        });
        break;
      }
      case "tool_execution_end": {
        let resultText: string;
        if (typeof event.result === "string") {
          resultText = event.result;
        } else if (event.result?.content && Array.isArray(event.result.content)) {
          resultText = event.result.content
            .filter((c: { type: string }) => c.type === "text")
            .map((c: { text: string }) => c.text)
            .join("\n");
        } else {
          resultText = JSON.stringify(event.result, null, 2);
        }

        if (!event.isError && followModeRef.current) {
          const dirtyRanges = parseDirtyRanges(resultText);
          if (dirtyRanges && dirtyRanges.length > 0) {
            const first = dirtyRanges[0];
            if (first.sheetId >= 0 && first.range !== "*") {
              navigateTo(first.sheetId, first.range).catch((err) => {
                console.error("[FollowMode] Navigation failed:", err);
              });
            } else if (first.sheetId >= 0) {
              navigateTo(first.sheetId).catch((err) => {
                console.error("[FollowMode] Navigation failed:", err);
              });
            }
          }
        }

        setState((prev) => {
          const messages = [...prev.messages];
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            const partIdx = msg.parts.findIndex((p) => p.type === "toolCall" && p.id === event.toolCallId);
            if (partIdx !== -1) {
              const parts = [...msg.parts];
              const part = parts[partIdx];
              if (part.type === "toolCall") {
                parts[partIdx] = { ...part, status: event.isError ? "error" : "complete", result: resultText };
                messages[i] = { ...msg, parts };
              }
              break;
            }
          }
          return { ...prev, messages };
        });
        break;
      }
      case "agent_end": {
        isStreamingRef.current = false;
        if (agentRef.current) {
          restoredAgentMessagesRef.current = [...agentRef.current.state.messages];
        }
        setState((prev) => ({ ...prev, isStreaming: false }));
        streamingMessageIdRef.current = null;
        break;
      }
    }
  }, []);

  const configRef = useRef<ProviderConfig | null>(null);

  const getActiveApiKey = useCallback(async (config: ProviderConfig, signal?: AbortSignal): Promise<string> => {
    if (config.mode !== "byok" || config.authMethod !== "oauth") {
      return apiKeyForConfig(config);
    }

    const creds = loadOAuthCredentials(config.provider);
    if (!creds) {
      throw new Error("OAuth session is no longer available. Please sign in again.");
    }
    if (Date.now() < creds.expires) return creds.access;

    const refreshed = await refreshOAuthToken(config.provider, creds.refresh, config.proxyUrl, config.useProxy, {
      responseStartTimeoutSeconds: config.responseStartTimeoutSeconds,
      signal,
    });
    return refreshed.access;
  }, []);

  const applyConfig = useCallback(
    (config: ProviderConfig) => {
      let contextWindow = 0;
      let baseModel: Model<any>;
      try {
        baseModel = resolveConfiguredModel(config);
        contextWindow = baseModel.contextWindow;
      } catch (err) {
        setState((prev) => ({
          ...prev,
          error: err instanceof Error ? err.message : "Unable to configure the selected model",
        }));
        return;
      }

      configRef.current = config;
      const existingMessages = agentRef.current?.state.messages ?? restoredAgentMessagesRef.current;

      if (agentRef.current) {
        agentRef.current.abort();
      }

      const agent = new Agent({
        initialState: {
          model: baseModel,
          systemPrompt: SYSTEM_PROMPT,
          thinkingLevel: thinkingLevelToAgent(config.thinking),
          tools: EXCEL_TOOLS,
          messages: existingMessages,
        },
        streamFn: async (model, context, options) => {
          const cfg = configRef.current ?? config;
          const isCustomEndpoint = cfg.mode === "byok" && cfg.provider === "custom";
          const customWithoutAuth = isCustomEndpoint && !cfg.apiKey.trim();
          const omitAuthentication = cfg.mode === "gateway" || customWithoutAuth;
          let apiKey = await getActiveApiKey(cfg, options?.signal);

          if (customWithoutAuth) {
            apiKey = "openexcel-custom-no-auth";
          }

          const proxyOptions =
            cfg.mode === "byok"
              ? cfg
              : {
                  useProxy: false,
                  proxyUrl: "",
                  responseStartTimeoutSeconds: cfg.responseStartTimeoutSeconds,
                };

          const streamOptions: Record<string, unknown> = {
            ...options,
            apiKey,
            fetch: createCorsProxyFetch(proxyOptions, {
              customEndpoint: isCustomEndpoint,
              omitAuthentication,
            }),
          };

          if (omitAuthentication) {
            streamOptions.headers = {
              ...((options as { headers?: Record<string, string | null> }).headers ?? {}),
              authorization: null,
              "api-key": null,
              "x-api-key": null,
            };
          }

          return streamSimple(model, context, streamOptions as any);
        },
      });
      agentRef.current = agent;
      agent.subscribe(handleAgentEvent);
      pendingConfigRef.current = null;

      followModeRef.current = config.followMode ?? true;
      restoredAgentMessagesRef.current = [...existingMessages];
      saveConfig(config);

      setState((prev) => ({
        ...prev,
        providerConfig: config,
        error: null,
        sessionStats: { ...prev.sessionStats, contextWindow },
      }));
    },
    [handleAgentEvent, getActiveApiKey],
  );

  const setProviderConfig = useCallback(
    (config: ProviderConfig) => {
      if (isStreamingRef.current) {
        pendingConfigRef.current = config;
        setState((prev) => ({ ...prev, providerConfig: config }));
        return;
      }
      applyConfig(config);
    },
    [applyConfig],
  );

  const clearProviderConfig = useCallback(() => {
    if (agentRef.current) {
      restoredAgentMessagesRef.current = [...agentRef.current.state.messages];
    }
    configRef.current = null;
    pendingConfigRef.current = null;
    setState((prev) => ({
      ...prev,
      providerConfig: null,
      error: null,
      sessionStats: { ...prev.sessionStats, contextWindow: 0 },
    }));
  }, []);

  const abort = useCallback(() => {
    agentRef.current?.abort();
  }, []);

  const restoreSessionAgentMessages = useCallback((messages: AgentMessage[]) => {
    const agent = agentRef.current;
    if (messages.length > 0) {
      restoredAgentMessagesRef.current = [...messages];
      if (agent) agent.state.messages = restoredAgentMessagesRef.current;
      return;
    }

    if (agent) {
      agent.reset();
      restoredAgentMessagesRef.current = [...agent.state.messages];
    } else {
      restoredAgentMessagesRef.current = [];
    }
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      if (pendingConfigRef.current) {
        applyConfig(pendingConfigRef.current);
      }
      const agent = agentRef.current;
      if (!agent || !state.providerConfig) {
        setState((prev) => ({ ...prev, error: "Please configure a model first" }));
        return;
      }

      const userMessage: ChatMessage = {
        id: generateId(),
        role: "user",
        parts: [{ type: "text", text: content }],
        timestamp: Date.now(),
      };

      isStreamingRef.current = true;
      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
        isStreaming: true,
        error: null,
      }));

      try {
        let promptContent = content;
        try {
          const metadata = await getWorkbookMetadata();
          promptContent = `<wb_context>\n${JSON.stringify(metadata, null, 2)}\n</wb_context>\n\n${content}`;

          if (metadata.sheetsMetadata) {
            const newSheetNames: Record<number, string> = {};
            for (const sheet of metadata.sheetsMetadata) {
              newSheetNames[sheet.id] = sheet.name;
            }
            setState((prev) => ({ ...prev, sheetNames: newSheetNames }));
          }
        } catch (err) {
          console.error("[Chat] Failed to get workbook metadata:", err);
        }
        await agent.prompt(promptContent);
      } catch (err) {
        console.error("[Chat] sendMessage error:", err);
        isStreamingRef.current = false;
        setState((prev) => ({
          ...prev,
          isStreaming: false,
          error: err instanceof Error ? err.message : "An error occurred",
        }));
      }
    },
    [state.providerConfig, applyConfig],
  );

  const clearMessages = useCallback(() => {
    const clear = async () => {
      const agent = agentRef.current;
      if (agent && isStreamingRef.current) {
        // agent_end normally triggers the session autosave effect. Clear performs
        // its own authoritative empty-session save below, so suppress that one
        // transition to prevent a stale pre-clear save from racing with it.
        suppressNextSessionSaveRef.current = true;
        agent.abort();
        await agent.waitForIdle();
      }

      if (agentRef.current) {
        agentRef.current.reset();
        restoredAgentMessagesRef.current = [...agentRef.current.state.messages];
      } else {
        restoredAgentMessagesRef.current = [];
      }

      isStreamingRef.current = false;
      if (currentSessionIdRef.current) {
        await saveSession(currentSessionIdRef.current, [], restoredAgentMessagesRef.current);
      }
      setState((prev) => ({
        ...prev,
        messages: [],
        isStreaming: false,
        error: null,
        sessionStats: INITIAL_STATS,
      }));
    };

    void clear().catch((err) => {
      console.error("[Chat] Failed to clear messages:", err);
    });
  }, []);

  const refreshSessions = useCallback(async () => {
    if (!workbookIdRef.current) return;
    const sessions = await listSessions(workbookIdRef.current);
    setState((prev) => ({ ...prev, sessions }));
  }, []);

  const newSession = useCallback(async () => {
    if (!workbookIdRef.current) {
      console.error("[Chat] Cannot create session: workbookId not set");
      return;
    }
    if (isStreamingRef.current) {
      return;
    }
    try {
      const session = await createSession(workbookIdRef.current);
      agentRef.current?.reset();
      restoredAgentMessagesRef.current = agentRef.current ? [...agentRef.current.state.messages] : [];
      currentSessionIdRef.current = session.id;
      await refreshSessions();
      setState((prev) => ({
        ...prev,
        messages: [],
        currentSession: session,
        error: null,
        sessionStats: INITIAL_STATS,
      }));
    } catch (err) {
      console.error("[Chat] Failed to create session:", err);
    }
  }, [refreshSessions]);

  const switchSession = useCallback(
    async (sessionId: string) => {
      if (currentSessionIdRef.current === sessionId) return;
      if (isStreamingRef.current) {
        return;
      }
      try {
        const session = await getSession(sessionId);
        if (!session) {
          console.error("[Chat] Session not found:", sessionId);
          return;
        }
        currentSessionIdRef.current = session.id;
        restoreSessionAgentMessages(session.agentMessages);
        setState((prev) => ({
          ...prev,
          messages: session.messages,
          currentSession: session,
          error: null,
          sessionStats: INITIAL_STATS,
        }));
      } catch (err) {
        console.error("[Chat] Failed to switch session:", err);
      }
    },
    [restoreSessionAgentMessages],
  );

  const deleteCurrentSession = useCallback(async () => {
    if (!currentSessionIdRef.current || !workbookIdRef.current) return;
    if (isStreamingRef.current) {
      return;
    }
    await deleteSession(currentSessionIdRef.current);
    const session = await getOrCreateCurrentSession(workbookIdRef.current);
    currentSessionIdRef.current = session.id;
    restoreSessionAgentMessages(session.agentMessages);
    await refreshSessions();
    setState((prev) => ({
      ...prev,
      messages: session.messages,
      currentSession: session,
      error: null,
      sessionStats: INITIAL_STATS,
    }));
  }, [refreshSessions, restoreSessionAgentMessages]);

  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (prevStreamingRef.current && !state.isStreaming && currentSessionIdRef.current) {
      if (suppressNextSessionSaveRef.current) {
        suppressNextSessionSaveRef.current = false;
      } else {
        const sessionId = currentSessionIdRef.current;
        const agentMessages = agentRef.current
          ? [...agentRef.current.state.messages]
          : restoredAgentMessagesRef.current;
        restoredAgentMessagesRef.current = agentMessages;
        saveSession(sessionId, state.messages, agentMessages)
          .then(async () => {
            await refreshSessions();
            const updated = await getSession(sessionId);
            if (updated) {
              setState((prev) => ({ ...prev, currentSession: updated }));
            }
          })
          .catch(console.error);
      }
    }
    prevStreamingRef.current = state.isStreaming;
  }, [state.isStreaming, state.messages, refreshSessions]);

  useEffect(() => {
    return () => {
      agentRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (sessionLoadedRef.current) return;
    sessionLoadedRef.current = true;

    getOrCreateWorkbookId()
      .then(async (id) => {
        workbookIdRef.current = id;
        const session = await getOrCreateCurrentSession(id);
        currentSessionIdRef.current = session.id;
        const sessions = await listSessions(id);
        restoreSessionAgentMessages(session.agentMessages);
        setState((prev) => ({
          ...prev,
          messages: session.messages,
          currentSession: session,
          sessions,
        }));

        // Only enable the saved runtime after the matching display/native
        // transcript has been restored, so a fast first send cannot be overwritten
        // by the asynchronous IndexedDB startup load.
        const saved = loadSavedConfig();
        if (isConfigReady(saved)) {
          setProviderConfig(saved);
        }
      })
      .catch((err) => {
        console.error("[Chat] Failed to load session:", err);
      });
  }, [restoreSessionAgentMessages, setProviderConfig]);

  const getSheetName = useCallback(
    (sheetId: number): string | undefined => state.sheetNames[sheetId],
    [state.sheetNames],
  );

  const toggleFollowMode = useCallback(() => {
    setState((prev) => {
      if (!prev.providerConfig) return prev;
      const newFollowMode = !prev.providerConfig.followMode;
      followModeRef.current = newFollowMode;
      const newConfig = { ...prev.providerConfig, followMode: newFollowMode };
      if (pendingConfigRef.current) {
        pendingConfigRef.current = { ...pendingConfigRef.current, followMode: newFollowMode };
      }
      if (configRef.current) {
        configRef.current = { ...configRef.current, followMode: newFollowMode };
        saveConfig(configRef.current);
      }
      return { ...prev, providerConfig: newConfig };
    });
  }, []);

  return (
    <ChatContext.Provider
      value={{
        state,
        sendMessage,
        setProviderConfig,
        clearProviderConfig,
        clearMessages,
        abort,
        availableProviders,
        newSession,
        switchSession,
        deleteCurrentSession,
        getSheetName,
        toggleFollowMode,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) throw new Error("useChat must be used within ChatProvider");
  return context;
}

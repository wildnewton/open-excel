from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}: {old[:120]!r}")
    target.write_text(text.replace(old, new, 1))


chat = "src/taskpane/components/chat/chat-context.tsx"

# Agent internally appends error/aborted assistant messages before notifying
# listeners. The UI deliberately removes those messages, so remove the same
# terminal error message from the Agent transcript to keep both histories in sync.
replace_once(
    chat,
    '''          const assistantMsg = event.message as AssistantMessage;\n          const isError = assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted";\n          setState((prev) => {''',
    '''          const assistantMsg = event.message as AssistantMessage;\n          const isError = assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted";\n          if (isError && agentRef.current) {\n            const agentMessages = agentRef.current.state.messages;\n            if (agentMessages[agentMessages.length - 1] === event.message) {\n              agentRef.current.state.messages = agentMessages.slice(0, -1);\n            }\n          }\n          setState((prev) => {''',
)

# Empty/legacy sessions do not yet contain a persisted native Agent transcript.
# Never assign [] directly to an existing Agent because that removes the leading
# system/tool baseline. Reset instead, which preserves/recreates that baseline.
replace_once(
    chat,
    '''  const abort = useCallback(() => {\n    agentRef.current?.abort();\n  }, []);\n\n  const sendMessage = useCallback(''',
    '''  const abort = useCallback(() => {\n    agentRef.current?.abort();\n  }, []);\n\n  const restoreSessionAgentMessages = useCallback((messages: AgentMessage[]) => {\n    const agent = agentRef.current;\n    if (messages.length > 0) {\n      restoredAgentMessagesRef.current = [...messages];\n      if (agent) agent.state.messages = restoredAgentMessagesRef.current;\n      return;\n    }\n\n    if (agent) {\n      agent.reset();\n      restoredAgentMessagesRef.current = [...agent.state.messages];\n    } else {\n      restoredAgentMessagesRef.current = [];\n    }\n  }, []);\n\n  const sendMessage = useCallback(''',
)

replace_once(
    chat,
    '''    agentRef.current?.reset();\n    try {\n      const session = await getSession(sessionId);''',
    '''    try {\n      const session = await getSession(sessionId);''',
)
replace_once(
    chat,
    '''      currentSessionIdRef.current = session.id;\n      restoredAgentMessagesRef.current = [...session.agentMessages];\n      if (agentRef.current) {\n        agentRef.current.state.messages = restoredAgentMessagesRef.current;\n      }\n      setState((prev) => ({''',
    '''      currentSessionIdRef.current = session.id;\n      restoreSessionAgentMessages(session.agentMessages);\n      setState((prev) => ({''',
)
replace_once(chat, '''  }, []);\n\n  const deleteCurrentSession = useCallback(async () => {''', '''  }, [restoreSessionAgentMessages]);\n\n  const deleteCurrentSession = useCallback(async () => {''')

replace_once(
    chat,
    '''    currentSessionIdRef.current = session.id;\n    restoredAgentMessagesRef.current = [...session.agentMessages];\n    if (agentRef.current) {\n      agentRef.current.state.messages = restoredAgentMessagesRef.current;\n    }\n    await refreshSessions();''',
    '''    currentSessionIdRef.current = session.id;\n    restoreSessionAgentMessages(session.agentMessages);\n    await refreshSessions();''',
)
replace_once(chat, '''  }, [refreshSessions]);\n\n  const prevStreamingRef = useRef(false);''', '''  }, [refreshSessions, restoreSessionAgentMessages]);\n\n  const prevStreamingRef = useRef(false);''')

replace_once(
    chat,
    '''        const sessions = await listSessions(id);\n        restoredAgentMessagesRef.current = [...session.agentMessages];\n        if (agentRef.current && !isStreamingRef.current) {\n          agentRef.current.state.messages = restoredAgentMessagesRef.current;\n        }\n        setState((prev) => ({''',
    '''        const sessions = await listSessions(id);\n        if (!isStreamingRef.current) {\n          restoreSessionAgentMessages(session.agentMessages);\n        } else {\n          restoredAgentMessagesRef.current = [...session.agentMessages];\n        }\n        setState((prev) => ({''',
)
replace_once(chat, '''  }, []);\n\n  useEffect(() => {\n    const saved = loadSavedConfig();''', '''  }, [restoreSessionAgentMessages]);\n\n  useEffect(() => {\n    const saved = loadSavedConfig();''')

# Extend the targeted source-regression suite for the two edge cases above.
test = "scripts/test-review-regressions.js"
replace_once(
    test,
    '''assert.match(chat, /suppressNextSessionSaveRef/, "Clear must suppress the stale post-abort autosave race");\n\nassert.match(storage,''',
    '''assert.match(chat, /suppressNextSessionSaveRef/, "Clear must suppress the stale post-abort autosave race");\nassert.match(chat, /restoreSessionAgentMessages/, "Legacy or empty sessions must preserve the Agent system baseline");\nassert.match(chat, /agentMessages\\[agentMessages.length - 1\\] === event.message/, "Error/aborted UI and Agent histories must stay aligned");\n\nassert.match(storage,''',
)

print("Applied session edge fixes")

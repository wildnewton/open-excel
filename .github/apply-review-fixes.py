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
replace_once(
    chat,
    '''  const followModeRef = useRef(state.providerConfig?.followMode ?? true);\n  const restoredAgentMessagesRef = useRef<AgentMessage[]>([]);''',
    '''  const followModeRef = useRef(state.providerConfig?.followMode ?? true);\n  const restoredAgentMessagesRef = useRef<AgentMessage[]>([]);\n  const suppressNextSessionSaveRef = useRef(false);''',
)
replace_once(
    chat,
    '''      if (agent && isStreamingRef.current) {\n        agent.abort();\n        await agent.waitForIdle();\n      }''',
    '''      if (agent && isStreamingRef.current) {\n        // agent_end normally triggers the session autosave effect. Clear performs\n        // its own authoritative empty-session save below, so suppress that one\n        // transition to prevent a stale pre-clear save from racing with it.\n        suppressNextSessionSaveRef.current = true;\n        agent.abort();\n        await agent.waitForIdle();\n      }''',
)
replace_once(
    chat,
    '''  useEffect(() => {\n    if (prevStreamingRef.current && !state.isStreaming && currentSessionIdRef.current) {\n      const sessionId = currentSessionIdRef.current;\n      const agentMessages = agentRef.current ? [...agentRef.current.state.messages] : restoredAgentMessagesRef.current;\n      restoredAgentMessagesRef.current = agentMessages;\n      saveSession(sessionId, state.messages, agentMessages)\n        .then(async () => {\n          await refreshSessions();\n          const updated = await getSession(sessionId);\n          if (updated) {\n            setState((prev) => ({ ...prev, currentSession: updated }));\n          }\n        })\n        .catch(console.error);\n    }\n    prevStreamingRef.current = state.isStreaming;\n  }, [state.isStreaming, state.messages, refreshSessions]);''',
    '''  useEffect(() => {\n    if (prevStreamingRef.current && !state.isStreaming && currentSessionIdRef.current) {\n      if (suppressNextSessionSaveRef.current) {\n        suppressNextSessionSaveRef.current = false;\n      } else {\n        const sessionId = currentSessionIdRef.current;\n        const agentMessages = agentRef.current ? [...agentRef.current.state.messages] : restoredAgentMessagesRef.current;\n        restoredAgentMessagesRef.current = agentMessages;\n        saveSession(sessionId, state.messages, agentMessages)\n          .then(async () => {\n            await refreshSessions();\n            const updated = await getSession(sessionId);\n            if (updated) {\n              setState((prev) => ({ ...prev, currentSession: updated }));\n            }\n          })\n          .catch(console.error);\n      }\n    }\n    prevStreamingRef.current = state.isStreaming;\n  }, [state.isStreaming, state.messages, refreshSessions]);''',
)

test = "scripts/test-review-regressions.js"
replace_once(
    test,
    '''assert.match(chat, /waitForIdle\\(\\)/, "Reset after abort must wait for the Agent to become idle");\n\nassert.match(storage,''',
    '''assert.match(chat, /waitForIdle\\(\\)/, "Reset after abort must wait for the Agent to become idle");\nassert.match(chat, /suppressNextSessionSaveRef/, "Clear must suppress the stale post-abort autosave race");\n\nassert.match(storage,''',
)

print("Applied clear-session persistence race fix")

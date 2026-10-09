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

# Do not clear the current Agent transcript until creating the replacement
# session has actually succeeded. Otherwise an IndexedDB failure leaves the old
# session visible while its runtime context has already been erased.
replace_once(
    chat,
    '''    try {\n      agentRef.current?.reset();\n      restoredAgentMessagesRef.current = agentRef.current ? [...agentRef.current.state.messages] : [];\n      const session = await createSession(workbookIdRef.current);\n      currentSessionIdRef.current = session.id;''',
    '''    try {\n      const session = await createSession(workbookIdRef.current);\n      agentRef.current?.reset();\n      restoredAgentMessagesRef.current = agentRef.current ? [...agentRef.current.state.messages] : [];\n      currentSessionIdRef.current = session.id;''',
)

# Deletion similarly should not reset the active transcript before the delete
# succeeds. The selected replacement session is restored immediately afterward.
replace_once(
    chat,
    '''    agentRef.current?.reset();\n    await deleteSession(currentSessionIdRef.current);''',
    '''    await deleteSession(currentSessionIdRef.current);''',
)

test = "scripts/test-review-regressions.js"
replace_once(
    test,
    '''assert.match(chat, /agentMessages\\[agentMessages.length - 1\\] === event.message/, "Error/aborted UI and Agent histories must stay aligned");\n\nassert.match(storage,''',
    '''assert.match(chat, /agentMessages\\[agentMessages.length - 1\\] === event.message/, "Error/aborted UI and Agent histories must stay aligned");\nconst newSessionSection = section(chat, "const newSession", "const switchSession");\nassert.ok(\n  newSessionSection.indexOf("createSession(") < newSessionSection.indexOf("agentRef.current?.reset()"),\n  "New-session storage must succeed before clearing the active transcript",\n);\nconst deleteSessionSection = section(chat, "const deleteCurrentSession", "const prevStreamingRef");\nassert.equal(\n  deleteSessionSection.includes("agentRef.current?.reset()"),\n  false,\n  "Delete must not clear the active transcript before storage succeeds",\n);\n\nassert.match(storage,''',
)

print("Applied session operation ordering fixes")

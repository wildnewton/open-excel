from pathlib import Path

path = Path("src/taskpane/components/chat/chat-context.tsx")
text = path.read_text()

old_update = '''      case "message_update": {
        if (event.message.role === "assistant" && streamingMessageIdRef.current) {
          setState((prev) => {
            const messages = [...prev.messages];
            const idx = messages.findIndex((m) => m.id === streamingMessageIdRef.current);
            if (idx !== -1) {
              const parts = extractPartsFromAssistantMessage(event.message, messages[idx].parts);
              messages[idx] = { ...messages[idx], parts };
            }
            return { ...prev, messages };
          });
        }
        break;
      }
'''
new_update = '''      case "message_update": {
        const messageId = streamingMessageIdRef.current;
        if (event.message.role === "assistant" && messageId) {
          // Capture the id before scheduling the React state update. Fast streams can
          // batch multiple updates with message_end, which clears the mutable ref.
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
'''

if old_update not in text:
    raise SystemExit("Expected message_update block not found")
text = text.replace(old_update, new_update, 1)

old_end_start = '''      case "message_end": {
        if (event.message.role === "assistant") {
          const assistantMsg = event.message as AssistantMessage;
'''
new_end_start = '''      case "message_end": {
        if (event.message.role === "assistant") {
          const messageId = streamingMessageIdRef.current;
          const assistantMsg = event.message as AssistantMessage;
'''
if old_end_start not in text:
    raise SystemExit("Expected message_end start not found")
text = text.replace(old_end_start, new_end_start, 1)

old_end_find = '''            const idx = messages.findIndex((m) => m.id === streamingMessageIdRef.current);
'''
new_end_find = '''            // Use the id captured before the ref is cleared below. This also makes
            // the final complete message a reliable fallback if intermediate updates
            // were React-batched.
            const idx = messageId ? messages.findIndex((m) => m.id === messageId) : -1;
'''
if old_end_find not in text:
    raise SystemExit("Expected message_end id lookup not found")
text = text.replace(old_end_find, new_end_find, 1)

path.write_text(text)

Plan
- Inspect current native resume flow and server session handling against ACP session/load requirements.
- Add a read-only/session-resume safe path so inactive chats do not subscribe or error.
- Implement ACP session/load resume on the server using stored sessionId and capability checks.
- Wire mobile handleResume to the server resume flow and update UI/route state.

Todo list
- Review chat store, useChat subscription, and read-only navigation flow.
- Update store/hook to prevent subscriptions for read-only sessions.
- Implement server resume using session/load with loadSession capability validation.
- Implement mobile handleResume and ensure read-only -> active transition behaves correctly.
- Validate no duplicates in stored history on resume.

Report
- Added ACP session/load resume flow on the server with capability checks and no history overwrite.
- Prevented inactive sessions from subscribing by tracking read-only state in the native store.
- Implemented native resume handling and user message replay support for session/load.
- Added client-side guard to block resume when loadSession is unsupported.
- Avoided defaulting unknown support to false so older sessions can still attempt resume.

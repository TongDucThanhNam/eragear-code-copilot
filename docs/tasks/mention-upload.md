# Implement mention and upload in chat

## Goal
- [ ] Support `@` mention syntax and file uploads inside the chat UI so conversations can reference people and artifacts directly.

## 1) Mentions
- [ ] Determine format: e.g. `@agentName` with autocomplete dropdown.
- [ ] Update input box to detect `@` trigger and show suggestion list from available agents/users.
- [ ] Ensure mention metadata passes through backend (ACP session events, tRPC) and render highlights in chat bubble.

## 2) Uploads
- [ ] Add file-picker or drag/drop area near composer to select files.
- [ ] Handle upload lifecycle: selection, progress, ability to cancel, error state.
- [ ] Stream file reference through messages (link / inline preview) and store metadata (name, size).

## 3) Backend/Agent bridge
- [ ] Extend ACP protocol for mention + upload metadata (e.g. mention array, file refs).
- [ ] Ensure server persists attachments and references them when resuming sessions.
- [ ] Update agent tooling to download/inspect attachments if needed.

## 4) UI states
- [ ] Show mention chips with avatars/status in chat history.
- [ ] Display uploaded file summaries (icons, download buttons) in messages.
- [ ] Support multi-file uploads per message with preview and remove.

## 5) Testing
- [ ] E2E test mention dropdown + insertion flow.
- [ ] Test upload success/failure states and session persistence.
- [ ] Validate presence of mention data in logs/backchannel.

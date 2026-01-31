# Native tRPC Code Router Plan

Purpose: quick reference for wiring the server code router into the Expo app
later (skip UI for now).

Endpoints:
- code.getProjectContext
- code.getGitDiff
- code.getFileContent

Plan:
1) Entry points
   - Add a "Context" action in the chat header or action bar.
   - Add a "Project" detail drawer with tabs: Context, Diff, File.
2) Data flow
   - Use `trpc.getProjectContext` with `chatId` when opening Context.
   - Use `trpc.getGitDiff` with `chatId` when opening Diff.
   - Use `trpc.getFileContent` with `chatId` + `path` from a file picker list.
3) UI surface
   - Context view: show rules, open tabs, and file tree lists (read-only).
   - Diff view: plain-text diff with copy action (no editing).
   - File view: syntax-highlighted text with "Copy" + "Send to chat".
4) Composer integration
   - Offer "Send to chat" buttons that add resources via `sendMessage`.
   - Use `resources` for small text, `resourceLinks` for larger files.
5) Guardrails
   - Enforce size limits and truncate previews.
   - Show loading + error states (timeouts, auth, missing chatId).
6) Tests
   - Smoke test each query path on device.
   - Validate that missing permissions show a clear error toast.

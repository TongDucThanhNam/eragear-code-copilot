# Plan: New Chat Agent Selection Flow

**Created:** 2026-02-01  
**Status:** Ready for Atlas Execution

## Summary

The current “New Chat” menu action in the drawer header **does push** `/chats/new`, but there is no `app/chats/new.tsx`, so Expo Router resolves it to [chatId].tsx with `chatId="new"`. This does not create a session and leaves the chat screen in an invalid state.  
This plan adds a dedicated **New Chat** screen that lists agents, lets the user choose one, and then **creates + initializes** a session (using the existing `createSession` flow), finally routing to `/chats/{chatId}`. The session creation logic is extracted into a shared hook/service so it can be reused by the Sessions screen and the new screen.

## Context & Analysis

**Relevant Files:**
- _layout.tsx: Drawer header menu triggers `router.push("/chats/new")`. Needs to keep or adjust navigation.
- _layout.tsx: Stack config lists screens; needs to add `chats/new`.
- index.tsx: Sessions screen, agent picker modal, and current `handleSelectAgent` session creation logic.
- [chatId].tsx: Chat screen expects a valid chat ID and session state.
- use-chat.ts: Applies session state, manages connection status.
- chat-store.ts: Session state, connection state, `setActiveChatId` behavior.

**Key Functions/Classes:**
- `handleSelectAgent` in index.tsx: current session creation pipeline.
- `setActiveChatId` in chat-store.ts: sets `connStatus` to `"connecting"` and clears session state.
- `applySessionState` in use-chat.ts: applies modes/models/commands/prompt capabilities.

**Dependencies:**
- `expo-router`: navigation and stack routes.
- `trpc`: `agents.list`, `agents.setActive`, `createSession`, `getSessionState`.
- `heroui-native`: UI components, modals, buttons, etc.

**Patterns & Conventions:**
- Agent list UI uses `AgentIcon`, `ScrollView`, `Pressable`.
- `useAuthConfigured` gates all server interactions.
- Error handling uses local `error` state displayed in the screen UI.

---

## Implementation Phases

### Phase 1: Shared Session Creation Hook

**Objective:** Centralize “create session from agent” behavior so both Sessions and New Chat screens can use it.

**Files to Modify/Create:**
- **Create** `hooks/use-create-session.ts`: encapsulate session creation logic.
- **Modify** index.tsx: replace `handleSelectAgent` with hook usage.

**Tests to Write:**
- `__tests__/use-create-session.test.ts` (if test infra added)  
  Validate that:
  - `createSession` calls happen with correct payload.
  - `setActiveChatId`, `setModes`, `setModels`, and `setPromptCapabilities` are called.
  - `getSessionState` updates `supportsModelSwitching`.
- If no test infrastructure: add a manual QA checklist in documentation.

**Steps:**
1. Add `useCreateSession` hook with:
   - Inputs: `agent`, `projectId`, optional callbacks for error/success.
   - Uses `trpc.createSession` + `trpc.agents.setActive`.
   - Updates chat store: `setActiveChatId`, `setConnStatus`, `setModes`, `setModels`, `setPromptCapabilities`, `setSupportsModelSwitching`.
   - Fetches session state via `utils.getSessionState.fetch`.
2. Update `SessionsScreen` to use `useCreateSession` inside `handleSelectAgent`.
3. Ensure existing error handling still works.

**Acceptance Criteria:**
- [ ] Sessions screen still creates sessions exactly as before.
- [ ] No duplicated session creation logic in multiple screens.
- [ ] Error messaging remains intact.

---

### Phase 2: Agent Picker UI Component

**Objective:** Extract the agent list UI into a reusable component.

**Files to Modify/Create:**
- **Create** `components/agents/agent-picker.tsx` (or similar).
- **Modify** index.tsx to use this component inside its modal.

**Tests to Write:**
- `__tests__/agent-picker.test.tsx` (if infra exists): renders empty state, selected agent checkmark, disabled state.

**Steps:**
1. Move the agent list rendering into a component with props:
   - `agents`, `activeAgentId`, `onSelect`, `isLoading`, `emptyLabel`.
2. Keep existing styling and `AgentIcon` usage.

**Acceptance Criteria:**
- [ ] Sessions screen modal renders the same list as before.
- [ ] Component is reusable by the New Chat screen.

---

### Phase 3: Add `/chats/new` Screen

**Objective:** Implement the new chat flow that shows agent list and creates a session.

**Files to Modify/Create:**
- **Create** `app/chats/new.tsx`: New Chat screen.
- **Modify** _layout.tsx: add `Stack.Screen name="chats/new"` with `headerShown: false`.

**Tests to Write:**
- `__tests__/new-chat-screen.test.tsx` (if infra exists):
  - Shows agent list when configured.
  - Shows error if no active project.
  - Calls create session and navigates on agent selection.

**Steps:**
1. Build `NewChatScreen`:
   - Fetch agents via `trpc.agents.list`.
   - Use `useProjectStore` to access `activeProject`.
   - Show error if no active project (with CTA to return to sessions).
   - Render `AgentPicker` list.
2. On agent selection:
   - Call `useCreateSession` hook.
   - Navigate to `/chats/{chatId}` (use `router.replace`).
3. Add a “Cancel/Back” action to return to previous screen.

**Acceptance Criteria:**
- [ ] `/chats/new` shows the agent picker.
- [ ] Selecting an agent creates a session and routes to `/chats/{chatId}`.
- [ ] No active project triggers a visible error state.

---

### Phase 4: Navigation Cleanup & Guardrails

**Objective:** Ensure navigation paths and fallback handling are safe.

**Files to Modify/Create:**
- **Modify** _layout.tsx: keep `router.push("/chats/new")` and close the menu as now.
- **Optional Modify** [chatId].tsx: guard against `chatId === "new"` and redirect to `/chats/new`.

**Tests to Write:**
- Manual navigation QA checklist:
  - “New Chat” from any screen opens agent list.
  - Sessions screen still works.
  - Chat screen no longer loads with `chatId="new"`.

**Steps:**
1. Keep drawer menu action but ensure `/chats/new` is valid.
2. (Optional) Add redirect in `ChatScreen` to avoid loading invalid session if deep-linked to `/chats/new` incorrectly.

**Acceptance Criteria:**
- [ ] “New Chat” always shows agent selection.
- [ ] No accidental ChatScreen load with `chatId="new"`.

---

## Open Questions

1. **Route strategy:**  
   - **Option A:** Add `app/chats/new.tsx` (recommended) to match existing `router.push("/chats/new")`.  
   - **Option B:** Redirect “New Chat” to `/?create=1` and open modal on Sessions screen.  
   - **Recommendation:** Option A to preserve current navigation path and avoid side effects.

2. **Testing strategy:**  
   - **Option A:** Add Jest + React Native Testing Library to support unit tests.  
   - **Option B:** Keep manual QA only (current project has no test tooling).  
   - **Recommendation:** Start with manual QA in this change set; add tests only if required by project standards.

---

## Risks & Mitigation

- **Risk:** No active project selected → session creation fails.  
  **Mitigation:** Show clear error and CTA to select a project.

- **Risk:** Agent list empty.  
  **Mitigation:** Show empty state + link to Settings.

- **Risk:** Duplicate or drifting logic between Sessions and New Chat.  
  **Mitigation:** Centralize session creation in a shared hook/service.

---

## Success Criteria

- [ ] New Chat menu always opens agent picker and never routes to an invalid session.
- [ ] Selecting an agent creates a session and initializes chat state.
- [ ] Sessions screen remains unchanged in behavior.
- [ ] Manual QA checklist passes.
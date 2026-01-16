# Eragear-Code-Copilot: System Overview

This project is a web-based AI coding assistant built on the Agent Client Protocol (ACP). It provides a bridge between a browser-based UI and local AI agents capable of manipulating the filesystem and running terminal commands.

## Architecture and Tech Stack

The system follows a 3-tier architecture that clearly distinguishes roles according to the ACP definitions:

### 1. Client (User Interface)
- Role: The user-facing interface where users interact with the system.
- Implementations: Web App (`apps/web`), and potential future Desktop/Mobile apps.
- Tech Stack: React 18+ (Vite), Tailwind CSS, Shadcn UI.
- Responsibilities: Rendering UI, capturing user input, displaying agent stream.

### 2. Server (ACP Client)
- Role: Acts as the Client in the ACP context. It manages the connection to the Agent.
- Implementation: Hono Server (`apps/server`).
- Tech Stack: Bun / Node.js, `@agentclientprotocol/sdk`.
- Responsibilities:
  - Spawning and managing the Agent process (`child_process`).
  - Bridging communication between the UI (WebSocket) and the Agent (stdio ndjson).
  - Providing system capabilities (File System access, Terminal execution) to the Agent.

### 3. Agents (ACP Agents)
- Role: The intelligent backend process that performs tasks.
- Implementations: Claude Code, Codex, OpenCode, Gemini CLI, etc.
- Responsibilities: Receiving prompts, thinking, executing tool calls (provided by the Server), and generating responses.

---

## Internal Structure (Detailed)

### Backend (`apps/server`)
- Runtime: Bun / Node.js
- Framework: Hono
- Core Library: `@agentclientprotocol/sdk`
- Communication:
  - Frontend to Backend: tRPC over WebSocket for sessions, prompts, and streaming.
  - Backend to Agent: Standard Input/Output (ndjson) via `node:child_process`.
  - Backend to Frontend: tRPC subscriptions for real-time streaming and status updates.

### Server Source Layout

```
src/
├── index.ts
├── config/
│   ├── constants.ts
│   └── environment.ts
├── acp/
│   ├── client.ts
│   ├── types.ts
│   └── protocol/
│       ├── handler.ts
│       ├── update.ts
│       ├── permission.ts
│       └── tool-calls.ts
├── session/
│   ├── manager.ts
│   ├── storage.ts
│   ├── types.ts
│   └── events.ts
├── trpc/
│   ├── base.ts
│   ├── context.ts
│   ├── router.ts
│   └── procedures/
│       ├── session.ts
│       ├── code.ts
│       ├── ai.ts
│       └── tool.ts
├── services/
│   ├── code-processor.ts
│   └── ai-bridge.ts
├── websocket/
│   ├── adapter.ts
│   └── handler.ts
└── utils/
    ├── id.ts
    └── path.ts
```

### Frontend (`apps/web`)
- Framework: React 18+ (Vite)
- Styling: Tailwind CSS + Shadcn UI
- State Management: Zustand
- Authentication: Better-Auth

### Shared Workspace
- `packages/shared`: Shared types, event schemas, and protocol helpers.

---

## Documentation Index (Canonical References)

- `docs/acp/acp-overview.md`: ACP concepts, initialization, and protocol capabilities.
- `docs/acp/acp-prompt-turn.md`: Prompt turn structure and streamed updates.
- `docs/acp/acp-terminal.md`: Terminal tool-call behavior and output streaming.
- `docs/acp/acp-permission-response-fix.md`: Permission response format and mapping logic.
- `docs/trpc/trpc-websocket.md`: tRPC WS session lifecycle and streaming semantics.
- `plan_session_resume.md`: Session resume behavior, edge cases, and roadmap notes.

---

## ACP Flow (Project-Specific)

This section summarizes the ACP flow as implemented in this project. For protocol details, refer to the docs above.

### 1) Initialization
- The server spawns an agent process in `apps/server/src/session/manager.ts`.
- ACP connection setup is encapsulated in `apps/server/src/acp/client.ts`.
- Client metadata comes from `apps/server/src/config/constants.ts`.
- See: `docs/acp/acp-overview.md`.

### 2) Session Setup
- New sessions are created via `conn.newSession` in `apps/server/src/session/manager.ts`.
- Resuming sessions uses `conn.loadSession` when supported.
- Session persistence is handled by `apps/server/src/session/storage.ts`.
- See: `docs/trpc/trpc-websocket.md` and `plan_session_resume.md`.

### 3) Prompt Turn (User to Agent)
- tRPC entrypoint: `apps/server/src/trpc/procedures/ai.ts`.
- Prompt assembly: `apps/server/src/services/ai-bridge.ts` builds ACP content blocks.
- User messages are stored via `apps/server/src/session/storage.ts` and broadcast via `apps/server/src/session/events.ts`.
- See: `docs/acp/acp-prompt-turn.md`.

### 4) Streaming Updates (Agent to UI)
- Update parsing and buffering: `apps/server/src/acp/protocol/update.ts`.
- Session updates are broadcast via `apps/server/src/session/events.ts`.
- tRPC subscription lives in `apps/server/src/trpc/procedures/session.ts`.
- See: `docs/trpc/trpc-websocket.md`.

### 5) Message Flow and Reconnection
- Each session buffers events in memory (`apps/server/src/session/events.ts`).
- On reconnect, the tRPC subscription replays the buffer (`apps/server/src/trpc/procedures/session.ts`).
- This guarantees deterministic replay for both user and agent messages.

### 6) Tool Permissions
- Incoming ACP permission requests are handled by `apps/server/src/acp/protocol/permission.ts`.
- User decisions are mapped to option IDs in `apps/server/src/trpc/procedures/tool.ts`.
- See: `docs/acp/acp-permission-response-fix.md`.

### 7) File System and Terminal Tool Calls
- File read/write and terminal lifecycle are implemented in `apps/server/src/acp/protocol/tool-calls.ts`.
- File URI handling lives in `apps/server/src/utils/path.ts`.
- Terminal output streaming and truncation are enforced here.
- See: `docs/acp/acp-terminal.md`.

### 8) Cancellation
- Cancellation entrypoint: `apps/server/src/trpc/procedures/ai.ts` (`cancelPrompt`).
- Pending permissions are resolved as cancelled to comply with ACP.
- See: `docs/acp/acp-prompt-turn.md`.

### ACP Rules to Remember
- All file paths in ACP must be absolute (file URIs are allowed).
- Line numbers are 1-based.

---

## Session Lifecycle and Persistence

### Session Storage
- Storage file: `apps/server/.eragear/sessions.json`.
- Storage module: `apps/server/src/session/storage.ts`.
- Types: `apps/server/src/session/types.ts` (`StoredMessage`, `StoredSession`).

### In-Memory Session State
- The `chats` map and event buffer live in `apps/server/src/session/events.ts`.
- `ChatSession` shape is defined in `apps/server/src/session/types.ts`.

### Session States
- Active (`isActive: true`): ACP session is alive in memory and interactive.
- Inactive (`isActive: false`): ACP session ended; resume depends on agent capability.

### Idle Timeout
- Config is parsed in `apps/server/src/config/environment.ts`.
- Default value is defined in `apps/server/src/config/constants.ts`.
- Cleanup timer is managed in `apps/server/src/trpc/procedures/session.ts`.

Environment variable:
```
SESSION_IDLE_TIMEOUT_MS=600000
```

---

## tRPC API Map

### Session Procedures (`apps/server/src/trpc/procedures/session.ts`)
- `createSession`
- `resumeSession`
- `stopSession`
- `deleteSession`
- `getSessionState`
- `getSessions`
- `getSessionMessages`
- `onSessionEvents`

### Code Procedures (`apps/server/src/trpc/procedures/code.ts`)
- `getProjectContext`
- `getGitDiff`
- `getFileContent`

### AI Procedures (`apps/server/src/trpc/procedures/ai.ts`)
- `sendMessage`
- `setModel`
- `setMode`
- `cancelPrompt`

### Tool Procedures (`apps/server/src/trpc/procedures/tool.ts`)
- `respondToPermissionRequest`

Router composition lives in `apps/server/src/trpc/router.ts`.

---

## WebSocket Server

- Entry point: `apps/server/src/index.ts`.
- tRPC WebSocket adapter: `apps/server/src/websocket/adapter.ts`.
- WS lifecycle hooks: `apps/server/src/websocket/handler.ts`.
- Host and port resolved from `apps/server/src/config/environment.ts`.

Environment variables:
```
WS_HOST=0.0.0.0
WS_PORT=3003
```

---

## Key File Map (Expanded)

| Path | Description |
|---|---|
| `apps/server/src/index.ts` | Server entry and WebSocket bootstrapping. |
| `apps/server/src/config/constants.ts` | App constants (client info, defaults). |
| `apps/server/src/config/environment.ts` | ENV parsing and validation. |
| `apps/server/src/acp/client.ts` | ACP ClientSideConnection wrapper. |
| `apps/server/src/acp/protocol/handler.ts` | ACP client handler wiring. |
| `apps/server/src/acp/protocol/update.ts` | Session update parsing and buffering. |
| `apps/server/src/acp/protocol/permission.ts` | Permission request handling. |
| `apps/server/src/acp/protocol/tool-calls.ts` | File system and terminal tool calls. |
| `apps/server/src/session/manager.ts` | ACP session creation and lifecycle. |
| `apps/server/src/session/events.ts` | In-memory session map and event broadcast. |
| `apps/server/src/session/types.ts` | Session domain types. |
| `apps/server/src/session/storage.ts` | Persistent storage for sessions/messages. |
| `apps/server/src/services/ai-bridge.ts` | Prompt content construction. |
| `apps/server/src/services/code-processor.ts` | Project context and git diff scanning. |
| `apps/server/src/trpc/router.ts` | tRPC router composition. |
| `apps/server/src/trpc/procedures/session.ts` | Session endpoints. |
| `apps/server/src/trpc/procedures/ai.ts` | AI prompt endpoints. |
| `apps/server/src/trpc/procedures/code.ts` | Code context endpoints. |
| `apps/server/src/trpc/procedures/tool.ts` | Tool and permission endpoints. |
| `apps/server/src/websocket/adapter.ts` | tRPC WS adapter creation. |
| `apps/server/src/websocket/handler.ts` | WS upgrade and connection handling. |
| `apps/web/src/routes/index.tsx` | Web: main chat interface. |
| `apps/native/app/(drawer)/index.tsx` | Mobile: session list. |
| `apps/native/app/chats/[chatId].tsx` | Mobile: chat screen (read-only support). |
| `apps/native/store/chat-store.ts` | Mobile: Zustand store for chat state. |
| `TODO.md` | Feature roadmap and progress tracking. |

---

## Development Guide

### Setup
1. `bun install`
2. `bun run dev` (Starts backend on `:3000` and frontend on `:3001`)

### Server-Only Dev
- `cd apps/server && bun run dev`
- Uses WS host/port from `apps/server/src/config/environment.ts`.

### Authentication
Authentication is currently mocked in `apps/web/src/lib/auth-client.ts`. To restore real auth:
1. Revert the mock in `auth-client.ts`.
2. Configure environment variables for Better-Auth.

### Adding a New Agent
1. Open the Settings dialog in the Web UI.
2. Provide a Name, Command (e.g., `opencode`), Args (e.g., `acp`), and Environment variables.
3. These are saved to LocalStorage and passed to the server when starting a chat.

---

## AI Assistant Conventions

### Coding Standards
- Components: Use PascalCase for filenames. Follow Shadcn patterns for UI primitives.
- State: Keep business logic in Zustand stores; keep UI state in `useState`.
- API: Use absolute paths for server endpoints (`/api/...`).
- Imports: Use `@/` alias for `apps/web/src`.

### Backend Implementation
- Use Hono's `logger()` middleware in `apps/server/src/index.ts`.
- Prefer ACP handler wiring via `apps/server/src/acp/client.ts` and `apps/server/src/acp/protocol/*`.
- Keep session state in `apps/server/src/session/events.ts` and types in `apps/server/src/session/types.ts`.
- Always handle `proc.on('exit')` and `proc.on('error')` in `apps/server/src/session/manager.ts`.

### UI Consistency
- Use the `ChatHeader` component for session metadata.
- Connection status indicators:
  - connected: Active session, can interact
  - connecting: Establishing connection
  - error: Connection failed
  - idle: No active connection (includes read-only mode)
- Session list indicators:
  - Active: ACP session alive, click to interact
  - Inactive + [Read-only] badge: History only when resume is unsupported
  - Inactive + [Resume available] badge: Can resume session


# Ultracite Code Standards

This project uses **Ultracite**, a zero-config preset that enforces strict code quality standards through automated formatting and linting.

## Quick Reference

- **Format code**: `bun x ultracite fix`
- **Check for issues**: `bun x ultracite check`
- **Diagnose setup**: `bun x ultracite doctor`

Biome (the underlying engine) provides robust linting and formatting. Most issues are automatically fixable.

---

## Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

### Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

### React & JSX

- Use function components over class components
- Call hooks at the top level only, never conditionally
- Specify all dependencies in hook dependency arrays correctly
- Use the `key` prop for elements in iterables (prefer unique IDs over array indices)
- Nest children between opening and closing tags instead of passing as props
- Don't define components inside other components
- Use semantic HTML and ARIA attributes for accessibility:
  - Provide meaningful alt text for images
  - Use proper heading hierarchy
  - Add labels for form inputs
  - Include keyboard event handlers alongside mouse events
  - Use semantic elements (`<button>`, `<nav>`, etc.) instead of divs with roles

### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` statements from production code
- Throw `Error` objects with descriptive messages, not strings or other values
- Use `try-catch` blocks meaningfully - don't catch errors just to rethrow them
- Prefer early returns over nested conditionals for error cases

### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns

### Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary
- Don't use `eval()` or assign directly to `document.cookie`
- Validate and sanitize user input

### Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)
- Use proper image components (e.g., Next.js `<Image>`) over `<img>` tags

### Framework-Specific Guidance

**Next.js:**
- Use Next.js `<Image>` component for images
- Use `next/head` or App Router metadata API for head elements
- Use Server Components for async data fetching instead of async Client Components

**React 19+:**
- Use ref as a prop instead of `React.forwardRef`

**Solid/Svelte/Vue/Qwik:**
- Use `class` and `for` attributes (not `className` or `htmlFor`)

---

## Testing

- Write assertions inside `it()` or `test()` blocks
- Avoid done callbacks in async tests - use async/await instead
- Don't use `.only` or `.skip` in committed code
- Keep test suites reasonably flat - avoid excessive `describe` nesting

## When Biome Can't Help

Biome's linter will catch most issues automatically. Focus your attention on:

1. **Business logic correctness** - Biome can't validate your algorithms
2. **Meaningful naming** - Use descriptive names for functions, variables, and types
3. **Architecture decisions** - Component structure, data flow, and API design
4. **Edge cases** - Handle boundary conditions and error states
5. **User experience** - Accessibility, performance, and usability considerations
6. **Documentation** - Add comments for complex logic, but prefer self-documenting code

---

Most formatting and common issues are automatically fixed by Biome. Run `bun x ultracite fix` before committing to ensure compliance.

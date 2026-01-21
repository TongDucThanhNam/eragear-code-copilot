# Web App Documentation (`apps/web`)

Web-based chat interface for Eragear Code Copilot, also serves as the base for Tauri desktop app.

## Tech Stack
- **Framework**: React 18+ (Vite)
- **Styling**: Tailwind CSS + Shadcn UI
- **Routing**: TanStack Router
- **State Management**: Zustand
- **Authentication**: Better-Auth (currently mocked)
- **Desktop**: Tauri 2.0

---

## Source Layout

```
src/
├── main.tsx                    # App entry point
├── index.css                   # Global styles
├── routeTree.gen.ts            # Generated route tree
├── components/
│   ├── chat-ui/                # Chat interface components
│   │   ├── chat-interface.tsx  # Main chat component
│   │   ├── chat-header.tsx     # Session metadata header
│   │   ├── message-list.tsx    # Message rendering
│   │   └── input-area.tsx      # Message input
│   ├── sidebar/                # Navigation sidebar
│   ├── settings/               # Settings dialogs
│   └── ui/                     # Shadcn UI primitives
├── routes/
│   ├── index.tsx               # Main chat page
│   └── __root.tsx              # Root layout
├── store/
│   └── chat-store.ts           # Zustand chat state
├── hooks/
│   ├── use-chat.ts             # Chat hook
│   └── use-trpc.ts             # tRPC client hook
└── lib/
    ├── auth-client.ts          # Authentication client (mocked)
    ├── trpc.ts                 # tRPC client setup
    └── utils.ts                # Utility functions
```

---

## Key Files

| File | Description |
|------|-------------|
| `src/routes/index.tsx` | Main chat interface |
| `src/lib/auth-client.ts` | Authentication client (currently mocked) |
| `src/components/chat-ui/chat-interface.tsx` | Core chat component |
| `src/store/chat-store.ts` | Chat state management |

---

## UI Components

### Chat Interface
Main chat component with session management:
- Message list with streaming support
- Input area with file attachment
- Session status indicators
- Tool permission dialogs

### Connection Status Indicators
| Status | Description |
|--------|-------------|
| `connected` | Active session, can interact |
| `connecting` | Establishing connection |
| `error` | Connection failed |
| `idle` | No active connection (includes read-only mode) |

### Session List Indicators
| State | Display |
|-------|---------|
| Active | ACP session alive, click to interact |
| Inactive + Resume unavailable | `[Read-only]` badge, history only |
| Inactive + Resume available | `[Resume available]` badge |

---

## State Management

### Zustand Store (`store/chat-store.ts`)
- Session state
- Message history
- Connection status
- UI state (loading, errors)

### Guidelines
- Keep business logic in Zustand stores
- Keep UI state in `useState`

---

## Authentication

Currently mocked in `src/lib/auth-client.ts`.

### To Restore Real Auth
1. Revert the mock in `auth-client.ts`
2. Configure environment variables for Better-Auth

---

## Development

### Run Web App
```bash
cd apps/web
bun run dev
```

Or from root:
```bash
bun run dev:web
```

### Build
```bash
bun run build -F web
```

### Type Check
```bash
bun run check-types
```

### Lint
```bash
bun run lint -F web
```

---

## Desktop App (Tauri)

The web app is also packaged as a Tauri desktop app.

### Development
```bash
cd apps/web
bun run desktop:dev
```

### Build
```bash
bun run desktop:build
```

### Tauri Files
```
src-tauri/
├── Cargo.toml                  # Rust dependencies
├── tauri.conf.json             # Tauri configuration
├── build.rs                    # Build script
└── src/
    └── main.rs                 # Tauri entry point
```

---

## Coding Standards

### Component Naming
- Use PascalCase for filenames
- Follow Shadcn patterns for UI primitives

### Imports
- Use `@/` alias for `apps/web/src`
- Example: `import { Button } from "@/components/ui/button"`

### API Calls
- Use absolute paths for server endpoints (`/api/...`)
- Use tRPC client for type-safe calls

---

## Adding a New Agent

1. Open the Settings dialog in the Web UI
2. Provide:
   - **Name**: Display name for the agent
   - **Command**: Executable command (e.g., `opencode`)
   - **Args**: Command arguments (e.g., `acp`)
   - **Environment**: Environment variables
3. Settings are saved to LocalStorage
4. Passed to server when starting a chat

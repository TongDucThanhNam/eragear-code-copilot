# Session Module

Manages AI agent chat sessions - creation, state, messaging, and lifecycle.

## Responsibility

- **Create** sessions (spawn agent process + ACP connection)
- **Resume** sessions (load persisted state)
- **Stop/Delete** sessions
- **Send** messages to agent
- **Manage** modes, models, permissions
- **Broadcast** events to subscribers

## Architecture

### Domain (`domain/`)

- `Session` - Core entity with modes, models, metadata

### Application (`application/`)

- `CreateSessionService` - Orchestrate session initialization
- (Future) ResumeSessionService, SendMessageService, etc.

### Infra (`infra/`)

- `SessionRuntimeStore` - In-memory active session tracking

### Transport (`transport/`)

- tRPC procedures for session operations

## Key Interfaces (Ports)

- `SessionRepositoryPort` - Persist session metadata & messages
- `SessionRuntimePort` - Track active session state
- `AgentRuntimePort` - Spawn & communicate with agent process
- `SessionAcpPort` - Create ACP handlers/buffers
- `EventBusPort` - Publish session events

## Data Flow: Create Session

```
tRPC procedure
  → CreateSessionService
    → Spawn process (AgentRuntime)
    → Create ChatSession (domain entity)
    → Store runtime (SessionRuntime)
    → Initialize ACP connection
    → Load/create session on agent
    → Save to storage (SessionRepository)
    → Return to client
```

## Future Enhancements

- Session persistence (save/load chat history)
- Permission request handling via event bus
- Mode/model switching
- Terminal management

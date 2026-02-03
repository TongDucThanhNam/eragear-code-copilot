# Server Architecture - AI-Optimized Structure

## Overview

This server is built using **Clean Architecture + Ports & Adapters** with **vertical slice modules** to maximize AI understanding and maintainability.

```
Bootstrap (wiring)
    ↓
Transport (HTTP/tRPC/WS)
    ↓
Application (use-cases/services)
    ↓
Domain (business logic)
    ↓
Infra (adapters/IO)
```

## Technology Stack

- **Framework**: Hono (lightweight, edge-ready)
- **API**: tRPC + WebSocket
- **Storage**: JSON files (`.eragear/`)
- **Agent Communication**: ACP (NDJSON over stdio)

## Hono Middleware Stack

Request flows through these layers (in order):

```
1. Request Logger     → Structured logging with tags
2. Request ID         → Unique ID per request (X-Request-ID)
3. Response Timing    → Performance tracking (X-Response-Time)
4. Compression        → gzip/brotli (60-70% size reduction)
5. CORS               → Factory-based presets (api/auth/health/static)
6. Auth Protection    → Session-based authentication
7. Error Handler      → Centralized error responses
8. Cache Headers      → 1-year cache for static assets
```

## Dependency Flow

- **Transport** depends on Application & Shared
- **Application** depends on Domain, Infra Ports, & Shared
- **Domain** depends only on Shared types
- **Infra** implements Ports, depends on Domain
- **Shared** has no dependencies (base types & utils)

## Module Structure

Each module (session, agent, project, ai, etc.) follows:

```
modules/[module]/
  ├── domain/          # Business entities & rules
  ├── application/     # Use-cases / services
  ├── infra/           # Adapters specific to module
  ├── transport/       # tRPC/HTTP endpoints
  └── README.md
```

## Key Directories

```
src/
├── bootstrap/         # App entry, DI container
├── transport/
│   ├── http/
│   │   ├── routes/    # Modular HTTP routes
│   │   ├── ui/        # Dashboard UI
│   │   └── utils/     # HTTP utilities
│   │   └── *.ts       # Middleware (CORS, errors, request-id)
│   ├── trpc/          # tRPC router & procedures
│   └── ws/            # WebSocket handlers
├── infra/
│   ├── acp/           # Agent communication protocol
│   ├── caching/       # Response caching layer
│   ├── logging/       # Structured logging
│   ├── process/       # Agent process spawning
│   ├── filesystem/    # File operations
│   ├── git/           # Git operations
│   ├── storage/       # JSON persistence
│   └── auth/          # Authentication
├── modules/           # Feature modules
└── shared/            # Cross-cutting types & utils
```

## Ports (Contracts)

Ports live with their owning modules under `modules/*/application/ports/`.
Cross-cutting ports live under `shared/ports/`.

Examples:

- `modules/session/application/ports/`:
  - `SessionRepositoryPort` - session persistence
  - `SessionRuntimePort` - in-memory session state
  - `AgentRuntimePort` - process spawning
  - `SessionAcpPort` - ACP handler/buffer creation
- `modules/project/application/ports/`: `ProjectRepositoryPort`
- `modules/agent/application/ports/`: `AgentRepositoryPort`
- `modules/settings/application/ports/`: `SettingsRepositoryPort`
- `modules/tooling/application/ports/`: `GitPort`
- `shared/ports/`: `EventBusPort`

## Data Flow Example: Send Message

1. **Transport** (tRPC) receives `sendMessage` request
2. Calls **Application** `SendMessageService.execute()`
3. Service uses **Domain** entities & validation
4. Service calls **Infra** adapters via ports:
   - `sessionRuntime.get(chatId)` → runtime store
   - `sessionRepo.appendMessage()` → storage
   - `sessionRuntime.broadcast()` → event distribution
5. Response goes back through transport layer

## Adding New Features

1. Create module folder: `modules/my-feature/`
2. Define domain entity in `domain/`
3. Create use-case service in `application/`
4. Implement port adapters if needed
5. Add tRPC procedure in `transport/` or `transport/trpc/`
6. Wire adapters in `bootstrap/container.ts`

## Key Design Principles

- **Single Responsibility**: Each layer has one reason to change
- **Dependency Inversion**: High-level depends on abstractions, not low-level details
- **Testability**: Domain logic is independent, easy to test
- **Flexibility**: Swap implementations (e.g., storage backends) without changing business logic
- **AI-Friendly**: Clear entry points, minimal cross-module coupling

See individual module READMEs for details.
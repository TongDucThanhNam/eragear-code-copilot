# Eragear Code Copilot - Server Architecture Refactoring

## Completion Status

✅ **Phase 1: Structure & Ports** - COMPLETE
- Created modular folder structure (bootstrap, transport, modules, infra, shared)
- Defined 10+ port interfaces for adapters
- Extracted domain entities (Session, Agent, Project, Settings)
- Organized types in shared/types/

✅ **Phase 2: Adapters** - COMPLETE
- Storage adapters: Session, Project, Agent, Settings (JSON-based)
- FileSystem adapter for safe path resolution & file I/O
- Git adapter for project context & diff operations
- ACP adapter for protocol handling & session buffering
- Process runtime adapter for spawning agents
- Event bus for pub/sub messaging
- Session runtime store for in-memory session tracking

✅ **Phase 3: Application Layer** - PARTIAL
- Created CreateSessionService (orchestration)
- Framework for other use-case services

✅ **Phase 4: Bootstrap & Documentation** - IN PROGRESS
- DI Container for wiring dependencies
- Bootstrap server setup
- Transport layer HTTP routes & tRPC context

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT (UI/Mobile)                        │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│              TRANSPORT LAYER (HTTP + tRPC + WS)             │
│                   [routes.ts, base.ts]                       │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│           APPLICATION LAYER (Use-cases/Services)            │
│  CreateSession | SendMessage | SetModel | RespondPermission │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│            DOMAIN LAYER (Business Entities)                  │
│      Session | Agent | Project | Settings | Events          │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│ INFRA LAYER (Adapters implementing Ports)                   │
│ Storage | FileSystem | Git | ACP | Process | EventBus       │
└─────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### 1. Clean Architecture + Ports & Adapters
- **Why**: Decouples business logic from implementation details
- **Benefit**: Can swap storage backend, testing, AI client easily
- **Impact**: Higher initial setup, but massive gain in maintainability

### 2. Vertical Slice Modules
- **Why**: Each feature (session, agent, project) is self-contained
- **Benefit**: AI agents understand one module at a time
- **Impact**: Clear ownership boundaries

### 3. DI Container Pattern
- **Why**: Single place to wire all dependencies
- **Benefit**: Easy to change implementations, test with mocks
- **Impact**: Container initialization at startup

### 4. Event Bus for Loose Coupling
- **Why**: Session runtime, storage, and subscribers don't need direct references
- **Benefit**: Broadcast to many listeners (tRPC, dashboard, future features)
- **Impact**: Need to monitor event queue for debugging

## Migration Path from Old Structure

### ✅ Already Moved
- Types → `shared/types/`
- Storage implementations → `infra/storage/`
- ACP protocol handlers → `infra/acp/`
- Utils → `shared/utils/`

### 🔄 In Progress
- HTTP routes → `transport/http/`
- tRPC procedures → `transport/trpc/`
- Session logic → `modules/session/`

### ⏳ TODO (Phase 2)
- Rebuild all tRPC procedures using application services
- Migrate dashboard logic to DashboardService
- Implement remaining use-case services
- Add proper error handling & logging
- Integration tests for application layer

## File Mapping: Old → New

| Old                              | New                                        |
| -------------------------------- | ------------------------------------------ |
| `src/index.ts`                   | `bootstrap/server.ts`                      |
| `src/config/*`                   | `modules/settings/domain` + `infra/storage`|
| `src/projects/storage.ts`        | `infra/storage/project.adapter.ts`         |
| `src/agents/storage.ts`          | `infra/storage/settings.adapter.ts`        |
| `src/session/storage.ts`         | `infra/storage/session.adapter.ts`         |
| `src/session/manager.ts`         | `modules/session/application/`             |
| `src/session/events.ts`          | `modules/session/infra/runtime-store.ts`   |
| `src/acp/protocol/*`             | `infra/acp/`                               |
| `src/services/code-processor.ts` | `infra/git/index.ts`                       |
| `src/utils/*`                    | `shared/utils/`                            |
| `src/trpc/*`                     | `transport/trpc/`                          |

## Next Steps for Implementation

### Priority 1: Complete Application Layer
```typescript
// Implement these services in modules/*/application/
- CreateSessionService ✅ (partially)
- ResumeSessionService
- StopSessionService  
- DeleteSessionService
- SendMessageService
- SetModeService
- SetModelService
- RespondPermissionService
```

### Priority 2: Rebuild tRPC Procedures
```typescript
// In transport/trpc/procedures/, use new services
- sessionRouter
- codeRouter
- projectRouter
- aiRouter
- toolRouter
- agentsRouter
```

### Priority 3: Integrate with Old Code
- Keep old `src/index.ts` working for now
- Gradually switch routes to `transport/http/routes.ts`
- New `bootstrap/server.ts` as alternative entry point

### Priority 4: Testing & Verification
- Build & verify no compilation errors
- Smoke test tRPC endpoints
- Dashboard still works
- Session creation works end-to-end

## Benefits for AI Agents

1. **Clear Responsibility**: Each file has one job, easy to understand
2. **Dependency Graph**: Follow flow from transport → application → domain → infra
3. **Type Safety**: Ports define contracts, catches issues early
4. **Testability**: Mock ports for testing services in isolation
5. **Discoverability**: README files guide through each module
6. **Loose Coupling**: Change storage without touching business logic

## Configuration

The system initializes via `getContainer()` which creates:

```typescript
const container = new Container(allowedRoots);
// Exposes:
- container.getSessions() → SessionRepositoryPort
- container.getProjects() → ProjectRepositoryPort
- container.getAgents() → AgentRepositoryPort
- container.getSettings() → SettingsRepositoryPort
- container.getSessionRuntime() → SessionRuntimePort
```

## Next: Rebuild tRPC & Complete Services

Once application services are ready, tRPC procedures become simple adapters:

```typescript
// Example: sessionRouter.createSession
export const createSession = publicProcedure
  .input(createSessionInput)
  .mutation(async ({ input, ctx }) => {
    const service = new CreateSessionService(
      ctx.container.getSessions(),
      ctx.container.getSessionRuntime(),
      ctx.container.agentRuntimeAdapter,
    );
    return await service.execute(input);
  });
```

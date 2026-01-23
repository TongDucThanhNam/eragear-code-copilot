# Developer Guide - New Architecture

## Quick Start

### 1. Understand the Flow

When adding a new feature (e.g., "delete session"):

```
User clicks Delete → tRPC Procedure calls Service → 
  Service uses Domain rules & Repositories →
    Repositories write to Storage Adapter →
      Response flows back through layers
```

### 2. Adding a New Application Service

Create `modules/[feature]/application/[action].service.ts`:

```typescript
import type { [RepositoryPort] } from '../../../shared/types/ports';

export class [ActionService] {
  constructor(
    private repo: [RepositoryPort],
    // other dependencies
  ) {}

  async execute(input: InputType): Promise<OutputType> {
    // Use domain logic
    // Call repository via port
    // Return result
  }
}
```

### 3. Adding a tRPC Procedure

In `transport/trpc/procedures/[module].ts`:

```typescript
import { publicProcedure, router } from '../base';
import { getContainer } from '../../../bootstrap/container';

export const [module]Router = router({
  [action]: publicProcedure
    .input(z.object({ /* schema */ }))
    .mutation(async ({ input }) => {
      const container = getContainer();
      const service = new [ActionService](
        container.getSessions(),
        // other dependencies from container
      );
      return await service.execute(input);
    }),
});
```

### 4. Testing a Service

```typescript
import { describe, it, expect } from 'vitest';
import type { [RepositoryPort] } from '../../../shared/types/ports';

class MockRepository implements [RepositoryPort] {
  // Implement port methods for testing
}

describe('[ActionService]', () => {
  it('should do X when given Y', async () => {
    const repo = new MockRepository();
    const service = new [ActionService](repo);
    const result = await service.execute({ /* input */ });
    expect(result).toEqual({ /* expected */ });
  });
});
```

## Common Tasks

### Reading Session from Storage

```typescript
const sessionRepo = container.getSessions();
const session = sessionRepo.findById(chatId);
```

### Broadcasting Event

```typescript
const runtime = container.getSessionRuntime();
runtime.broadcast(chatId, { type: 'connected' });
```

### Getting File Content

```typescript
const fs = container.fileSystemAdapter;
const content = await fs.readTextFile(chatId, filePath);
```

### Running Git Command

```typescript
const git = container.gitAdapter;
const diff = await git.getDiff(projectRoot);
```

## File Organization Checklist

When adding a feature:

- [ ] Create domain entity in `modules/[feature]/domain/`
- [ ] Create application service in `modules/[feature]/application/`
- [ ] If new storage needed, create adapter in `modules/[feature]/infra/`
- [ ] Add tRPC procedure in `modules/[feature]/transport/` or `transport/trpc/procedures/`
- [ ] Update container in `bootstrap/container.ts` if adding new adapter
- [ ] Create module README explaining purpose + data flow
- [ ] Add types to `shared/types/` if needed

## Debugging

### See All Sessions

```typescript
const container = getContainer();
const allSessions = container.getSessions().findAll();
console.log(allSessions);
```

### Check Active Runtime Sessions

```typescript
const runtime = container.getSessionRuntime();
console.log(runtime.getAll());
```

### Trace Event Flow

Events flow through:
1. Session broadcasts via `runtime.broadcast()`
2. EventBus publishes
3. Listeners receive via subscription
4. tRPC emitter notifies subscribers
5. UI receives update

## Performance Tips

1. **Repository calls** - Read from storage is synchronous (JSON), keep queries focused
2. **Event broadcasting** - Can create spam, batch if possible
3. **File I/O** - Async and can be slow, cache results when safe
4. **Git operations** - Network-like speed, consider caching diff results

## Common Pitfalls

❌ **Don't**: Access storage directly from tRPC (breaks layering)
```typescript
// WRONG
const data = readFileSync('sessions.json');
```

✅ **Do**: Use container & repository port
```typescript
// RIGHT
const sessions = container.getSessions().findAll();
```

❌ **Don't**: Mix domain logic with infrastructure
```typescript
// WRONG - domain entity shouldn't know about file paths
class Session {
  async save() { /* write to disk */ }
}
```

✅ **Do**: Keep domain pure, let adapter handle IO
```typescript
// RIGHT
const session = new Session(data);
container.getSessions().save(session);
```

❌ **Don't**: Create tight coupling between modules
```typescript
// WRONG - modules shouldn't import each other
import { ProjectService } from '../project/...';
```

✅ **Do**: Use shared types & events for cross-module communication
```typescript
// RIGHT - modules talk via types & events
eventBus.publish({ type: 'project:deleted', id });
```

## References

- Main architecture: see `src/README.md`
- Full design doc: see `ARCHITECTURE_REFACTOR.md`
- Module structure: see `modules/[module]/README.md`
- Types & ports: see `shared/types/ports.ts`

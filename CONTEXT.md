# CONTEXT.md — Architectural Concepts

Read this first when reviewing architecture. `AGENTS.md` and
`apps/server/src/ARCHITECTURE.md` describe the layers; this file describes
the **named concepts** that sit on top of those layers and the
load-bearing decisions that produced them.

Glossary for module/interface/seam/depth/etc.: see
`~/.agents/skills/improve-codebase-architecture/LANGUAGE.md`.

---

## SessionUpdatePipeline (deepened — c1)

The deep module that absorbs every ACP `sessionUpdate` notification.

**Interface** (strategy registry, two methods):
- `register(kind, handler)` — bind a handler to a `sessionUpdate` kind.
- `handle(update, context)` — public entry; dispatches to the registered handler.

**External seams (real ports):**
- `meta` port — mode / commands / configOptions / sessionInfo updates.
  Two adapters exist today (live + replay with `suppressReplayBroadcast`),
  so it earns a port.
- `SessionBuffer` port — chunked text / reasoning aggregation. Two adapters
  (live stream + replay).

**Internal (not ports):**
- `stream` / `plan` / `tool` sub-pipelines — private helpers, no external
  adapter. One adapter = hypothetical seam.
- Broadcast helper — only the pipeline calls it; not a port.

**Test surface:** tests for critical invariants (turn-id policy, replay,
throttling) survive. Routine dispatch tests fold into the module tests.

**Anti-patterns:**
- Don't reach across the registry to call sub-pipelines directly.
- Don't promote a sub-pipeline to a port until two adapters exist.
- Don't re-export the per-update-kind handlers as top-level services.

---

## SessionQueries (deepened — c4)

The deep module that absorbs the read-side of session state.
Lives in `modules/session/application/queries/` and replaces the
nine sibling read services that lived next to write services.

**Public surface (six entry points):**
- `state(chatId)` — full session state
- `list(userId, page)` — paginated session list
- `messages(chatId, cursor)` — paginated message history
- `storageStats()` — SQLite storage stats
- `compact(chatId, before)` — message compaction
- `discoverAgentSessions(agentId, cursor)` — agent-side session discovery

**External seam:**
- `SessionReader` port — exactly two adapters (sqlite / sqlite-worker),
  which is what justifies the seam.

**Out of scope (separate services):**
- `loadAgentSession` — touches the agent process, not SQLite reads.
- `reconcileSessionStatus` — runs recovery logic, not a pure query.

---

## Use-cases-built-once (pattern — c2)

The pattern that replaces the `service-factories.ts` indirection layer.

**Shape:** the composition root builds a single `useCases` object per feature
(e.g. `SessionUseCases`, `AiUseCases`) once, at startup. The tRPC context
holds a direct reference. Routers call `ctx.useCases.session.create.execute(input)`.

**What it replaces:**
- `SessionServiceFactory` (16 methods)
- `AiServiceFactory`, `ProjectServiceFactory`, `AgentServiceFactory`,
  `SettingsServiceFactory`, `ToolingServiceFactory`, `AuthServiceFactory`,
  `OpsServiceFactory` (47+ factory methods in total)
- `modules/service-factories.ts` (134 LOC of `new Service(deps)` pass-throughs)

**Why:** the factory interface was its own implementation. The deletion
test is decisive: deleting the factory and routing directly through the
composition root costs nothing, because the factory adds no behaviour.

**Anti-patterns:**
- Don't reintroduce a factory method for a service with one instantiation.
- Don't put per-request state on the use-cases object — build once, share.

---

## Module-owned event subscriptions (pattern — c3)

The pattern for cross-module event-bus handlers.

**Shape:** the event **source** module owns its subscriber. The handler
lives in `modules/<source>/init/<source>-events.init.ts`, which subscribes
to the event bus and calls the appropriate use case in the destination
module. `bootstrap/composition.ts` no longer registers cross-module
subscribers.

**Example:** `project_deleting` → `modules/project/init/project-events.init.ts`
subscribes and calls `ctx.useCases.session.cleanupProjectSessions.execute()`.

**Why:** locality. The reason for the handler lives in the source module,
not the composition root. The composition root's job is wiring, not
business reaction.

**Anti-patterns:**
- Don't register cross-module subscribers in `composition.ts`.
- Don't have two modules both subscribe to the same event.
- Don't leak event payloads across modules — translate to a use-case input
  at the seam.

---

## Composition root (decomposed — c3)

`bootstrap/composition.ts` keeps its single job: orchestrate owner creation
and dispose. Three focused owners absorb the rest:

- `AuthOwner` — auth runtime, auth module init, auth DB lifecycle.
- `PersistenceOwner` — sqlite worker, settings repo, sqlite storage lifecycle.
- `ServiceOwner` — service module init, project-config sync subscription,
  `LifecycleOwner` (dispose chain + event-bus subscriptions).

**Anti-patterns:**
- Don't add `setX`, `getX`, or subscription callbacks to the composition
  root. They belong in an owner or a module.
- Don't inline config-syncing or runtime-level setup here. It belongs in
  the persistence owner.

---

## Glossary additions

- **Use case** — a class with one `execute(input)` method. Preferred over
  "service" for application-layer classes.
- **Port** — a TypeScript interface satisfied by one or more adapters.
  Preferred over "interface" when the seam is the topic.
- **Strategy registry** — public interface shape: `register(kind, handler)`
  + `handle(item, context)`. Use when the kinds vary at runtime or in tests.
- **Owner** — a composition-time object that owns a coherent set of
  resources (init, subscriptions, dispose). One owner per axis of change.

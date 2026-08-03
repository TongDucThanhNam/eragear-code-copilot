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
Legacy pass-through wrappers around `SessionQueries` have been removed; query
tests live with the canonical read module.

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

**Anti-patterns:**
- Don't add `GetSession*Service`, `ListSessionsService`, or
  `CompactSessionMessagesService` wrappers around `SessionQueries`.

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

## LocalAde feature adapters (deepened — c7)

Local ADE still owns the broad local control-center snapshot and workflows,
but feature-specific translations now live in the feature modules that consume
them.

**Interface shape:**
- Each feature module exposes its own port (`HooksPort`, `PluginsPort`,
  `MemoryPort`, `SkillsPort`, `SlashCommandDiscoveryPort`,
  `RepoSnapshotIndexPort`).
- Each module owns a concrete `LocalAde*Adapter` under
  `modules/<feature>/infra/`.
- Each adapter accepts a narrow `LocalAde*Source` interface containing only
  the Local ADE methods that feature needs.

**Why:** locality. Bootstrap should wire adapters, not know how a Local ADE
snapshot becomes hooks, plugins, skills, memory, slash commands, or repo
snapshot indexing data. Moving the adapters into module infra puts translation
rules next to the feature ports and tests.

**Anti-patterns:**
- Don't define `LocalAde*Adapter` classes in `bootstrap/service-registry`.
- Don't type a feature adapter against `UseCasePort<LocalAdeService>` when it
  only needs a small Local ADE source interface.
- Don't export these adapters from `modules/<feature>/index.ts`; composition
  should import them through `modules/<feature>/di.ts`.

---

## Module-owned event subscriptions (pattern — c3)

The pattern for cross-module event-bus handlers.

**Shape:** the event **source** module owns its subscriber. The handler
lives in `modules/<source>/init/<source>-events.init.ts`, which subscribes
to the event bus and calls the appropriate use case in the destination
module. `bootstrap/composition.ts` no longer registers cross-module
subscribers.

Event init files use `subscribeDomainEvents` from
`shared/utils/domain-event-subscription.util.ts` for the listener contract:
abort checks, event-type filtering, optional domain-specific filters,
deferred microtask dispatch, and error routing. The feature module still owns
the reaction; the helper owns the mechanics of listening safely.

**Example:** `project_deleting` → `modules/project/init/project-events.init.ts`
subscribes and calls `ctx.useCases.session.cleanupProjectSessions.execute()`.

**Why:** locality. The reason for the handler lives in the source module,
not the composition root. The composition root's job is wiring, not
business reaction.

**Anti-patterns:**
- Don't register cross-module subscribers in `composition.ts`.
- Don't introduce broad event envelopes that force each module to inspect an
  internal discriminator before doing real work.
- Don't leak event payloads across modules — translate to a use-case input
  at the seam.
- Don't hand-roll `eventBus.subscribe` filters in module event init files when
  `subscribeDomainEvents` can express the listener contract.

---

## Prompt/session lifecycle events (deepened - c10)

Prompt and agent-session lifecycle facts are first-class domain events.

`shared/types/domain-events.types.ts` is the only server-side domain event
union. Do not add parallel event unions or legacy event-name constants in
generic shared type files.

**Event types:**
- `agent_session_created` - a live ACP-backed chat session has been created.
- `prompt_message_sent` - a prompt was submitted to an agent.
- `prompt_turn_completed` - an agent turn completed with a stop reason and
  source (`client`, `supervisor`, or `automation`).
- `agent_session_stopped` - a chat session was stopped.

**Why:** locality. Consumers subscribe to the lifecycle fact they actually
need instead of subscribing to one `type` and re-filtering an internal
`event` string. Adding a new lifecycle fact now changes the domain event union
and the relevant init seams, not every lifecycle subscriber.

**Anti-patterns:**
- Don't add another `type + event` double-discriminator to `DomainEvent`.
- Don't recreate a broad `local_ade_lifecycle` envelope for prompt/session
  lifecycle facts.
- Don't create a second `DomainEvent` type outside
  `shared/types/domain-events.types.ts`.
- Don't pass these raw events into application use-cases; module init files
  translate them to use-case-owned inputs.

---

## Event ingress to application use-cases (pattern - c9)

Module event init files translate event-bus payloads into module-owned
use-case inputs before calling application methods.

**Examples:**
- `modules/ai/init/prompt-turn-lifecycle.init.ts` translates AI-owned prompt
  lifecycle facts into typed event-bus payloads: `prompt_message_sent`,
  `subagent_invocation_requested`, and `prompt_turn_completed`.
- `modules/bots/init/bot-automation-events.init.ts` translates quota and
  lifecycle events into bot run/quota inputs: `recordQuotaSnapshot`,
  `completeRunsForTurn`, and `stopRunsForSession`.
- `modules/session/init/subagent-events.init.ts` translates subagent request
  and lifecycle events into subagent invocation inputs: `startInvocation` and
  `completeInvocationsForTurn`.
- `modules/supervisor/init/supervisor-events.init.ts` translates non-automation
  completed-turn lifecycle events into supervisor review scheduling.
- `modules/usage-stats/init/usage-stats-events.init.ts` translates telemetry
  events into usage recording inputs.

**Why:** locality. Event bus filtering and payload shape live at the init seam;
application use-cases express the module behavior they own and do not import
shared `DomainEvent` unions.

**Anti-patterns:**
- Don't name application methods `*FromEvent` unless the module really owns
  that event type.
- Don't pass raw lifecycle or quota events into bot, session, or usage-stats
  application methods.
- Don't schedule supervisor reviews from AI service-registry wiring; supervisor
  init owns that lifecycle reaction.

---

## Settings lifecycle events (deepened — c8)

The settings module owns the Local ADE lifecycle hook subscriber.

**Interface shape:**
- `modules/settings/init/settings-events.init.ts` subscribes to typed
  prompt/session lifecycle events and translates them to Local ADE hook names.
- `LocalAdeService.runLifecycleHooks(input)` accepts a settings-owned input
  shape: event name, user id, project root, and optional session/turn context.

**Why:** locality. Event-bus context (`signal`, event filtering, domain-event
union shape) belongs at the module init seam. Local ADE should execute lifecycle
hooks; it should not know how to subscribe to the in-process event bus.

**Anti-patterns:**
- Don't add `subscribeLifecycleEvents` back to `LocalAdeService`.
- Don't pass the whole `DomainEvent` union into Local ADE application methods.
- Don't make bootstrap translate Local ADE lifecycle events; settings init owns
  that subscriber.

---

## Settings change notifications (deepened - c11)

The settings module owns the fan-out for a persisted settings change.

**Interface shape:**
- `SettingsChangeNotifier.publishSettingsChanged(input)` is the settings-owned
  interface used by settings update paths.
- `createEventBusSettingsChangeNotifier(eventBus)` is the composition adapter
  that publishes `settings_updated` and the dashboard refresh event.
- `noopSettingsChangeNotifier` is used by optional settings mutation paths
  when no event bus is wired, especially in Local ADE tests.

**Why:** locality. `UpdateSettingsService`, `ManageBootAllowlistsService`, and
`LocalAdeService` all change settings, but they should not each know the
two-event fan-out contract. The notifier concentrates that policy in one
settings-owned module.

**Anti-patterns:**
- Don't inject `EventBusPort` into settings use-cases just to publish
  `settings_updated` and `dashboard_refresh`.
- Don't duplicate the settings-change fan-out pair at individual mutation
  call sites.

---

## Project lifecycle notifications (deepened - c12)

The project module owns project mutation fan-out and deletion ordering.

**Interface shape:**
- `ProjectLifecycleNotifier` exposes project intents:
  `projectCreated`, `projectUpdated`, `projectSetActive`,
  `beforeProjectDelete`, and `afterProjectDeleted`.
- `createEventBusProjectLifecycleNotifier(eventBus)` is the composition
  adapter that maps those intents to `dashboard_refresh`, `project_deleting`,
  and `project_deleted` events.

**Why:** locality. Create/update/set-active/delete use cases should not each
know dashboard refresh payloads. Delete also has an ordering invariant:
`project_deleting` must publish before the repository row is removed so
module-owned subscribers can clean related state while project metadata still
exists. The notifier concentrates that event policy in one project-owned
module.

**Anti-patterns:**
- Don't inject `EventBusPort` into project mutation use cases just to publish
  dashboard refresh events.
- Don't duplicate project deletion event ordering outside the project notifier.

---

## Agent lifecycle notifications (deepened - c13)

The agent module owns dashboard refresh fan-out for agent mutations.

**Interface shape:**
- `AgentLifecycleNotifier` exposes agent intents: `agentCreated`,
  `agentUpdated`, and `agentDeleted`.
- `createEventBusAgentLifecycleNotifier(eventBus)` is the composition adapter
  that maps those intents to `dashboard_refresh` events.

**Why:** locality. Agent create/update/delete use cases should own agent
configuration behavior, not dashboard event payload details. The notifier
keeps UI refresh policy in one agent-owned module and keeps the mutation use
cases small.

**Anti-patterns:**
- Don't inject `EventBusPort` into agent mutation use cases just to publish
  dashboard refresh events.
- Don't duplicate agent dashboard refresh payloads at individual mutation call
  sites.

---

## Session lifecycle notifications (deepened - c14)

The session module owns event-bus fan-out for session create/stop/delete use
cases.

**Interface shape:**
- `SessionLifecycleNotifier` exposes session intents:
  `agentSessionCreated`, `agentSessionStopped`, and `sessionDeleted`.
- `createEventBusSessionLifecycleNotifier(eventBus)` is the composition
  adapter that maps those intents to typed lifecycle events and dashboard
  refresh events.
- `noopSessionLifecycleNotifier` keeps tests and optional creation paths from
  depending on the event bus when no lifecycle fan-out is required.

**Why:** locality. Session lifecycle use cases should express session
behavior and ordering, not duplicate event-bus payload details. The notifier
keeps lifecycle event shape, dashboard refresh reasons, and event ordering in
one session-owned module while preserving the existing best-effort
create-session notification policy.

**Anti-patterns:**
- Don't inject `EventBusPort` into session create/stop/delete use cases just
  to publish lifecycle or dashboard refresh events.
- Don't duplicate `agent_session_created`, `agent_session_stopped`,
  `session_stopped`, or `session_deleted` payload shapes at individual
  mutation call sites.

---

## Quota refresh notifications (deepened - c15)

The quota module owns provider quota refresh fan-out.

**Interface shape:**
- `ProviderQuotaNotifier.providerQuotaRefreshed(input)` accepts the quota-owned
  facts: user id, current snapshot, previous snapshot, and clock time.
- `createEventBusProviderQuotaNotifier(eventBus)` maps those facts to
  `provider_quota_refreshed`, including derived fields such as minimum
  remaining percentage, next reset time, previous status, and changed state.
- `noopProviderQuotaNotifier` keeps provider quota tests and optional use-case
  construction independent of the event bus.

**Why:** locality. `ProviderQuotaService` should own provider detection,
credential resolution, fetch, cache, and snapshot storage. It should not also
know the shared event payload shape used by bot automation and usage-stats
subscribers. The notifier concentrates quota event derivation in one module
and gives tests a smaller seam.

**Anti-patterns:**
- Don't inject `EventBusPort` into `ProviderQuotaService` just to publish
  `provider_quota_refreshed`.
- Don't duplicate min-percent, next-reset, or changed-state derivation outside
  the quota notifier.

---

## Coding-plan subscription notifications (deepened - c16)

The coding-plan subscription module owns subscription update fan-out.

**Interface shape:**
- `CodingPlanSubscriptionNotifier.subscriptionUpdated(input)` accepts the
  subscription-owned facts: previous state, next state, and update source.
- `createEventBusCodingPlanSubscriptionNotifier(eventBus)` maps those facts to
  `coding_plan_subscription_updated`.
- `noopCodingPlanSubscriptionNotifier` keeps status, gate, and billing tests
  independent of the event bus.

**Why:** locality. `CodingPlanSubscriptionService` should own plan definitions,
feature gates, local updates, and billing sync transitions. It should not also
know the shared event payload shape used by downstream automation and telemetry
subscribers. The notifier concentrates event shape and semantic changed-state
derivation in one coding-plan-owned module.

**Anti-patterns:**
- Don't inject `EventBusPort` into `CodingPlanSubscriptionService` just to
  publish `coding_plan_subscription_updated`.
- Don't duplicate subscription changed-state derivation outside the
  coding-plan subscription notifier.

---

## File-watcher notifications (deepened - c17)

The file-watcher module owns file change fan-out.

**Interface shape:**
- `FileWatcherNotifier.fileChanged(input)` accepts file-watcher facts:
  project root, relative path, change kind, and watched sessions.
- `createEventBusFileWatcherNotifier(eventBus)` maps those facts to
  `file_watcher_file_changed` and owns the event timestamp.
- `noopFileWatcherNotifier` keeps watcher tests independent of the event bus.
- `FileWatcherPort` is the use-case interface for watch/unwatch/status/dispose;
  no pass-through `FileWatcherService` sits in front of it.

**Why:** locality. `FsFileWatcherAdapter` should own filesystem watching,
debounce, ignored paths, and watched-session aggregation. It should not also
know the shared domain-event payload shape consumed by module event init files.
The notifier concentrates file-watcher event shape in one file-watcher-owned
module.

**Anti-patterns:**
- Don't inject `EventBusPort` into `FsFileWatcherAdapter` just to publish
  `file_watcher_file_changed`.
- Don't duplicate `file_watcher_file_changed` payload construction outside the
  file-watcher notifier.
- Don't reintroduce a service that only forwards to `FileWatcherPort`.

---

## Session event outbox dispatch (deepened - c18)

The session module owns durable runtime broadcast fan-out.

**Interface shape:**
- `SessionEventOutboxPort` exposes `enqueue(input)` and `dispatchDue(policy)`;
  callers do not pass the global event bus through the outbox seam.
- `SessionBroadcastNotifier.broadcast(input)` accepts session-owned facts:
  chat id, user id, and the buffered broadcast event.
- `createEventBusSessionBroadcastNotifier(eventBus)` is the composition
  adapter that maps those facts to `session_broadcast`.

**Why:** locality. Runtime broadcast persistence, retry/failure state, and
publish timeout handling belong with the session outbox adapter. Background
tasks should schedule a drain pass, not know how drained rows are fanned out.
The notifier concentrates the shared event payload shape in one session-owned
module.

**Anti-patterns:**
- Don't add `EventBusPort` back to `SessionEventOutboxPort` or background
  task parameters.
- Don't duplicate `session_broadcast` payload construction outside the session
  broadcast notifier and outbox storage adapter.

---

## AI prompt lifecycle notifications (deepened - c19)

The AI module owns prompt lifecycle fan-out.

**Interface shape:**
- `PromptLifecycleEvents` remains the application seam used by
  `SendMessageService` and `PromptTaskRunner`.
- `createEventBusPromptLifecycleNotifier(eventBus, logger)` maps AI-owned
  prompt facts to `prompt_message_sent`, `subagent_invocation_requested`, and
  `prompt_turn_completed`.
- `noopPromptLifecycleNotifier` keeps optional/test construction independent
  of the event bus.

**Why:** locality. Prompt submission, subagent request, and turn completion
event shape belongs with AI prompt orchestration. Module `init` files are for
subscriptions to events from other modules; they should not be the place where
AI publishes its own prompt lifecycle facts.

**Anti-patterns:**
- Don't recreate `modules/ai/init/prompt-turn-lifecycle.init.ts`; publish-side
  prompt lifecycle mapping belongs in the AI application notifier.
- Don't inject `EventBusPort` into `SendMessageService` or
  `PromptTaskRunner` just to emit prompt lifecycle events.

---

## Service-registry dependency slices (deepened - c20)

Simple service-registry factories expose narrow composition interfaces.

**Interface shape:**
- `ServiceRegistryDependencies` remains the complete composition object built
  by `initializeServiceModule`.
- `ServiceRegistrySlice<...>` is used by `create*UseCases` factories to state
  only the composition fields they consume.
- Even broader factories, such as session, use named slices instead of the
  complete registry object.

**Why:** locality. A factory that only needs `clock`, `projectRepo`, or
`eventBus + appLogger` should not advertise the whole runtime graph as its
interface. Narrow slices make accidental dependency growth visible in the
factory signature and keep tests or future extraction work focused.

**Anti-patterns:**
- Don't pass `ServiceRegistryDependencies` to a use-case factory when a
  `ServiceRegistrySlice` can express its real dependency seam.
- Don't split a broad orchestrating factory just to satisfy the pattern; use
  the slice where the factory already has a small responsibility.

---

## Managed SSE streams (deepened - c21)

Transport-owned SSE endpoints share one lifecycle module.

**Interface shape:**
- `createManagedSseStream` owns controller closure, request-abort cleanup,
  unsubscribe ordering, heartbeat timers, and backpressure fail-fast behavior.
- Route handlers provide only their endpoint-specific `start` subscription,
  heartbeat payload, and event/log payload mapping.

**Why:** locality. Slow-consumer handling and cleanup order are correctness
rules for every SSE endpoint, not dashboard-route business logic. The helper
keeps those rules in one transport module while preserving small route
interfaces for auth, filtering, and response headers.

**Anti-patterns:**
- Don't hand-roll `ReadableStream` lifecycle, heartbeat, and unsubscribe logic
  in individual HTTP routes.
- Don't move endpoint-specific visibility or query filtering into the SSE
  helper; those stay at the route seam.

---

## Auth management route data normalizers (deepened - c52)

Admin API routes and dashboard UI bootstrapping both present Better Auth API
keys and device sessions, but their route error semantics differ. The shared
piece is normalization from Better Auth date-like records to dashboard/admin
wire data, not request handling.

**Interface shape:**
- `transport/http/routes/auth-management-data.ts` owns API key, created API
  key, and device-session item normalization.
- `admin.ts` keeps admin endpoint status/error behavior but delegates item
  shape conversion to the auth management data module.
- `dashboard.ts` keeps best-effort dashboard loading behavior but delegates the
  same item shape conversion to that module.
- `helpers.ts` remains for generic request body parsing, query validation, and
  pagination; it does not own feature-shaped auth data.

**Why:** locality. Date conversion, null handling, and presentation field shape
for auth management records should change in one test surface. Routes keep the
parts that actually vary: admin API failures return 500, while dashboard page
bootstrapping logs and continues with empty lists.

**Anti-patterns:**
- Don't put API key or device-session normalizers back into generic
  `helpers.ts`.
- Don't make dashboard UI and admin API share one whole route workflow; only
  the auth management item shape is common.
- Don't let routes hand-map Better Auth date fields inline.

---

## HTTP route error response policy (deepened - c53)

JSON/action HTTP routes share the same error taxonomy: malformed JSON body,
application errors, and unexpected exceptions. The response policy now lives in
one transport module instead of being reimplemented in each route handler.

**Interface shape:**
- `respondToRouteError(c, error, options)` handles `JsonBodyParseError`,
  `AppError`, logging, fallback message, fallback status, and optional
  unexpected Error message exposure.
- Agents, projects, settings, and admin routes pass route-owned log/fallback
  strings while delegating the known-error ordering and status normalization.
- Settings routes opt into exposing unexpected `Error.message` with status 400
  because those flows historically treat parser/form errors as client-owned.
- Agent/project/admin routes keep hidden unexpected errors with status 500.

**Why:** locality. Status preservation for known errors, logging shape, and
unexpected-error hiding are transport policy. Changing that policy should hit
one test surface, not every POST/PUT/DELETE handler.

**Anti-patterns:**
- Don't reintroduce per-route `isJsonBodyParseError` + `isAppError` catch
  ladders.
- Don't hide route-specific fallback text inside `respondToRouteError`; each
  route still owns its user-facing operation message.
- Don't use this module for successful payload shaping; it only maps errors to
  HTTP responses.

---

## HTTP route auth context (deepened - c54)

Authenticated HTTP routes share the same request-to-auth-context choreography:
pass raw headers, URL, and the internal remote-address header into
`resolveAuthContext`, then return the standard JSON `401 Unauthorized` response
when no user is present. That transport policy now sits behind one route auth
module instead of being copied into each route file.

**Interface shape:**
- `resolveRouteUserId(c, resolveAuthContext)` maps a Hono route context to the
  auth adapter input and returns the resolved user id or `null`.
- `requireRouteUserId(c, resolveAuthContext)` returns `{ ok: true, userId }` or
  `{ ok: false, response }` with the standard unauthorized JSON response.
- Agents, projects, sessions, blobs, and dashboard API routes delegate auth
  context resolution through this interface before running route-owned
  validation and use-case calls.

**Why:** locality. Header extraction, URL forwarding, remote-address forwarding,
and unauthenticated response shape are one transport concern. Changing the auth
request interface or 401 body should hit one test surface, not every route.

**Anti-patterns:**
- Don't rebuild `resolveAuthContext({ headers, url, remoteAddress })` inline in
  authenticated HTTP routes.
- Don't make `route-auth.ts` call application use cases; it only resolves route
  auth state.
- Don't move route-specific validation into `requireRouteUserId`; callers still
  own their input and response payload contracts.

---

## Agent HTTP route input adapter (deepened - c55)

The agent module already owns the application input schemas used by tRPC.
Dashboard HTTP forms add one transport-only convenience field, `argsInput`,
which must be tokenized before the create/update use cases receive agent
application input. That adaptation now lives in one route input module instead
of being reimplemented inside `agents.ts`.

**Interface shape:**
- `parseCreateAgentRouteInput(payload)` returns `{ ok: true, input }` matching
  `CreateAgentInput` or `{ ok: false, error }`.
- `parseUpdateAgentRouteInput(payload)` does the same for `UpdateAgentInput`.
- `parseDeleteAgentRouteInput(payload)` adapts form submissions to `{ agentId }`
  or the existing `agentId is required` error.
- `agent-route-input.ts` derives valid agent types from `AgentTypeSchema`,
  resolves explicit `args` before `argsInput`, tokenizes `argsInput`, and then
  validates create/update payloads against the agent application schemas.
- `agents.ts` still owns auth, JSON body size, use-case dispatch, and HTTP
  response shape; it no longer owns agent type lists, args tokenization, or
  delete form field validation.

**Why:** leverage. The agent type list and create/update payload rules now have
one test surface shared conceptually with tRPC's application schemas. HTTP-only
form adaptation remains local to transport without leaking into the agent
application use cases.

**Anti-patterns:**
- Don't reintroduce `VALID_AGENT_TYPES` or `parseArgsInput` directly in
  `agents.ts`.
- Don't add `argsInput` to `CreateAgentInputSchema` or `UpdateAgentInputSchema`;
  it is a transport convenience field, not application input.
- Don't cast `await c.req.parseBody()` directly to get `agentId` in
  `agents.ts`; route form fields go through `agent-route-input.ts`.
- Don't move auth or route error response policy into `agent-route-input.ts`;
  it only adapts HTTP payloads to agent application input.

---

## Project HTTP route input adapter (deepened - c56)

The project module owns create/update application schemas and lifecycle rules.
Dashboard HTTP project creation still has transport defaults: empty descriptions
become `null`, absent/malformed optional arrays become `[]`, missing Obsidian
path becomes `null`, and HTTP-created projects start with `favorite: false`.
That adaptation now lives in one route input module instead of inside
`projects.ts`.

**Interface shape:**
- `parseCreateProjectRouteInput(payload)` returns `{ ok: true, input }`
  matching `CreateProjectInput` or `{ ok: false, error }`.
- `parseDeleteProjectRouteInput(payload)` adapts form submissions to
  `{ projectId }` or the existing `projectId is required` error.
- `project-route-input.ts` preserves the existing HTTP required-field error
  (`name and path are required`) and validates the adapted payload with
  `CreateProjectInputSchema`.
- `projects.ts` still owns auth, JSON body size, use-case dispatch, delete body
  handling, and HTTP response shape.

**Why:** locality. Project create route defaults and application schema reuse now
have one test surface. Future changes to dashboard project create payloads no
longer require reading the route handler together with project lifecycle rules.

**Anti-patterns:**
- Don't put project create payload normalization back into `projects.ts`.
- Don't cast `await c.req.parseBody()` directly to get `projectId` in
  `projects.ts`; route form fields go through `project-route-input.ts`.
- Don't move path resolution, duplicate-path checks, or lifecycle notifications
  into `project-route-input.ts`; those remain in the project application module.
- Don't make `CreateProjectInputSchema` encode HTTP-only defaults such as
  `favorite: false`; those belong to this route adapter.

---

## Settings HTTP route input adapter (deepened - c57)

The settings application module owns patch validation, project-root
normalization, app-config validation, changed-key detection, and restart
requirements. The HTTP `/ui-settings` route still has transport input policy:
JSON bodies are raw settings patches, while form submissions must be converted
from dashboard field names into a `SettingsPatch` using the current settings
snapshot. That adaptation now lives in one route input module instead of inside
`settings.ts`.

**Interface shape:**
- `readUiSettingsRouteInput(params)` chooses JSON versus form handling from the
  request content type and returns `{ ok: true, input }` as a
  `SettingsPatch` or `{ ok: false, error }`.
- `parseJsonUiSettingsRouteInput(payload)` only enforces the transport-level
  rule that JSON patches are objects; deep settings validation remains in
  `UpdateSettingsService`.
- `parseFormUiSettingsRouteInput(formData, currentSettings)` wraps the
  dashboard form conversion and returns the application patch shape.
- `settings.ts` still owns body-size limits, Hono body reading, use-case
  dispatch, boot-allowlist routing, and HTTP response shape.

**Why:** locality. The `/ui-settings` route no longer has to know the details
of form field names, current-settings fallback, or JSON-object preconditions.
Tests can exercise the transport patch interface directly while settings
application tests remain the surface for validation and restart behavior.

**Anti-patterns:**
- Don't put UI settings content-type branching or form-to-patch normalization
  back into `settings.ts`.
- Don't move changed-key detection, restart requirements, project-root
  normalization, or app-config validation into `settings-route-input.ts`.
- Don't make the route input adapter own boot-allowlist validation; that
  remains behind `ManageBootAllowlistsService`.

---

## Admin HTTP route input adapter (deepened - c58)

Admin routes own Better Auth operation dispatch, session lookup, and response
shape. Their JSON action endpoints still have transport input policy: API key
creation only accepts the optional fields Better Auth understands, API key
delete accepts the legacy `id` alias when `keyId` is absent, and device-session
actions require `sessionToken`. That adaptation now lives in one route input
module instead of being destructured inline in `admin.ts`.

**Interface shape:**
- `parseCreateApiKeyRouteInput(payload)` returns optional `name`, `prefix`, and
  finite `expiresIn` fields, dropping malformed optional values without owning
  Better Auth validation.
- `parseDeleteApiKeyRouteInput(payload)` returns `{ keyId }` or the existing
  `keyId is required` error, preserving the rule that an explicit `keyId`
  takes precedence over legacy `id`.
- `parseDeviceSessionRouteInput(payload)` returns `{ sessionToken }` or the
  existing `sessionToken is required` error for revoke and activate actions.
- `admin.ts` still owns body-size limits, Better Auth calls, create-key session
  lookup, auth management output normalization, and HTTP response shape.

**Why:** locality. Admin JSON action field names, alias handling, and required
field errors now have one test surface. Better Auth orchestration remains in
the admin route, while request-shape bugs no longer require reading four route
handlers.

**Anti-patterns:**
- Don't destructure admin JSON action bodies directly in `admin.ts`.
- Don't move Better Auth session lookup, API calls, or auth management output
  normalization into `admin-route-input.ts`.
- Don't make the admin input adapter share a whole workflow with dashboard auth
  management; c52 only shares data normalization because error semantics differ.

---

## Blob HTTP route input and header adapter (deepened - c59)

Blob routes own authentication and blob storage IO. The transport contract
around blob download still has several coupled rules: validate the route
`blobId`, parse truthy download query values, choose inline versus attachment
disposition, sanitize requested filenames for HTTP headers, normalize missing
MIME types to `application/octet-stream`, and derive fallback filename
extensions from MIME type. That policy now lives in one route adapter instead
of inside `blobs.ts`.

**Interface shape:**
- `parseBlobRouteRequest({ blobId, filename, download })` returns
  `{ blobId, requestedFilename, download }` or the existing
  `blobId is required` error.
- `createBlobRouteHeaders(input)` returns the complete header map for a stored
  blob response: content type, content length, cache policy, and content
  disposition.
- `blob-route-input.ts` owns filename basename extraction across slash styles,
  unsafe header-character replacement, download truthy values, and MIME
  extension fallback.
- `blobs.ts` still owns route auth, storage lookup, missing-blob 404s, and
  response body construction.

**Why:** locality. Blob download header behavior is now one test surface rather
than hidden in the route handler. Storage and auth behavior remain in the route
where the IO happens, while future filename/MIME/download changes no longer
require inspecting blob-store access.

**Anti-patterns:**
- Don't put filename sanitization, MIME extension fallback, or content
  disposition string construction back into `blobs.ts`.
- Don't move blob storage reads into `blob-route-input.ts`; it is a transport
  adapter, not a storage adapter.
- Don't let requested filenames pass through to `Content-Disposition` without
  basename extraction and unsafe-character replacement.

---

## Session HTTP form action input adapter (deepened - c60)

Session HTTP action routes own auth, use-case dispatch, and response shape.
Their stop/delete form submissions share one transport invariant: the request
body must contain a non-empty `chatId`, otherwise the route returns the existing
`chatId is required` error. That adaptation now lives in one route input module
instead of being cast from `parseBody()` in each session handler.

**Interface shape:**
- `parseSessionActionRouteInput(payload)` returns `{ chatId }` or
  `{ ok: false, error: "chatId is required" }`.
- `session-route-input.ts` is shared by `/sessions/stop` and `DELETE /sessions`
  because both actions cross the same session action form seam.
- `sessions.ts` still owns auth resolution, use-case selection, and success
  response shape.

**Why:** locality. The stop/delete route handlers no longer duplicate form-body
casting and required-field policy. The session action input contract now has
one test surface while the application use cases remain focused on session
lifecycle behavior.

**Anti-patterns:**
- Don't cast `await c.req.parseBody()` directly to get `chatId` in
  `sessions.ts`.
- Don't move stop/delete use-case selection into `session-route-input.ts`; it
  only adapts HTTP form payloads.
- Don't merge this into a generic untyped route helper unless multiple fields
  need identical behavior and the caller contract remains explicit at the route
  seam.

---

## Dashboard page route state adapter (deepened - c61)

Dashboard UI routes own authentication, dashboard page data loading, Better
Auth best-effort bootstrap data, and HTML rendering. The initial page query
string still has a transport-only state contract: active tab normalization,
success flag parsing, optional notice/error bootstrap fields, and restart-key
splitting. That adaptation now lives in one route input module instead of being
assembled inline in `dashboard.ts`.

**Interface shape:**
- `parseDashboardPageRouteState(query)` returns the initial dashboard page
  state used by `DashboardPage`: `activeTab`, `success`, optional `notice`,
  optional `errors`, and optional `requiresRestart`.
- `dashboard-page-route-input.ts` preserves existing behavior: only
  `success=1` is true, unknown tabs normalize through `normalizeTab`, notice
  and error values are passed through without trimming, and restart keys are
  comma-split with per-key trimming.
- `dashboard.ts` still owns route auth, settings/page-data reads, Better Auth
  record loading, render document metadata, and static asset routing.

**Why:** locality. Dashboard bootstrap query behavior is now one test surface
instead of being mixed into the initial page route's IO and rendering flow.
Future changes to URL state no longer require reading the whole dashboard
route alongside dashboard read-model composition.

**Anti-patterns:**
- Don't parse `tab`, `success`, `error`, `notice`, or `restart` inline in
  `dashboard.ts`.
- Don't move dashboard data loading, Better Auth calls, or document rendering
  into `dashboard-page-route-input.ts`; it only adapts route query state.
- Don't make `DashboardPage` own URL query parsing; presentation receives
  normalized bootstrap state.

---

## Dashboard API route input adapter (deepened - c62)

Dashboard API routes own auth resolution, use-case dispatch, log-store IO, and
SSE response lifecycles. Their query strings still have feature-specific
transport policy: dashboard session pagination falls back to configured
defaults and clamps to runtime max limits, while log query params validate
levels, semantic ranges, timestamps, source filters, search text, ordering, and
`acpOnly` booleans. That adaptation now lives beside the dashboard API route
instead of in generic HTTP helpers.

**Interface shape:**
- `parseDashboardSessionPaginationParams(params, maxLimit)` returns dashboard
  session list pagination with existing fallback behavior for malformed
  `limit` and `offset`.
- `parseLogQueryParams(params)` returns a `LogQuery` or a route error string
  for invalid log filters.
- `dashboard-api-route-input.ts` owns log query constants, boolean aliases,
  semantic range-to-timestamp conversion, source normalization, and pagination
  clamping.
- `helpers.ts` now stays generic: JSON body reading, body-size enforcement,
  and `JsonBodyParseError` only.
- `dashboard-api.ts` still owns user scoping, log-store calls, event
  visibility, SSE setup, and JSON response shape.

**Why:** locality. Dashboard/log query behavior is now one feature-shaped test
surface rather than hidden inside a broad helper module. Generic HTTP helpers
no longer need to know about log levels, dashboard session pagination, or
server-side semantic time ranges.

**Anti-patterns:**
- Don't add dashboard/log query parsers back to `helpers.ts`; route input
  policy belongs beside the route that owns the feature.
- Don't make `dashboard-api-route-input.ts` call log stores, event buses, or
  dashboard use cases; it only adapts query strings.
- Don't duplicate log query parsing between `/logs` and `/logs/stream`; both
  endpoints cross the same log query route input seam.

---

## Dashboard asset route input and header adapter (deepened - c63)

Dashboard UI routes own static asset lookup and response body IO. The asset URL
contract still has transport policy: only direct dashboard asset names are
accepted, malformed percent-encoding is rejected as not found, encoded or raw
nested paths are rejected, and cache/ETag headers differ between dev and
production runtime modes. That policy now lives in one route input/header
module instead of being assembled inline in `dashboard.ts`.

**Interface shape:**
- `parseDashboardAssetRouteRequest(path)` returns `{ assetName }` or the
  existing `"Not found"` route error.
- `createDashboardAssetRouteHeaders(input)` returns the cache, content-type,
  and ETag headers for a served dashboard asset.
- `dashboard-asset-route-input.ts` owns dashboard asset prefix parsing,
  percent-decoding failure handling, raw/decoded slash rejection, dev
  no-cache behavior, immutable production cache behavior, and ETag shape.
- `dashboard.ts` still owns Hono route registration, asset manifest lookup,
  missing-asset 404s, and `bunFile` response construction.

**Why:** locality. Dashboard asset safety and caching behavior now have one
test surface. Future changes to asset path handling or cache policy no longer
require reading the full dashboard UI route with auth, page bootstrapping, and
HTML rendering.

**Anti-patterns:**
- Don't parse dashboard asset names or assemble asset cache/ETag headers inline
  in `dashboard.ts`.
- Don't move asset manifest lookup or filesystem response construction into
  `dashboard-asset-route-input.ts`; it only adapts route path/header policy.
- Don't allow encoded slash or backslash sequences to become accepted asset
  names after decoding.

---

## Dashboard legacy redirect route input adapter (deepened - c64)

Dashboard UI has two legacy entry points, `/` and `/dashboard`, that redirect
to `/_/dashboard`. Their redirect contract still has transport policy: preserve
the raw query string after the first `?`, trim whitespace-only query text, and
fall back to the dashboard UI path when no query is present. That policy now
lives in one route input module instead of being assembled inline in
`dashboard.ts`.

**Interface shape:**
- `createDashboardLegacyRedirectLocation(requestUrl)` returns the redirect
  target for legacy dashboard entry points.
- `dashboard-redirect-route-input.ts` owns raw-query extraction and no-query
  fallback behavior.
- `dashboard.ts` still owns which legacy paths exist and the Hono redirect
  response call.

**Why:** locality. Legacy URL preservation is now a small test surface rather
than hidden in the dashboard UI route next to auth, asset serving, data loading,
and HTML rendering.

**Anti-patterns:**
- Don't rebuild legacy query preservation inline in `dashboard.ts`.
- Don't move route registration for `/` or `/dashboard` into the redirect input
  adapter; it only builds a redirect location.
- Don't parse and reserialize the query with `URLSearchParams` unless the
  redirect contract is intentionally redesigned; the current behavior preserves
  raw query text after the first `?`.

---

## tRPC connection auth request adapter (deepened - c65)

tRPC context creation owns dependency injection and calls the shared auth
resolver. WebSocket connection params still have transport input policy before
auth resolution: cookie/API-key/local-token aliases are trimmed, translated to
headers only when the handshake did not already provide an equivalent auth
header, and record-vs-`Headers` request shapes are preserved. That adaptation
now lives in one tRPC auth request module instead of inside `context.ts`.

**Interface shape:**
- `createTrpcAuthRequest(req, connectionParams)` returns the request passed to
  `resolveAuthContext`, or `undefined` when no request is available.
- `context-auth-request.ts` owns connection param aliases (`apiKey`,
  `api_key`, `apikey`, `cookie`, `cookieHeader`, `eragearLocalToken`,
  `localAuthToken`, `local_auth_token`), trim policy, and header precedence.
- `context.ts` still owns app dependencies, invoking `resolveAuthContext`, and
  exposing the final tRPC context shape.

**Why:** locality. WebSocket auth handoff rules are now one test surface rather
than being mixed into context construction. Future changes to connection-param
aliases or header precedence no longer require reading tRPC dependency wiring.

**Anti-patterns:**
- Don't extract connection params or mutate auth headers inline in `context.ts`.
- Don't make `context-auth-request.ts` call `resolveAuthContext` or access use
  cases; it only adapts request shape before auth resolution.
- Don't let connection-param auth override explicit handshake `cookie`,
  `authorization`, `x-api-key`, `x-api_key`, or `x-eragear-local-token`
  headers.

---

## tRPC auth context helpers (deepened - c66)

tRPC protected routers need the authenticated user id and sometimes the full
auth context, but Unauthorized error semantics belong at the transport auth
seam. Router files should not each reconstruct `ctx.auth` checks or local
helpers.

**Interface shape:**
- `getRequiredAuthContext(ctx)` returns the authenticated tRPC auth context or
  throws the standard `UNAUTHORIZED` `TRPCError`.
- `getRequiredUserId(ctx)` delegates to `getRequiredAuthContext(ctx)` and
  returns `userId`.
- `protectedProcedure` still rejects unauthenticated calls at middleware time;
  the helpers are the router-facing type and safety seam for use-case inputs.
- `auth.ts` uses the full auth context for local-user fallback metadata.
- `oauth.ts` and other user-scoped routers use `getRequiredUserId(ctx)` rather
  than local auth extraction helpers.

**Why:** locality. tRPC auth-context access and Unauthorized fallback behavior
are now one test surface. Future changes to auth context shape or Unauthorized
mapping no longer require auditing individual routers for local copies.

**Anti-patterns:**
- Don't add router-local `getAuthUserId` helpers.
- Don't read `ctx.auth.userId` directly in routers when passing user scope to a
  use case; use `getRequiredUserId(ctx)`.
- Don't duplicate `new TRPCError({ code: "UNAUTHORIZED" })` outside
  `protectedProcedure` and `auth-helpers.ts`.

---

## tRPC auth get-me response adapter (deepened - c67)

The `auth.getMe` router owns the protected auth context lookup and calls
`GetMeService`, but the transport response shape and local-desktop fallback
metadata belong to a router data adapter. The application use case should not
fabricate a local desktop profile when auth storage has no user row.

**Interface shape:**
- `createAuthMeResponse(auth, user)` returns `{ user }` for an existing
  `GetMeService` user.
- For local auth with no stored user, the adapter returns the local desktop
  fallback profile using the authenticated `userId` and the transport-local
  display metadata (`username: "local"`, `name: "Local Desktop"`).
- For non-local auth with no readable user, the adapter returns `{ user: null }`.
- `auth.ts` remains responsible for calling `getRequiredAuthContext(ctx)` and
  `ctx.useCases.auth.getMe.execute(auth.userId)`.

**Why:** locality. The local-desktop tRPC response contract is now one test
surface instead of inline router branching. Future changes to fallback metadata
or missing-user behavior should be made in the adapter, not split between
router code and the auth application module.

**Anti-patterns:**
- Don't inline local desktop fallback objects in `routers/auth.ts`.
- Don't move Better Auth or `GetMeService` reads into the response adapter.
- Don't make `GetMeService` synthesize the local desktop user; that fallback is
  transport auth metadata, not an auth-user read model.

---

## tRPC session start response adapter (deepened - c68)

The session router owns protected auth lookup and calls the session start
use-cases, but the client response projection for newly created or agent-loaded
sessions lives in a router data adapter. Both `createSession` and
`loadAgentSession` cross the same response-shaping interface.

**Interface shape:**
- `createSessionStartResponse(result)` maps the session start result to the
  client contract: `chatId`, agent session metadata, chat status, mode/model
  selection, session info, prompt capabilities, load-session support, and agent
  metadata.
- Transport defaults are centralized: missing `sessionLoadMethod` and
  `sessionInfo` become `null`, missing `loadSessionSupported` becomes `false`,
  and missing `agentInfo` becomes `null`.
- Client selection capping lives behind this adapter, including the OpenCode
  rule that strips available model payloads and model config options.
- `session-lifecycle-router.ts` remains responsible for user scope, input
  schemas, and calling the `create` or `loadAgentSession` use-case.

**Why:** leverage. Session start response policy is used by multiple tRPC
procedures and should be tested once. Future changes to model-list capping,
OpenCode response behavior, or null/default semantics should not require
auditing both create and load branches in the router.

**Anti-patterns:**
- Don't duplicate session start response object literals in
  `routers/session-lifecycle-router.ts`.
- Don't move create/load use-case calls or auth user-id lookup into the router
  data adapter.
- Don't bypass `createSessionStartResponse` when adding another session start
  procedure that returns the same client contract.

---

## tRPC session events observable adapter (deepened - c69)

The session application module owns preparing `SessionEventSubscription`
snapshots from live runtime sessions or stored inactive sessions. The tRPC
transport owns adapting that subscription into an observable client stream:
startup error mapping, initial replay event ordering, diagnostics, live event
forwarding, and release cleanup.

**Interface shape:**
- `createSessionEventsObservable({ service, userId, chatId, logger })` calls the
  session events use-case and returns the tRPC observable for
  `onSessionEvents`.
- `createSessionReplayEvents(subscription)` emits `connected` only for
  `source: "runtime"`, then emits the current `chat_status`, then buffered
  replay events.
- If the client unsubscribes before subscription startup resolves, the adapter
  releases the eventual session subscription without emitting stale replay
  events.
- `session-events-router.ts` remains responsible for input schema validation,
  protected auth user id lookup, and passing the session events use-case to the
  adapter.

**Why:** locality. The stored-vs-runtime client-stream contract and cleanup
ordering are now one test surface instead of a high-complexity inline router
closure. Future changes to initial replay ordering, diagnostics, or release
failure logging should happen in the adapter, not inside the session router.

**Anti-patterns:**
- Don't rebuild the `observable<BroadcastEvent>` lifecycle inline in
  `routers/session-events-router.ts`.
- Don't emit `connected` for stored inactive snapshots; only runtime-backed
  subscriptions imply a live prompt channel.
- Don't move runtime subscription preparation or buffered-event construction
  out of `SubscribeSessionEventsService`; the tRPC adapter only adapts the
  already-prepared subscription to the client stream.

---

## tRPC AI config option response adapter (deepened - c70)

The AI application module owns validating and mutating agent-exposed session
configuration options. The tRPC transport owns the client response contract
after that mutation: clients receive the post-mutation session state projection,
not necessarily the raw mutation result.

**Interface shape:**
- `createSetConfigOptionResponse(result, sessionState)` maps the
  `SetConfigOptionService` result plus the canonical `SessionQueries.state`
  projection into the tRPC `setConfigOption` response.
- The latest session state wins for `configOptions`, so stale mutation payloads
  cannot override the query projection returned to web/native clients.
- Missing or `null` session-state config options normalize to `[]`, preserving
  the existing tRPC client contract.
- `ai-config-router.ts` remains responsible for input schema validation,
  protected auth user id lookup, logging, calling the AI mutation use-case, and
  reading canonical session state.

**Why:** locality. The transport fallback and stale-result precedence rule are
now one test surface instead of hidden inside the router mutation body. Future
changes to `setConfigOption` response defaults or canonical-state precedence
should happen in the adapter.

**Anti-patterns:**
- Don't inline `sessionState.configOptions ?? []` in AI config procedure
  routers.
- Don't move config-option validation, ACP retry policy, or runtime mutation
  into the router data adapter; those remain in `SetConfigOptionService`.
- Don't return raw mutation `configOptions` to clients when a canonical session
  state projection has been read.

---

## tRPC terminal events observable adapter (deepened - c71)

The terminal application module owns terminal runtime behavior and event
production. The tRPC transport owns adapting the terminal subscription callback
interface into an observable client stream.

**Interface shape:**
- `createTerminalEventsObservable({ service, userId, terminalId })` subscribes
  to the scoped terminal stream and returns the tRPC observable used by
  `onTerminalEvents`.
- The adapter forwards live `TerminalEvent` payloads unchanged and calls the
  terminal unsubscribe callback when the client subscription is torn down.
- `terminal-events-router.ts` remains responsible for input schema validation,
  protected auth user id lookup, and passing the terminal use-case facade to the
  adapter.

**Why:** locality. Terminal stream lifecycle is now one test surface instead of
an inline router closure. Future changes to terminal subscription adaptation,
teardown behavior, or stream diagnostics should happen in the adapter without
mixing with terminal CRUD procedures.

**Anti-patterns:**
- Don't rebuild the `observable<TerminalEvent>` closure inline in
  `routers/terminal-events-router.ts`.
- Don't move terminal runtime subscription ownership into the adapter; it only
  adapts the already-scoped terminal service subscription to tRPC.
- Don't transform terminal event payloads here unless the client stream
  contract is explicitly redesigned.

---

## tRPC file-watcher status scope adapter (deepened - c72)

The file-watcher application module owns watched-root/session state and accepts
an application status input shaped as `{ userId } | undefined`. The tRPC
transport owns the client request contract for dashboard status reads:
`currentUserOnly` defaults to current-user scope, and only explicit
`currentUserOnly: false` requests a global snapshot.

**Interface shape:**
- `FileWatcherStatusRequestSchema` is the tRPC request schema. It is strict and
  only accepts the transport flag `currentUserOnly`; clients cannot pass
  `userId` directly.
- `createFileWatcherStatusInput(input, userId)` maps the transport request to
  the file-watcher application input: default and `true` become `{ userId }`;
  explicit `false` becomes `undefined`.
- `file-watcher.ts` remains responsible for protected auth user id lookup,
  schema registration, and calling the file-watcher use-case facade.

**Why:** locality. User-scope defaulting and the global-read escape hatch are
transport policy, not file-watcher runtime behavior. The mapping is now one
test surface instead of a ternary hidden in the router.

**Anti-patterns:**
- Don't inline `input?.currentUserOnly === false ? undefined : { userId }` in
  `routers/file-watcher.ts`.
- Don't let tRPC clients pass a raw `userId` into file-watcher status reads.
- Don't move watched-root/session aggregation into the router data adapter; it
  only maps transport input to application input.

---

## tRPC session resume response adapter (deepened - c73)

The session application module owns reactivating stored sessions. The tRPC
transport owns the client response projection after resume, including the rule
that canonical post-resume session state wins for model/config selection.

**Interface shape:**
- `createSessionResumeResponse(result, sessionState)` maps a
  `ResumeSessionService` result plus the canonical `SessionQueries.state`
  projection into the tRPC `resumeSession` response.
- `models` and `configOptions` always come from the fresh session-state
  projection, so stale resume result selection data cannot override capped or
  refreshed client-visible state.
- Other resume metadata remains unchanged: `ok`, `alreadyRunning`, `chatId`,
  `sessionLoadMethod`, prompt/session capability fields, plan, and related
  resume fields pass through from the resume use-case result.
- `session-lifecycle-router.ts` remains responsible for input validation,
  protected auth user id lookup, calling the resume use-case, and reading
  canonical session state.

**Why:** locality. Resume response selection precedence is now one test surface
instead of a spread-and-overwrite object literal hidden in the router. Future
changes to resume response defaults or canonical-state precedence should happen
in the router data adapter.

**Anti-patterns:**
- Don't inline `{ ...res, models: sessionState.models, configOptions:
  sessionState.configOptions }` in `routers/session-lifecycle-router.ts`.
- Don't move resume orchestration or session-state querying into the response
  adapter; it only projects already-read data.
- Don't return raw resume-result model/config selections when canonical
  session state has been read.

---

## tRPC settings boot allowlist request adapter (deepened - c74)

The settings application module owns boot allowlist normalization, validation,
runtime hot-apply, and persisted boot-config updates. The tRPC transport owns
only the typed client request contract for `updateBootAllowlists`.

**Interface shape:**
- `UpdateBootAllowlistsRequestSchema` is the strict tRPC request schema for
  command policies, env keys, and editable common boot settings.
- `settings.ts` registers that schema and delegates the parsed input directly
  to `ManageBootAllowlistsService.update(input)`.
- Raw boot-config compatibility remains behind `ManageBootAllowlistsService`;
  the tRPC request contract accepts typed numbers/booleans rather than string
  boot-config values or env aliases.

**Why:** locality. The large settings router no longer owns the details of the
boot allowlist request shape, and tests can exercise the transport interface
without constructing the whole router. Boot-config bounds, normalization,
restart behavior, and hot-apply policy stay at the settings application seam.

**Anti-patterns:**
- Don't redefine boot allowlist schemas inline in `routers/settings.ts`.
- Don't move boot allowlist normalization, constraint validation, or runtime
  hot-apply behavior into the tRPC router-data adapter.
- Don't let tRPC clients pass raw boot-config aliases or string values unless
  the transport request contract is explicitly redesigned.

---

## tRPC settings MCP request adapter (deepened - c75)

Local ADE owns project-local MCP server persistence, secret-header rejection,
probe/trust workflows, invocation history, notification monitoring, and remote
control defaults. The tRPC transport owns only the typed client request
contracts for the Local ADE MCP procedures.

**Interface shape:**
- `settings-mcp-router-data.ts` exports strict request schemas for MCP server
  upsert/toggle/trust/probe, manual tool/resource calls, notification watches,
  and remote-control configuration.
- `settings.ts` registers those schemas and delegates parsed inputs directly to
  the matching `LocalAdeService` methods.
- The request schemas keep transport-level constraints local: allowed MCP
  transports, string-only env/header records, non-empty action identifiers, and
  bounded remote-control/watch durations.

**Why:** locality. The large settings router no longer owns the details of the
MCP request interface, while the Local ADE application module keeps the deeper
MCP implementation behavior and tests. Future changes to tRPC request shape can
be verified at the router-data adapter without constructing Local ADE state or
probing MCP transports.

**Anti-patterns:**
- Don't redefine Local ADE MCP request schemas inline in `routers/settings.ts`.
- Don't move MCP secret detection, persistence, probe/trust behavior,
  notification parsing, invocation history, or remote-control defaulting into
  the tRPC router-data adapter.
- Don't allow tRPC MCP requests to carry stored/internal fields such as trust
  timestamps, probe history, or notification history.

---

## tRPC settings checkpoint request adapter (deepened - c76)

Local ADE owns checkpoint capture, preview, restore-token verification,
pre-restore safety checkpoints, conflict shelving, tracked conflict
resolution, selected-file/hunk patch construction, and lifecycle hooks. The
tRPC transport owns only the typed client request contracts for checkpoint
procedures.

**Interface shape:**
- `settings-checkpoint-router-data.ts` exports strict request schemas for
  checkpoint create/preview/restore, selected-file restore, conflict shelving,
  tracked conflict choices, and hunk-level restore/resolve operations.
- `settings.ts` registers those schemas and delegates parsed inputs directly to
  the matching `LocalAdeService` methods.
- The request schemas keep transport-level constraints local: optional
  creation input, required checkpoint identifiers and confirmation strings,
  bounded file selections, bounded hunk selections, and explicit
  `restore | current` conflict choices.

**Why:** locality. The settings router no longer owns checkpoint request-shape
details, while the Local ADE application module remains the test surface for
Git state, restore safety, conflict classification, and persistence behavior.
Future tRPC request changes can be verified at the router-data adapter without
setting up Git checkpoint fixtures.

**Anti-patterns:**
- Don't redefine checkpoint request schemas inline in `routers/settings.ts`.
- Don't move restore-token checks, Git patch filtering, safety checkpoint
  creation, conflict shelving, or lifecycle hook dispatch into the tRPC
  router-data adapter.
- Don't allow tRPC checkpoint requests to carry stored/internal fields such as
  safety checkpoint ids, partial restore records, shelves, diagnostics, or
  checkpoint history.

---

## tRPC settings Project Memory request adapter (deepened - c77)

Local ADE owns project index refresh/search, Project Memory source reading,
redaction, semantic/full retrieval, model-backed or local-token ranking,
context budgeting, preset persistence, and preset diagnostics. The tRPC
transport owns only the typed client request contracts for Project Memory and
project-index procedures.

**Interface shape:**
- `settings-project-memory-router-data.ts` exports strict request schemas for
  project-index refresh/search, Project Memory context building, preset upsert,
  and preset delete.
- `settings.ts` registers those schemas and delegates parsed inputs directly to
  the matching `LocalAdeService` methods.
- The request schemas keep transport-level constraints local: optional refresh
  input, search result limits, `full | semantic` retrieval mode, bounded source
  ids/paths, context byte/chunk caps, preset name/default-query caps, and
  narrow preset delete fields.

**Why:** locality. The settings router no longer owns Project Memory request
shape details, while the Local ADE application module remains the test surface
for indexing, source normalization, redaction, retrieval ranking, clamping, and
persistence behavior. Future tRPC request changes can be verified at the
router-data adapter without building a project-memory fixture.

**Anti-patterns:**
- Don't redefine Project Memory request schemas inline in `routers/settings.ts`.
- Don't move project index scanning, memory source reading, semantic ranking,
  redaction, context assembly, preset normalization, or persistence into the
  tRPC router-data adapter.
- Don't allow tRPC Project Memory requests to carry stored/internal fields such
  as diagnostics, ranker metadata, enabled-state snapshots, or indexed source
  documents.

---

## tRPC settings ACP activity request adapter (deepened - c78)

Local ADE owns ACP activity export, stream retry diagnostics, redacted replay
frame construction, correlation/timeline derivation, preset persistence, and
secret-safe metadata projection. The tRPC transport owns only the typed client
request contracts for ACP activity and replay preset procedures.

**Interface shape:**
- `settings-acp-activity-router-data.ts` exports strict request schemas for ACP
  activity export, stream retry, activity replay, replay preset save, and replay
  preset delete.
- `settings.ts` registers those schemas and delegates parsed inputs directly to
  the matching `LocalAdeService` methods.
- The request schemas keep transport-level constraints local: optional
  export/retry/replay inputs, bounded activity limits, trimmed chat/correlation
  filters, preset name caps, and narrow delete fields.

**Why:** locality. The settings router no longer owns ACP activity filter
shape details, while the Local ADE application module remains the test surface
for log selection, redaction, stream-gap diagnostics, replay ordering,
correlation graphs, and preset persistence. Future tRPC request changes can be
verified at the router-data adapter without constructing log-store fixtures.

**Anti-patterns:**
- Don't redefine ACP activity request schemas inline in `routers/settings.ts`.
- Don't move ACP log querying, metadata redaction, replay frame ordering,
  correlation/timeline derivation, stream diagnostics, or preset normalization
  into the tRPC router-data adapter.
- Don't allow tRPC ACP activity requests to carry stored/internal fields such
  as replay frames, correlation summaries, stream diagnostics, stats, or
  redaction flags.

---

## tRPC settings Local ADE automation request adapter (deepened - c79)

Local ADE owns project-local hook execution, command fingerprint trust,
one-shot operation approvals, scheduling/concurrency policy, batch failure
mode handling, and redacted hook run audit export. The tRPC transport owns only
the typed client request contracts for Local ADE hook automation procedures and
shared automation request enums still used by plugin procedures.

**Interface shape:**
- `settings-local-ade-automation-router-data.ts` exports strict request schemas
  for hook upsert/toggle, lifecycle policy, scheduling policy, trust/approval,
  manual run, batch run, audit review, and audit export.
- The adapter also exports neutral automation request enums for execution
  policy presets, batch failure mode, audit review state, and run status so
  remaining plugin schemas do not redefine equivalent inline literals.
- `settings.ts` registers those schemas and delegates parsed inputs directly to
  the matching `LocalAdeService` methods.

**Why:** locality. The settings router no longer owns hook automation request
shape details, while Local ADE remains the deeper test surface for execution
safety, trust fingerprints, approvals, scheduling, batching, persistence, and
redaction. Future tRPC request changes can be verified at the router-data
adapter without spawning hook processes or constructing audit stores.

**Anti-patterns:**
- Don't redefine hook automation schemas inline in `routers/settings.ts`.
- Don't move hook command normalization, trust persistence, approval checks,
  process execution, scheduling, batch failure handling, or audit redaction into
  the tRPC router-data adapter.
- Don't allow tRPC hook automation requests to carry stored/internal fields
  such as trusted timestamps, operation records, run output, redaction metadata,
  or schedule execution history.

---

## tRPC settings plugin request adapter (deepened - c80)

Local ADE owns project-local plugin descriptors, signed package install and
registry trust workflows, permission grants, command fingerprint trust,
one-shot operation approvals, batch presets/schedules, due-schedule dispatch,
and redacted plugin run audit export. The tRPC transport owns only the typed
client request contracts for Local ADE plugin procedures.

**Interface shape:**
- `settings-plugin-router-data.ts` exports strict request schemas for plugin
  descriptor upsert/toggle, package install/revalidate, registry management,
  registry signer trust/revocation, plugin trust/permission approval, manual
  run, batch run, batch presets, batch schedules, audit review, and audit
  export.
- The plugin request adapter reuses the neutral automation request enums from
  `settings-local-ade-automation-router-data.ts` for execution policy presets,
  batch failure mode, audit review state, and run status.
- `InstallPluginPackageRequestSchema` keeps the transport install mode
  explicit: either a local `manifestPath` or a registry `registryUrl` plus
  `packageId`, never both and never a partial registry request.
- `settings.ts` registers those schemas and delegates parsed inputs directly to
  the matching `LocalAdeService` methods.

**Why:** locality. The settings router no longer owns plugin request-shape
details, while Local ADE remains the deeper test surface for signature
verification, registry refresh/install, trust persistence, permission grants,
execution safety, batch scheduling, due dispatch, persistence, and redaction.
Future tRPC request changes can be verified at the router-data adapter without
constructing signed package fixtures or spawning plugin processes.

**Anti-patterns:**
- Don't redefine plugin request schemas inline in `routers/settings.ts`.
- Don't move plugin package verification, registry trust, permission grants,
  command normalization, approval checks, process execution, batch scheduling,
  due-schedule dispatch, or audit redaction into the tRPC router-data adapter.
- Don't allow tRPC plugin requests to carry stored/internal fields such as
  signed manifest contents, trust timestamps, permission records, operation
  records, run output, redaction metadata, or schedule execution history.

---

## tRPC settings provider request adapter (deepened - c81)

Local ADE owns project-local capability enablement, provider probing, default
provider-model selection, and clearing the selected default model. The tRPC
transport owns only the typed client request contracts for those provider and
capability procedures.

**Interface shape:**
- `settings-provider-router-data.ts` exports strict request schemas for
  capability state updates, provider probes, provider-model selection, and
  optional clear-provider-model input.
- `settings.ts` registers those schemas and delegates parsed inputs directly to
  the matching `LocalAdeService` methods.
- The clear-provider request accepts omitted input and projects it to `{}` at
  the router call site, preserving the Local ADE method default while keeping
  the transport request object strict when present.

**Why:** locality. The settings router no longer owns any request-schema
details for Local ADE settings procedures. Provider readiness, model
availability, capability persistence, and default-model behavior remain behind
the Local ADE application seam, while transport request changes can be tested
without constructing provider probes or snapshots.

**Anti-patterns:**
- Don't redefine capability/provider request schemas inline in
  `routers/settings.ts`.
- Don't move provider probing, readiness metadata, model availability,
  selected-model persistence, or capability behavior into the tRPC router-data
  adapter.
- Don't allow tRPC capability/provider requests to carry stored/internal fields
  such as provider names, health metadata, capability labels, timestamps, or
  selected-model snapshots.

---

## tRPC settings MCP procedure router (deepened - c82)

The settings tRPC surface keeps Local ADE MCP procedures available at the flat
client interface (`settings.upsertMcpServer`, `settings.invokeMcpTool`, etc.),
but the MCP procedure group no longer lives inside the large `settings.ts`
composition file.

**Interface shape:**
- `settings-mcp-router.ts` is the feature-level composition module for MCP
  procedures. Focused MCP subrouters own server descriptor/probe, manual
  invocation, and remote-control procedures.
- `settings.ts` composes the base settings procedures with
  `settingsMcpRouter` through `t.mergeRouters`, preserving flat
  `settings.*` procedure names for existing clients.
- `settings-router.test.ts` checks that extracted MCP procedures remain flat
  and are not nested under `settings.mcp`.

**Why:** locality. MCP request schemas already had a router-data adapter, but
the procedure dispatch was still embedded in the settings composition module.
Moving the procedure group behind its own router module concentrates MCP
transport wiring in one place and lets future MCP transport changes avoid
editing unrelated checkpoint, hook, plugin, provider, or ACP activity
procedures.

**Anti-patterns:**
- Don't re-add MCP procedures directly to `routers/settings.ts`.
- Don't nest these existing procedures under `settings.mcp` unless the client
  interface is deliberately versioned/migrated.
- Don't add MCP procedure dispatch directly to `settings-mcp-router.ts`; it
  composes focused MCP subrouters.
- Don't move MCP persistence, probe/trust behavior, invocation history, or
  notification parsing into the procedure router; those remain behind Local
  ADE.

---

## tRPC settings provider procedure router (deepened - c83)

The settings tRPC surface keeps Local ADE capability/provider procedures
available at the flat client interface (`settings.updateCapabilityState`,
`settings.testProvider`, etc.), but the provider/capability procedure group no
longer lives inside the large `settings.ts` composition file.

**Interface shape:**
- `settings-provider-router.ts` owns capability state updates, provider
  probes, selected provider-model updates, and selected provider-model clear.
- `settings.ts` composes the base settings procedures with
  `settingsProviderRouter` through `t.mergeRouters`, preserving flat
  `settings.*` procedure names for existing clients.
- `settings-router.test.ts` checks that extracted provider procedures remain
  flat and are not nested under `settings.provider`.

**Why:** locality. Provider/capability request schemas already had a
router-data adapter, but the procedure dispatch still lived in the settings
composition module. Moving the procedure group behind its own router module
keeps provider transport wiring with provider request contracts and lets future
provider readiness or selected-model transport changes avoid editing unrelated
MCP, checkpoint, hook, plugin, Project Memory, or ACP activity procedures.

**Anti-patterns:**
- Don't re-add provider/capability procedures directly to `routers/settings.ts`.
- Don't nest these existing procedures under `settings.provider` unless the
  client interface is deliberately versioned/migrated.
- Don't move provider probing, readiness metadata, model availability,
  selected-model persistence, or capability behavior into the procedure router;
  those remain behind Local ADE.

---

## tRPC settings Project Memory procedure router (deepened - c84)

The settings tRPC surface keeps project-index and Project Memory procedures
available at the flat client interface (`settings.refreshProjectIndex`,
`settings.buildProjectMemoryContext`, etc.), but that procedure group no
longer lives inside the large `settings.ts` composition file.

**Interface shape:**
- `settings-project-memory-router.ts` owns project-index refresh/search,
  Project Memory context building, preset upsert, and preset delete
  procedures.
- `settings.ts` composes the base settings procedures with
  `settingsProjectMemoryRouter` through `t.mergeRouters`, preserving flat
  `settings.*` procedure names for existing clients.
- `settings-router.test.ts` checks that extracted Project Memory procedures
  remain flat and are not nested under `settings.projectMemory`.

**Why:** locality. Project Memory request schemas already had a router-data
adapter, but procedure dispatch still lived in the settings composition module.
Moving the procedure group behind its own router module keeps project-index and
Project Memory transport wiring with their request contracts and lets future
retrieval/filter/preset transport changes avoid editing unrelated MCP,
provider, checkpoint, hook, plugin, or ACP activity procedures.

**Anti-patterns:**
- Don't re-add Project Memory procedures directly to `routers/settings.ts`.
- Don't nest these existing procedures under `settings.projectMemory` unless
  the client interface is deliberately versioned/migrated.
- Don't move indexing, source reading, ranking, redaction, context assembly, or
  preset persistence into the procedure router; those remain behind Local ADE.

---

## tRPC settings ACP activity procedure router (deepened - c85)

The settings tRPC surface keeps ACP activity diagnostics available at the flat
client interface (`settings.exportAcpActivity`, `settings.replayAcpActivity`,
etc.), but that procedure group no longer lives inside the large `settings.ts`
composition file.

**Interface shape:**
- `settings-acp-activity-router.ts` is the feature-level composition module for
  ACP activity procedures. Focused ACP activity subrouters own diagnostics and
  replay preset procedures.
- `settings.ts` composes the base settings procedures with
  `settingsAcpActivityRouter` through `t.mergeRouters`, preserving flat
  `settings.*` procedure names for existing clients.
- `settings-router.test.ts` checks that extracted ACP activity procedures
  remain flat and are not nested under `settings.acpActivity`.

**Why:** locality. ACP activity request schemas already had a router-data
adapter, but procedure dispatch still lived in the settings composition module.
Moving the procedure group behind its own router module keeps diagnostics
transport wiring with its request contracts and lets future replay/filter/preset
transport changes avoid editing unrelated MCP, provider, Project Memory,
checkpoint, hook, or plugin procedures.

**Anti-patterns:**
- Don't re-add ACP activity procedures directly to `routers/settings.ts`.
- Don't nest these existing procedures under `settings.acpActivity` unless the
  client interface is deliberately versioned/migrated.
- Don't add ACP activity procedure dispatch directly to
  `settings-acp-activity-router.ts`; it composes focused ACP activity
  subrouters.
- Don't move trace capture, redaction, replay timeline construction, stream
  diagnostics, or preset persistence into the procedure router; those remain
  behind Local ADE.

---

## tRPC settings checkpoint procedure router (deepened - c86)

The settings tRPC surface keeps Git checkpoint procedures available at the flat
client interface (`settings.createCheckpoint`, `settings.restoreCheckpoint`,
etc.), but that procedure group no longer lives inside the large `settings.ts`
composition file.

**Interface shape:**
- `settings-checkpoint-router.ts` is the feature-level composition module for
  checkpoint procedures. Focused checkpoint subrouters own capture/preview,
  restore, and conflict-resolution procedures.
- `settings.ts` composes the base settings procedures with
  `settingsCheckpointRouter` through `t.mergeRouters`, preserving flat
  `settings.*` procedure names for existing clients.
- `settings-router.test.ts` checks that extracted checkpoint procedures remain
  flat and are not nested under `settings.checkpoint`.

**Why:** locality. Checkpoint request schemas already had a router-data
adapter, but procedure dispatch still lived in the settings composition module.
Moving the procedure group behind its own router module keeps checkpoint
transport wiring with its request contracts and lets future restore/conflict
transport changes avoid editing unrelated MCP, provider, Project Memory, ACP
activity, hook, or plugin procedures.

**Anti-patterns:**
- Don't re-add checkpoint procedures directly to `routers/settings.ts`.
- Don't nest these existing procedures under `settings.checkpoint` unless the
  client interface is deliberately versioned/migrated.
- Don't add checkpoint procedure dispatch directly to
  `settings-checkpoint-router.ts`; it composes focused checkpoint subrouters.
- Don't move restore-token checks, Git patch filtering, safety checkpoint
  creation, conflict shelving, hunk selection, or lifecycle hook dispatch into
  the procedure router; those remain behind Local ADE.

---

## tRPC settings hook procedure router (deepened - c87)

The settings tRPC surface keeps project-local hook procedures available at the
flat client interface (`settings.upsertHook`, `settings.runHookBatch`, etc.),
but that procedure group no longer lives inside the large `settings.ts`
composition file.

**Interface shape:**
- `settings-hook-router.ts` is the feature-level composition module for
  project-local hook procedures. Focused hook subrouters own descriptor,
  lifecycle policy, scheduling policy, trust, manual-run approval, single run,
  batch run, audit review, and audit export procedures.
- `settings.ts` composes the base settings procedures with
  `settingsHookRouter` through `t.mergeRouters`, preserving flat `settings.*`
  procedure names for existing clients.
- `settings-router.test.ts` checks that extracted hook procedures remain flat
  and are not nested under `settings.hook`.

**Why:** locality. Hook request schemas already had a router-data adapter, but
procedure dispatch still lived in the settings composition module. Moving the
procedure group behind its own router module keeps hook transport wiring with
its request contracts and lets future lifecycle/scheduling/audit transport
changes avoid editing unrelated MCP, provider, Project Memory, ACP activity,
checkpoint, or plugin procedures.

**Anti-patterns:**
- Don't re-add hook procedures directly to `routers/settings.ts`.
- Don't nest these existing procedures under `settings.hook` unless the client
  interface is deliberately versioned/migrated.
- Don't add hook procedure dispatch directly to `settings-hook-router.ts`; it
  composes focused hook subrouters.
- Don't move hook command policy, trust fingerprinting, execution scheduling,
  lifecycle dispatch, audit persistence, or export redaction into the procedure
  router; those remain behind Local ADE.

---

## tRPC settings plugin procedure router (deepened - c88)

The settings tRPC surface keeps project-local plugin procedures available at
the flat client interface (`settings.upsertPlugin`,
`settings.runDuePluginBatchSchedules`, etc.), but that large procedure group no
longer lives inside `settings.ts`.

**Interface shape:**
- `settings-plugin-router.ts` is the feature-level composition module for
  project-local plugin procedures. Focused plugin subrouters own descriptor,
  signed package, registry, signer trust, plugin trust, permission grant,
  manual-run approval, run, batch, preset, schedule, due-schedule, audit review,
  and audit export procedures.
- `settings.ts` composes the base settings procedures with
  `settingsPluginRouter` through `t.mergeRouters`, preserving flat
  `settings.*` procedure names for existing clients.
- `settings-router.test.ts` checks that extracted plugin procedures remain
  flat and are not nested under `settings.plugin`.

**Why:** locality. Plugin request schemas already had a router-data adapter,
but the procedure dispatch dominated the settings composition module. Moving
the procedure group behind its own router module keeps plugin transport wiring
with its request contracts and lets future package/registry/trust/batch/audit
transport changes avoid editing boot allowlists, snapshots, MCP, provider,
Project Memory, ACP activity, checkpoint, or hook procedures.

**Anti-patterns:**
- Don't re-add plugin procedures directly to `routers/settings.ts`.
- Don't nest these existing procedures under `settings.plugin` unless the
  client interface is deliberately versioned/migrated.
- Don't add plugin procedure dispatch directly to `settings-plugin-router.ts`;
  it composes focused plugin subrouters.
- Don't move package verification, registry trust, signer revocation,
  permission grants, command normalization, approval checks, process
  execution, batch scheduling, due-schedule dispatch, or audit redaction into
  the procedure router; those remain behind Local ADE.

---

## tRPC settings base procedure router (deepened - c89)

The settings tRPC surface keeps persisted settings, boot allowlists, and the
Local ADE snapshot available at the flat client interface (`settings.get`,
`settings.updateBootAllowlists`, `settings.getLocalAdeSnapshot`), but
`settings.ts` no longer owns any procedure implementations.

**Interface shape:**
- `settings-base-router.ts` owns persisted settings read, boot allowlist read,
  boot allowlist update, and Local ADE snapshot procedures.
- `settings.ts` is now a composition module that only merges
  `settingsBaseRouter` with the feature routers through `t.mergeRouters`.
- `settings-router.test.ts` checks that extracted base settings procedures
  remain flat and are not nested under `settings.base`.

**Why:** locality. The final inline procedures made `settings.ts` a mixed
module: part composition and part transport dispatch. Moving the base
procedures behind their own router module gives `settings.ts` one interface and
one reason to change: preserving the flat settings tRPC surface. Boot allowlist
request contracts, persisted settings reads, and Local ADE snapshot dispatch
now change with the base router rather than the composition module.

**Anti-patterns:**
- Don't add procedure implementations directly to `routers/settings.ts`.
- Don't nest these existing procedures under `settings.base` unless the client
  interface is deliberately versioned/migrated.
- Don't move boot allowlist normalization, runtime hot-apply, persisted
  settings behavior, or Local ADE snapshot construction into the procedure
  router; those remain behind the settings application module.

---

## tRPC settings Local ADE resolver (deepened - c90)

Settings feature routers that delegate to Local ADE share one transport seam
for authenticated user resolution and Local ADE service lookup.

**Interface shape:**
- `settings-local-ade-resolver.ts` exports `resolveSettingsLocalAde(handler)`.
- The handler receives `(service, userId, input)` after the protected tRPC
  procedure has authenticated the request.
- ACP activity, base Local ADE snapshot, checkpoint, hook, MCP, plugin,
  Project Memory, and provider settings routers use this resolver instead of
  repeating
  `ctx.useCases.settings.localAde` and `getRequiredUserId(ctx)` in each
  procedure.

**Why:** locality. The Local ADE settings routers already hide feature
procedure groups behind separate modules, but each module duplicated the same
transport invariant: get the authenticated user id, fetch the Local ADE
application service, then delegate the parsed request. Concentrating that
dispatch pattern gives one place to change if authenticated context handling or
Local ADE service lookup changes, while the feature routers remain focused on
procedure names, schemas, and which application method is called.

**Anti-patterns:**
- Don't repeat `ctx.useCases.settings.localAde` plus `getRequiredUserId(ctx)`
  inside Local ADE settings feature procedures.
- Don't put feature behavior, request normalization, persistence, or Local ADE
  business rules into `settings-local-ade-resolver.ts`; it is only a transport
  dispatch helper.
- Don't use the helper for non-Local-ADE settings procedures such as persisted
  settings reads or boot allowlist updates.

---

## tRPC settings hook/plugin request contract aliases (deepened - c91)

Legacy `settings.*Hook` and `settings.*Plugin` procedures keep their flat
settings client names and Local ADE snapshot return shape, but their request
schemas no longer duplicate the hook/plugin module contracts.

**Interface shape:**
- `settings-local-ade-automation-router-data.ts` imports hook schemas from the
  public `@/modules/hooks` surface and exports legacy request-schema names for
  settings router compatibility.
- `settings-plugin-router-data.ts` imports plugin schemas from the public
  `@/modules/plugins` surface and exports legacy request-schema names for
  settings router compatibility.
- `settings-plugin-router.ts` uses the plugin module scheduling schema alias
  instead of the neutral hook automation scheduling schema.

**Why:** locality. Hook and plugin request invariants now live with the hook
and plugin modules, where their services and dedicated routers already use the
same contracts. The settings transport keeps a compatibility alias layer for
old `settings.*` procedure names, but does not own a second copy of command,
trust, permission, batch, schedule, or audit request shapes.

**Anti-patterns:**
- Don't redefine hook/plugin request schemas inside settings router-data files.
- Don't import hook/plugin contract implementation paths from transport; use
  the module public surfaces.
- Don't change legacy `settings.*Hook` or `settings.*Plugin` return shapes
  while only consolidating request contracts; those procedures still serve the
  Local ADE snapshot UI flow.

---

## tRPC session query procedure router (deepened - c92)

The session tRPC surface keeps read-side and compaction procedures available at
the flat client interface (`session.getSessionState`, `session.getSessions`,
`session.getSessionMessagesPage`, etc.), but those procedures no longer live in
the lifecycle/event-heavy `session.ts` router module.

**Interface shape:**
- `session-query-router.ts` owns session state reads, offset and cursor session
  lists, paginated message reads, message-by-id reads, storage stats, and
  stopped-session message compaction.
- `session.ts` composes focused lifecycle, fork, record, event, and query
  routers through `t.mergeRouters`, preserving flat `session.*` procedure names
  for existing clients.
- `session-router.test.ts` checks that extracted query procedures remain flat
  and are not nested under `session.queries`.

**Why:** locality. `SessionQueries` is the canonical read-side application
module, but the tRPC router still mixed query projection, runtime page limits,
session lifecycle mutations, agent import/resume behavior, fork bindings, and
event subscription setup in one module. Moving read-side tRPC dispatch behind
its own router module keeps query transport wiring with the read model and lets
future pagination/message-history/storage changes avoid editing lifecycle or
event-stream procedures.

**Anti-patterns:**
- Don't re-add SessionQueries procedures directly to `routers/session.ts` or
  the non-query session routers.
- Don't nest these existing procedures under `session.queries` unless the
  client interface is deliberately versioned/migrated.
- Don't move session query behavior, storage compaction, pagination rules, or
  message lookup policy into the tRPC router; those remain behind
  `SessionQueries`.

---

## tRPC plugin registry procedure router (deepened - c93)

Signed plugin registry operations are a separate transport module behind the
existing flat `plugins.*` client interface.

**Interface shape:**
- `plugin-registry-router.ts` owns registry descriptor writes, registry trust
  changes, signer revocation/restoration, registry refresh, and installing a
  package from a saved registry.
- `plugins.ts` composes `pluginBaseRouter` with
  `pluginRegistryRouter` through `t.mergeRouters`, preserving existing
  procedure names such as `plugins.upsertRegistry` and
  `plugins.installRegistryPackage`.
- `plugins-router.test.ts` checks that extracted registry procedures remain
  flat and are not nested under `plugins.registry`.

**Why:** locality. Registry governance has its own invariants: saved registry
descriptors, URL trust fingerprints, signer/public-key fingerprints, pinned
package metadata, and install-from-registry flow. Keeping those procedures in
one router module lets future signed-registry transport changes avoid editing
plugin descriptor, local run, audit, or batch-schedule procedure wiring.

**Anti-patterns:**
- Don't add signed plugin registry procedures back to `routers/plugins.ts`.
- Don't nest the existing registry procedures under `plugins.registry` unless
  the client interface is deliberately versioned/migrated.
- Don't duplicate registry trust, signer, refresh, or package-install request
  schemas in transport; use the public plugin module contracts.

---

## tRPC plugin batch procedure router (deepened - c94)

Plugin batch automation procedures are a separate transport module behind the
existing flat `plugins.*` client interface.

**Interface shape:**
- `plugin-batch-router.ts` owns confirmed batch execution, batch preset
  create/delete/run, batch schedule create/delete, and due-schedule dispatch.
- `plugins.ts` composes `pluginBaseRouter` with `pluginBatchRouter` and
  `pluginRegistryRouter` through `t.mergeRouters`, preserving existing
  procedure names such as `plugins.runBatch` and
  `plugins.runDueBatchSchedules`.
- `plugins-router.test.ts` checks that extracted batch procedures remain flat
  and are not nested under `plugins.batch`.

**Why:** locality. Batch automation has a different interface than a single
plugin descriptor or manual run: ordered plugin ids, operation fingerprint
maps, reusable presets, persisted schedules, due-run filtering, and failure
mode policy. Keeping those procedures in one router module lets future batch
automation transport changes avoid editing package install, registry
governance, single-plugin trust, permission, or audit procedure wiring.

**Anti-patterns:**
- Don't add plugin batch preset/schedule/due-run procedures back to
  `routers/plugins.ts`.
- Don't nest the existing batch procedures under `plugins.batch` unless the
  client interface is deliberately versioned/migrated.
- Don't duplicate batch request schemas in transport; use the public plugin
  module contracts.

---

## tRPC plugin run/audit procedure router (deepened - c95)

Manual plugin execution and audit procedures are a separate transport module
behind the existing flat `plugins.*` client interface.

**Interface shape:**
- `plugin-run-router.ts` owns execution scheduling policy updates, plugin
  command trust, permission grants, one-shot run approval, manual run, audit
  review, and audit export.
- `plugins.ts` composes `pluginBaseRouter`, `pluginBatchRouter`,
  `pluginRegistryRouter`, and `pluginRunRouter` through `t.mergeRouters`,
  preserving existing procedure names such as `plugins.run`,
  `plugins.approveRun`, and `plugins.exportRuns`.
- `plugins-router.test.ts` checks that extracted run/audit procedures remain
  flat and are not nested under `plugins.runAudit`.

**Why:** locality. Manual execution has a different interface than plugin
descriptor/package metadata: command fingerprints, permission fingerprints,
operation approval ids, confirmation tokens, scheduling limits, and redacted
audit export filters. Keeping those procedures in one router module lets future
run/audit transport changes avoid editing plugin descriptor, package install,
registry governance, or batch automation procedure wiring.

**Anti-patterns:**
- Don't add manual run, one-shot approval, trust, permission, review, or audit
  export procedures back to `routers/plugins.ts`.
- Don't nest the existing run/audit procedures under `plugins.runAudit` unless
  the client interface is deliberately versioned/migrated.
- Don't duplicate run/audit request schemas in transport; use the public plugin
  module contracts.

---

## tRPC plugin base procedure router (deepened - c96)

The root plugin transport module is composition-only. Plugin descriptor,
package install/revalidation, SDK manifest, and enable/disable procedures live
behind their own base router while preserving the existing flat `plugins.*`
client interface.

**Interface shape:**
- `plugin-base-router.ts` owns plugin overview, SDK manifest, descriptor
  upsert, package install, package revalidation, and toggle procedures.
- `plugins.ts` only composes `pluginBaseRouter`, `pluginBatchRouter`,
  `pluginRegistryRouter`, and `pluginRunRouter` through `t.mergeRouters`.
- `plugins-router.test.ts` checks that extracted base procedures remain flat
  and are not nested under `plugins.base`.

**Why:** locality. The composition module should not also know descriptor,
package, and toggle request schemas. Keeping base procedures in one router
module lets future plugin descriptor/package transport changes avoid editing the
composition seam or the registry, batch, and run/audit router modules.

**Anti-patterns:**
- Don't add plugin descriptor/package/toggle procedures back to
  `routers/plugins.ts`.
- Don't nest the existing base procedures under `plugins.base` unless the
  client interface is deliberately versioned/migrated.
- Don't duplicate base plugin request schemas in transport; use the public
  plugin module contracts.

---

## tRPC settings plugin focused procedure routers (deepened - c97)

The settings plugin feature router is composition-only. Project-local plugin
descriptor/package, signed registry, manual run/audit, and batch automation
procedures live behind focused settings plugin routers while preserving the
existing flat `settings.*Plugin*` client interface.

**Interface shape:**
- `settings-plugin-base-router.ts` owns plugin descriptor upsert, signed package
  install/revalidation, and toggle procedures.
- `settings-plugin-registry-router.ts` owns saved registry descriptors, registry
  trust, signer revocation/restoration, registry refresh, and install from
  registry.
- `settings-plugin-run-router.ts` owns scheduling policy, command trust,
  permission grants, one-shot approval, manual run, audit review, and audit
  export procedures.
- `settings-plugin-batch-router.ts` owns confirmed batch execution, batch
  preset create/delete/run, batch schedule create/delete, and due-schedule
  dispatch.
- `settings-plugin-router.ts` composes those four routers through
  `t.mergeRouters`; `settings-router.test.ts` checks the extracted procedures
  stay flat and are not nested under `settings.pluginBase`,
  `settings.pluginRegistry`, `settings.pluginRun`, or `settings.pluginBatch`.

**Why:** locality. The project-local plugin settings surface mirrors the
dedicated plugin transport surface, but previously kept all procedure dispatch
in one module. Splitting by descriptor/package, registry governance, run/audit,
and batch automation lets future request/transport changes land in the focused
module instead of reopening the whole Local ADE plugin transport surface.

**Anti-patterns:**
- Don't add project-local plugin procedure dispatch back to
  `settings-plugin-router.ts`.
- Don't nest the existing settings plugin procedures under group names unless
  the client interface is deliberately versioned/migrated.
- Don't duplicate plugin request schemas in focused settings plugin routers;
  use the compatibility aliases from `settings-plugin-router-data.ts`.
- Don't move package verification, registry trust, command trust, permission
  grants, process execution, scheduling, or audit redaction into these routers;
  those remain behind Local ADE.

---

## tRPC settings hook focused procedure routers (deepened - c98)

The settings hook feature router is composition-only. Project-local hook
descriptor/governance, manual run/audit, and batch execution procedures live
behind focused settings hook routers while preserving the existing flat
`settings.*Hook*` client interface.

**Interface shape:**
- `settings-hook-base-router.ts` owns hook descriptor upsert/toggle, lifecycle
  policy, and scheduling policy procedures.
- `settings-hook-run-router.ts` owns command trust, one-shot approval, manual
  run, audit review, and audit export procedures.
- `settings-hook-batch-router.ts` owns guarded hook batch execution.
- `settings-hook-router.ts` composes those three routers through
  `t.mergeRouters`; `settings-router.test.ts` checks the extracted procedures
  stay flat and are not nested under `settings.hookBase`, `settings.hookRun`,
  or `settings.hookBatch`.

**Why:** locality. Hook transport changes usually land in one of three groups:
descriptor/governance, manual run/audit, or batch execution. Splitting those
groups keeps request-schema compatibility in the existing router-data adapter
while letting future transport changes avoid reopening the whole Local ADE hook
surface.

**Anti-patterns:**
- Don't add project-local hook procedure dispatch back to
  `settings-hook-router.ts`.
- Don't nest the existing settings hook procedures under group names unless the
  client interface is deliberately versioned/migrated.
- Don't duplicate hook request schemas in focused settings hook routers; use the
  compatibility aliases from `settings-local-ade-automation-router-data.ts`.
- Don't move command trust, execution scheduling, lifecycle dispatch, audit
  persistence, or export redaction into these routers; those remain behind
  Local ADE.

---

## tRPC settings checkpoint focused procedure routers (deepened - c99)

The settings checkpoint feature router is composition-only. Checkpoint
capture/preview, restore, and conflict-resolution procedures live behind
focused settings checkpoint routers while preserving the existing flat
`settings.*Checkpoint*` client interface.

**Interface shape:**
- `settings-checkpoint-base-router.ts` owns checkpoint capture and patch preview.
- `settings-checkpoint-restore-router.ts` owns full checkpoint restore,
  selected-file restore, and selected-hunk restore.
- `settings-checkpoint-conflict-router.ts` owns untracked conflict shelving and
  tracked conflict resolution by reset, explicit choice, or selected hunks.
- `settings-checkpoint-router.ts` composes those three routers through
  `t.mergeRouters`; `settings-router.test.ts` checks the extracted procedures
  stay flat and are not nested under `settings.checkpointBase`,
  `settings.checkpointRestore`, or `settings.checkpointConflict`.

**Why:** locality. Checkpoint transport changes usually land in one of three
groups: capture/preview, restore shape, or conflict resolution. Splitting those
groups keeps request-schema compatibility in the existing router-data adapter
while letting future restore/conflict transport changes avoid reopening the
whole Local ADE checkpoint surface.

**Anti-patterns:**
- Don't add checkpoint procedure dispatch back to
  `settings-checkpoint-router.ts`.
- Don't nest the existing settings checkpoint procedures under group names
  unless the client interface is deliberately versioned/migrated.
- Don't duplicate checkpoint request schemas in focused settings checkpoint
  routers; use the compatibility aliases from
  `settings-checkpoint-router-data.ts`.
- Don't move restore-token checks, Git patch filtering, safety checkpoint
  creation, conflict shelving, hunk selection, or lifecycle hook dispatch into
  these routers; those remain behind Local ADE.

---

## tRPC settings MCP focused procedure routers (deepened - c100)

The settings MCP feature router is composition-only. MCP server descriptor,
manual invocation, and remote-control procedures live behind focused settings
MCP routers while preserving the existing flat `settings.*Mcp*` client
interface.

**Interface shape:**
- `settings-mcp-server-router.ts` owns project-local server
  upsert/toggle/trust/probe procedures.
- `settings-mcp-invocation-router.ts` owns manual tool invocation and resource
  read procedures.
- `settings-mcp-remote-control-router.ts` owns notification watch and remote
  operational-control procedures.
- `settings-mcp-router.ts` composes those three routers through
  `t.mergeRouters`; `settings-router.test.ts` checks the extracted procedures
  stay flat and are not nested under `settings.mcpServer`,
  `settings.mcpInvocation`, or `settings.mcpRemoteControl`.

**Why:** locality. MCP transport changes usually land in one of three groups:
descriptor/probe/trust, manual invocation shape, or remote stream controls.
Splitting those groups keeps request-schema compatibility in the existing
router-data adapter while letting future invocation/control transport changes
avoid reopening the whole Local ADE MCP surface.

**Anti-patterns:**
- Don't add MCP procedure dispatch back to `settings-mcp-router.ts`.
- Don't nest the existing settings MCP procedures under group names unless the
  client interface is deliberately versioned/migrated.
- Don't duplicate MCP request schemas in focused settings MCP routers; use the
  schemas from `settings-mcp-router-data.ts`.
- Don't move MCP persistence, secret-header rejection, fingerprint trust,
  protocol invocation, probe history, notification parsing, or broker/audit
  behavior into these routers; those remain behind Local ADE.

---

## tRPC settings ACP activity focused procedure routers (deepened - c101)

The settings ACP activity feature router is composition-only. Activity
diagnostics/replay and replay-preset procedures live behind focused settings ACP
activity routers while preserving the existing flat `settings.*Acp*` and
`settings.*AcpReplayPreset` client interface.

**Interface shape:**
- `settings-acp-activity-diagnostics-router.ts` owns redacted activity export,
  stream retry diagnostics, and chronological replay procedures.
- `settings-acp-activity-preset-router.ts` owns replay preset save/delete
  procedures.
- `settings-acp-activity-router.ts` composes those two routers through
  `t.mergeRouters`; `settings-router.test.ts` checks the extracted procedures
  stay flat and are not nested under `settings.acpActivityDiagnostics` or
  `settings.acpActivityPreset`.

**Why:** locality. ACP activity transport changes usually land in one of two
groups: diagnostic/replay filters or preset persistence. Splitting those groups
keeps request-schema compatibility in the existing router-data adapter while
letting future preset transport changes avoid reopening the diagnostic replay
surface.

**Anti-patterns:**
- Don't add ACP activity procedure dispatch back to
  `settings-acp-activity-router.ts`.
- Don't nest the existing settings ACP activity procedures under group names
  unless the client interface is deliberately versioned/migrated.
- Don't duplicate ACP activity request schemas in focused settings ACP activity
  routers; use the schemas from `settings-acp-activity-router-data.ts`.
- Don't move trace capture, metadata redaction, replay frame ordering,
  correlation/timeline derivation, stream diagnostics, or preset persistence
  into these routers; those remain behind Local ADE.

---

## tRPC hooks focused procedure routers (deepened - c102)

The top-level hooks tRPC router is composition-only. Hook descriptor/policy,
run/audit, and batch execution procedures live behind focused hooks routers
while preserving the existing nested `hooks.*` client interface.

**Interface shape:**
- `hooks-base-router.ts` owns list/upsert/toggle plus lifecycle and scheduling
  policy updates.
- `hooks-run-router.ts` owns trust, approval, manual run, run review, and run
  export procedures.
- `hooks-batch-router.ts` owns batch execution.
- `hooks.ts` composes those three routers through `t.mergeRouters`; the router
  test checks procedures stay flat under `hooks.*` and are not nested under
  `hooks.base`, `hooks.hookRun`, or `hooks.batch`.

**Why:** locality. Hook transport changes usually land in one of three groups:
descriptor/policy shape, run/audit control flow, or batch execution. Splitting
those groups keeps the top-level hook client interface stable while letting
future run or batch transport changes avoid reopening descriptor/policy
procedures.

**Anti-patterns:**
- Don't add hook procedure dispatch back to `hooks.ts`.
- Don't nest the existing top-level hooks procedures under group names unless
  the client interface is deliberately versioned/migrated.
- Don't move trust fingerprint checks, run-operation approval, lifecycle
  governance, scheduling gates, process isolation, redaction, or run history
  persistence into these routers; those remain behind the Hooks application
  Interface and its Local ADE adapter.

---

## tRPC AI focused procedure routers (deepened - c103)

The top-level AI tRPC router is composition-only. Prompt message, runtime
configuration, and supervisor autopilot procedures live behind focused AI
routers while preserving the existing flat top-level client interface
(`sendMessage`, `setModel`, `setSupervisorMode`, etc.).

**Interface shape:**
- `ai-message-router.ts` owns prompt send and prompt cancellation procedures.
- `ai-config-router.ts` owns active model, active mode, and session config
  option mutation procedures.
- `ai-supervisor-router.ts` owns supervisor autopilot mode updates.
- `ai.ts` composes those three routers through `t.mergeRouters`; the router test
  checks procedures stay flat and are not nested under `ai.message`,
  `ai.config`, or `ai.supervisor`.

**Why:** locality. AI transport changes usually land in one of three groups:
prompt lifecycle, runtime configuration shape, or supervisor control. Splitting
those groups keeps the legacy top-level client interface stable while letting
future config-response or supervisor transport changes avoid reopening prompt
send/cancel procedures.

**Anti-patterns:**
- Don't add AI procedure dispatch back to `ai.ts`.
- Don't nest the existing top-level AI procedures under group names unless the
  client interface is deliberately versioned/migrated.
- Don't move prompt persistence, runtime agent communication, config mutation
  rules, supervisor scheduling, or session-state ownership into these routers;
  those remain behind their application Interfaces.

---

## tRPC terminal focused procedure routers (deepened - c104)

The top-level terminal tRPC router is composition-only. Terminal settings,
runtime I/O, and event stream procedures live behind focused terminal routers
while preserving the existing flat top-level client interface (`getSettings`,
`create`, `write`, `onTerminalEvents`, etc.).

**Interface shape:**
- `terminal-settings-router.ts` owns terminal settings read and update
  procedures.
- `terminal-runtime-router.ts` owns terminal list, create, write, resize, and
  kill procedures.
- `terminal-events-router.ts` owns terminal event subscription input/auth wiring
  and delegates observable creation to `terminal-events-observable.ts`.
- `terminal.ts` composes those three routers through `t.mergeRouters`; the
  router test checks procedures stay flat and are not nested under
  `terminal.settings`, `terminal.runtime`, or `terminal.events`.

**Why:** locality. Terminal transport changes usually land in one of three
groups: settings shape, runtime command I/O, or event subscription wiring.
Splitting those groups keeps the legacy top-level client interface stable while
letting future event stream or runtime input changes avoid reopening unrelated
terminal procedures.

**Anti-patterns:**
- Don't add terminal procedure dispatch back to `terminal.ts`.
- Don't nest the existing top-level terminal procedures under group names unless
  the client interface is deliberately versioned/migrated.
- Don't move terminal settings rules, cwd/project validation, process runtime
  ownership, or event production into these routers; those remain behind the
  Terminal application Interface and runtime adapters.

---

## tRPC remote-control focused procedure routers (deepened - c105)

The nested `remoteControl` tRPC router is composition-only. Remote-control
status reads, relay-device lifecycle, and remote session lifecycle procedures
live behind focused remote-control routers while preserving the existing flat
client interface under `remoteControl.*`.

**Interface shape:**
- `remote-control-status-router.ts` owns the remote-control status read
  procedure.
- `remote-control-device-router.ts` owns relay-device upsert/delete and
  heartbeat procedures.
- `remote-control-session-router.ts` owns remote session start and stop
  procedures.
- `remote-control.ts` composes those three routers through `t.mergeRouters`;
  the router test checks procedures stay flat and are not nested under
  `remoteControl.status`, `remoteControl.devices`, or
  `remoteControl.sessions`.

**Why:** locality. Remote-control transport changes usually land in one of
three groups: dashboard status projection, relay device lifecycle inputs, or
remote session lifecycle inputs. Splitting those groups keeps the client
interface stable while letting future device or session wiring changes avoid
reopening unrelated procedures.

**Anti-patterns:**
- Don't add remote-control procedure dispatch back to `remote-control.ts`.
- Don't nest the existing remote-control procedures under group names unless
  the client interface is deliberately versioned/migrated.
- Don't move tenant filtering, liveness computation, heartbeat policy, TTL
  defaults, or session transition rules into these routers; those remain behind
  the Remote-control application Interface.

---

## tRPC session focused procedure routers (deepened - c106)

The top-level session tRPC router is composition-only. Session lifecycle,
forking, stored-record mutation, event subscription, and query procedures live
behind focused session routers while preserving the existing flat top-level
client interface (`createSession`, `resumeSession`, `forkSession`,
`getSessionState`, `onSessionEvents`, etc.).

**Interface shape:**
- `session-lifecycle-router.ts` owns create, discover, load, stop, and resume
  procedures, including start/resume response projection adapters.
- `session-fork-router.ts` owns fork creation and fork-binding listing
  procedures.
- `session-record-router.ts` owns stored session delete and metadata update
  procedures.
- `session-events-router.ts` owns event subscription input/auth wiring and
  delegates observable lifecycle to `session-events-observable.ts`.
- `session-query-router.ts` continues to own the read-side and compaction
  procedures.
- `session.ts` composes those routers through `t.mergeRouters`; the router test
  checks procedures stay flat and are not nested under `session.lifecycle`,
  `session.fork`, `session.record`, `session.events`, or `session.queries`.

**Why:** locality. Session transport changes usually land in one of five
groups: agent session lifecycle, local-history fork behavior, stored record
mutation, event stream wiring, or query/read-model projection. Splitting those
groups keeps the client interface stable while letting future resume response,
fork-binding, metadata, or event-stream changes avoid reopening unrelated
session procedures.

**Anti-patterns:**
- Don't add session procedure dispatch back to `session.ts`.
- Don't nest the existing top-level session procedures under group names unless
  the client interface is deliberately versioned/migrated.
- Don't move session lifecycle orchestration, fork behavior, metadata rules,
  query behavior, or event subscription preparation into these routers; those
  remain behind their application Interfaces and transport adapters.

---

## tRPC code focused procedure routers (deepened - c107)

The top-level code tRPC router is composition-only. Code context reads and
editor-buffer synchronization live behind focused code routers while preserving
the existing flat top-level client interface (`getProjectContext`, `getGitDiff`,
`getFileContent`, `syncEditorBuffer`).

**Interface shape:**
- `code-context-router.ts` owns project context, git diff, and file content
  read procedures.
- `code-editor-buffer-router.ts` owns unsaved editor-buffer synchronization for
  ACP file-read overrides.
- `code.ts` composes those routers through `t.mergeRouters`; the router test
  checks procedures stay flat and are not nested under `code.context` or
  `code.editorBuffer`.

**Why:** locality. Code context reads change with project scan, git diff, and
file content presentation. Editor-buffer sync changes with dirty-buffer
contract and ACP read override behavior. Splitting those groups keeps the
client interface stable while letting future editor-buffer changes avoid
reopening read-only code context procedures.

**Anti-patterns:**
- Don't add code procedure dispatch back to `code.ts`.
- Don't nest the existing top-level code procedures under group names unless
  the client interface is deliberately versioned/migrated.
- Don't move project context resolution, git/file reads, editor-buffer storage,
  or dirty-buffer precedence into these routers; those remain behind the
  tooling application Interface.

---

## tRPC agents focused procedure routers (deepened - c108)

The nested `agents` tRPC router is composition-only. Agent reads,
configuration mutations, and active-agent state changes live behind focused
agents routers while preserving the existing flat `agents.*` client Interface
(`agents.list`, `agents.create`, `agents.update`, `agents.delete`,
`agents.setActive`).

**Interface shape:**
- `agents-query-router.ts` owns agent list reads and project filtering input.
- `agents-mutation-router.ts` owns create/update/delete procedure dispatch.
- `agents-active-router.ts` owns active-agent selection procedure dispatch.
- `agents.ts` composes those routers through `t.mergeRouters`; the router test
  checks procedures stay flat and are not nested under `agents.query`,
  `agents.mutation`, or `agents.active`.

**Why:** locality. Agent read-model filtering, configuration mutation, and
active-state selection change for different reasons. Splitting those procedure
groups keeps the caller Interface stable while giving future agent lifecycle or
active-state work a smaller Module to inspect and verify.

**Anti-patterns:**
- Don't add agent procedure dispatch back to `agents.ts`.
- Don't nest the existing `agents.*` procedures under group names unless the
  client Interface is deliberately versioned/migrated.
- Don't move agent ownership checks, active-state repair, lifecycle
  notifications, or repository transaction policy into these routers; those
  remain behind the agent application Interface and repository Adapter.

---

## tRPC project focused procedure routers (deepened - c109)

The top-level project tRPC router is composition-only. Project list reads,
project lifecycle mutations, and active-project state changes live behind
focused project routers while preserving the existing flat top-level client
Interface (`listProjects`, `createProject`, `updateProject`, `deleteProject`,
`setActiveProject`).

**Interface shape:**
- `project-query-router.ts` owns project list reads.
- `project-mutation-router.ts` owns create/update/delete procedure dispatch.
- `project-active-router.ts` owns active-project selection procedure dispatch.
- `project.ts` composes those routers through `t.mergeRouters`; the router test
  checks procedures stay flat and are not nested under `project.query`,
  `project.mutation`, or `project.active`.

**Why:** locality. Project list active-state projection, lifecycle mutation, and
active-project selection are separate product seams already owned by the
project application module. Splitting the tRPC procedure groups mirrors those
seams without changing the caller Interface, increasing leverage for focused
router tests and future active-state work.

**Anti-patterns:**
- Don't add project procedure dispatch back to `project.ts`.
- Don't nest the existing top-level project procedures under group names unless
  the client Interface is deliberately versioned/migrated.
- Don't move project lifecycle notifications, active-state repair, deletion
  ordering, or repository transaction policy into these routers; those remain
  behind the project application Interface and repository Adapter.

---

## tRPC commands focused procedure routers (deepened - c110)

The nested `commands` tRPC router is composition-only. Slash-command reads,
custom command mutations, and command enabled-state changes live behind focused
commands routers while preserving the existing flat `commands.*` client
Interface (`commands.list`, `commands.create`, `commands.update`,
`commands.setEnabled`, `commands.delete`).

**Interface shape:**
- `commands-query-router.ts` owns slash-command registry reads.
- `commands-mutation-router.ts` owns custom command create/update/delete
  dispatch.
- `commands-state-router.ts` owns enabled-state toggle dispatch.
- `commands.ts` composes those routers through `t.mergeRouters`; the router test
  checks procedures stay flat and are not nested under `commands.query`,
  `commands.mutation`, or `commands.state`.

**Why:** locality. Slash-command registry reads, custom command materialization,
and enabled-state changes evolve for different reasons. Splitting the transport
procedure groups keeps the caller Interface stable while future command
lifecycle work can inspect a smaller Module.

**Anti-patterns:**
- Don't add command procedure dispatch back to `commands.ts`.
- Don't nest the existing `commands.*` procedures under group names unless the
  client Interface is deliberately versioned/migrated.
- Don't move command name normalization, duplicate checks, command
  materialization, or repository persistence policy into these routers; those
  remain behind the commands application Interface and repository Adapter.

---

## tRPC model-provider focused procedure routers (deepened - c111)

The nested `modelProvider` tRPC router is composition-only. Model-provider
reads, provider mutations, and default-provider restore behavior live behind
focused model-provider routers while preserving the existing flat
`modelProvider.*` client Interface (`modelProvider.list`, `modelProvider.get`,
`modelProvider.upsert`, `modelProvider.delete`,
`modelProvider.restoreDefaults`).

**Interface shape:**
- `model-provider-query-router.ts` owns provider list/get reads.
- `model-provider-mutation-router.ts` owns upsert/delete dispatch.
- `model-provider-defaults-router.ts` owns default-provider restore dispatch.
- `model-provider.ts` composes those routers through `t.mergeRouters`; the
  router test checks procedures stay flat and are not nested under
  `modelProvider.query`, `modelProvider.mutation`, or `modelProvider.defaults`.

**Why:** locality. Provider catalogue reads, user provider mutations, and
restore-defaults behavior change along separate seams. Splitting the transport
procedure groups keeps the caller Interface stable while preserving leverage
from the model-provider application Module as the single place for provider
rules.

**Anti-patterns:**
- Don't add model-provider procedure dispatch back to `model-provider.ts`.
- Don't nest the existing `modelProvider.*` procedures under group names unless
  the client Interface is deliberately versioned/migrated.
- Don't move provider validation, secret handling, default catalogue policy, or
  repository persistence policy into these routers; those remain behind the
  model-provider application Interface and repository Adapter.

---

## tRPC git focused procedure routers (deepened - c112)

The nested `git` tRPC router is composition-only. Git repository read
procedures and checkpoint lifecycle procedures live behind focused git routers
while preserving the existing client Interface: `git.summary`, `git.changes`,
and the nested checkpoint namespace `git.checkpoints.list`,
`git.checkpoints.create`, `git.checkpoints.restore`.

**Interface shape:**
- `git-repository-router.ts` owns repository summary and changed-file reads.
- `git-checkpoints-router.ts` owns the existing `checkpoints` namespace and
  checkpoint list/create/restore procedure dispatch.
- `git.ts` composes those routers through `t.mergeRouters`; the router test
  checks repository procedures stay flat and checkpoint procedures remain under
  `git.checkpoints.*`, not under new `git.repository` or `git.gitCheckpoints`
  group names.

**Why:** locality. Git repository status reads and checkpoint lifecycle behavior
change for different reasons. Splitting the transport procedure groups mirrors
the existing application seams (`GitService` vs `GitCheckpointService`) while
keeping the caller Interface stable and preserving leverage from the Git
application Module as the single place for active-project resolution and
checkpoint rules.

**Anti-patterns:**
- Don't add Git procedure dispatch back to `git.ts`.
- Don't move `summary`/`changes` under `git.repository` unless the client
  Interface is deliberately versioned/migrated.
- Don't flatten or rename the existing `git.checkpoints.*` namespace unless the
  client Interface is deliberately versioned/migrated.
- Don't move active-project resolution, Git status collection, restore safety,
  or checkpoint persistence policy into these routers; those remain behind the
  Git application Interface and platform/repository Adapters.

---

## tRPC memory focused procedure routers (deepened - c113)

The nested `memory` tRPC router is composition-only. Memory registry reads,
source enablement, preset lifecycle, and context building live behind focused
memory routers while preserving the existing flat `memory.*` client Interface
(`memory.list`, `memory.setSourceEnabled`, `memory.upsertPreset`,
`memory.deletePreset`, `memory.buildContext`).

**Interface shape:**
- `memory-query-router.ts` owns memory registry list reads.
- `memory-source-router.ts` owns source enabled-state procedure dispatch.
- `memory-preset-router.ts` owns preset upsert/delete dispatch.
- `memory-context-router.ts` owns context-building procedure dispatch.
- `memory.ts` composes those routers through `t.mergeRouters`; the router test
  checks procedures stay flat and are not nested under `memory.query`,
  `memory.source`, `memory.preset`, or `memory.context`.

**Why:** locality. Memory source toggles, preset persistence, and prompt-context
assembly change for different reasons. Splitting the transport procedure groups
keeps the caller Interface stable while future source, preset, or retrieval
changes can inspect a smaller Module and still lean on the memory application
Interface for the underlying rules.

**Anti-patterns:**
- Don't add memory procedure dispatch back to `memory.ts`.
- Don't nest the existing `memory.*` procedures under group names unless the
  client Interface is deliberately versioned/migrated.
- Don't move source reading, semantic ranking, context assembly, preset
  normalization, or persistence policy into these routers; those remain behind
  the memory application Interface and Local ADE Adapter.

---

## tRPC repo-snapshot indexing focused procedure routers (deepened - c114)

The nested `repoSnapshotIndexing` tRPC router is composition-only. Repository
snapshot overview/search reads, settings updates, and refresh triggers live
behind focused repo-snapshot indexing routers while preserving the existing flat
`repoSnapshotIndexing.*` client Interface (`getOverview`, `search`,
`updateSettings`, `refresh`).

**Interface shape:**
- `repo-snapshot-indexing-query-router.ts` owns overview and search reads.
- `repo-snapshot-indexing-settings-router.ts` owns settings update dispatch.
- `repo-snapshot-indexing-refresh-router.ts` owns manual refresh dispatch.
- `repo-snapshot-indexing.ts` composes those routers through `t.mergeRouters`;
  the router test checks procedures stay flat and are not nested under
  `repoSnapshotIndexing.query`, `repoSnapshotIndexing.settings`, or
  `repoSnapshotIndexing.refresh`.

**Why:** locality. Snapshot overview/search reads, settings mutation, and
refresh execution change for different reasons. Splitting the transport
procedure groups keeps the caller Interface stable while preserving leverage
from `RepoSnapshotIndexingService` as the single Module for defaults, refresh
gating, project resolution, manifest retention, and index querying rules.

**Anti-patterns:**
- Don't add repo-snapshot indexing procedure dispatch back to
  `repo-snapshot-indexing.ts`.
- Don't nest the existing `repoSnapshotIndexing.*` procedures under group names
  unless the client Interface is deliberately versioned/migrated.
- Don't move default settings, refresh gating, project context resolution,
  manifest retention, search ranking, or persistence policy into these routers;
  those remain behind the repo-snapshot indexing application Interface and
  repository/index Adapters.

---

## tRPC task auto-archive focused procedure routers (deepened - c115)

The nested `taskAutoArchive` tRPC router is composition-only. Status reads,
settings updates, and manual archive runs live behind focused task auto-archive
routers while preserving the existing flat `taskAutoArchive.*` client Interface
(`getStatus`, `updateSettings`, `runNow`).

**Interface shape:**
- `task-auto-archive-status-router.ts` owns status read dispatch.
- `task-auto-archive-settings-router.ts` owns settings update dispatch.
- `task-auto-archive-run-router.ts` owns manual run dispatch.
- `task-auto-archive.ts` composes those routers through `t.mergeRouters`; the
  router test checks procedures stay flat and are not nested under
  `taskAutoArchive.status`, `taskAutoArchive.settings`, or
  `taskAutoArchive.run`.

**Why:** locality. Status reads, settings mutation, and archive execution
change for different reasons. Splitting the transport procedure groups keeps
the caller Interface stable while preserving leverage from
`TaskAutoArchiveService` as the single Module for default disabled settings,
user-configured updates, archive eligibility, dry-run behavior, result
accounting, diagnostics, and last-run stamping.

**Anti-patterns:**
- Don't add task auto-archive procedure dispatch back to
  `task-auto-archive.ts`.
- Don't nest the existing `taskAutoArchive.*` procedures under group names
  unless the client Interface is deliberately versioned/migrated.
- Don't move default settings, archive eligibility, run counters, diagnostics,
  or last-run stamping into these routers; those remain behind the task
  auto-archive application Interface and persistence/session Adapters.

---

## Dashboard session aggregation read model (deepened - c48)

The ops module owns dashboard read models for project/session/stats views.
Session-store scans for dashboard counters now sit behind one aggregation
interface instead of being duplicated across project-list and stats use-cases.

**Interface shape:**
- `DashboardSessionAggregationService.execute({ userId, projects })` performs a
  paged session scan and returns global counters, agent stats, and
  `statsByProjectId`.
- `ListDashboardProjectsService` reads projects, calls the aggregation
  interface, and only maps project rows to dashboard project JSON.
- `GetDashboardStatsService` reads projects, calls the same aggregation
  interface, and only maps aggregate counters to dashboard stats JSON.
- Project association remains `session.projectId` first, project-root path
  fallback second; `DashboardProjectContext` owns that resolution rule and the
  aggregation read model does not backfill session metadata.

**Why:** locality. Dashboard counter rules such as recent/weekly windows,
running counts, agent name fallback, paged session iteration, and project-root
fallback change together. They now have one test surface instead of being
re-implemented by each dashboard read use-case.

**Anti-patterns:**
- Don't reintroduce independent `forEachSessionPage` aggregation loops in
  dashboard project-list or stats use-cases.
- Don't move dashboard presentation mapping into the aggregation service; it
  returns counters, not route JSON.
- Don't mutate session/project metadata from dashboard aggregation reads.

---

## Dashboard overview read model (deepened - c49)

The ops module exposes separate dashboard endpoints for projects, stats, and
initial page data, but project rows plus session aggregation form one dashboard
overview read model. Initial page data must not call the project and stats
use-cases separately because that duplicates project reads and session scans.

**Interface shape:**
- `GetDashboardOverviewService.execute(userId)` reads projects once, calls
  `DashboardSessionAggregationService` once, and returns both dashboard project
  summaries and dashboard stats.
- `ListDashboardProjectsService` and `GetDashboardStatsService` are endpoint
  shape adapters over the overview read model.
- `GetDashboardPageDataService` calls the overview read model directly and
  reuses its project context for initial page session-list enrichment.

**Why:** leverage. Project count, project session counts, recent/weekly windows,
agent stats, and server uptime are one overview projection. The overview seam
keeps those rules in one test surface and prevents initial dashboard rendering
from rebuilding the same counters through multiple use-cases.

**Anti-patterns:**
- Don't have `GetDashboardPageDataService` call both
  `ListDashboardProjectsService` and `GetDashboardStatsService`.
- Don't duplicate project-to-session-count or stats mapping outside
  `GetDashboardOverviewService`.
- Don't move paged session-list presentation into the overview read model; the
  overview owns counters, not the dashboard sessions table.

---

## Dashboard page project-context reuse (deepened - c50)

Initial dashboard page data composes overview, sessions, and agents, but the
paged session-list projection should not force a second project repository read
when page data already loaded dashboard project context.

**Interface shape:**
- `ListDashboardSessionsService.execute(input)` accepts optional
  `projects: DashboardSessionProjectContext[]`.
- When projects are provided, session-list enrichment uses that context for
  `projectName` lookup and skips `projectRepo.findAll(userId)`.
- When projects are omitted, standalone dashboard sessions endpoint behavior is
  unchanged: the service reads projects internally before enriching sessions.
- `GetDashboardPageDataService` gets overview and agents, then passes
  `overview.projects` into `ListDashboardSessionsService`.

**Why:** locality. Dashboard page composition owns the fact that overview
project context is already available. Session-list still owns paged session
presentation, active runtime overlay, agent-name fallback, basename fallback,
and pagination shape, while callers avoid reconstructing or duplicating project
lookups.

**Anti-patterns:**
- Don't make initial page data read projects through both overview and
  session-list.
- Don't move session table pagination or runtime enrichment into
  `GetDashboardOverviewService`.
- Don't require standalone session-list callers to know about dashboard overview
  just to get project names.

---

## Dashboard project context index (deepened - c51)

Dashboard read models need the same session-to-project association rule:
stored `projectId` wins when present, and `projectRoot` is only a fallback for
older sessions that lack project metadata. That rule now lives behind one ops
application module.

**Interface shape:**
- `DashboardProjectContext` indexes dashboard project rows by id and path.
- `resolveSessionProject(session)` returns the project row using `projectId`
  precedence and `projectRoot` fallback only when `projectId` is absent.
- `DashboardSessionAggregationService` uses the context for per-project session
  counters.
- `ListDashboardSessionsService` uses the same context for session table
  project-name enrichment, while preserving basename fallback for unmatched
  root-only sessions.

**Why:** locality. Association precedence is easy to get subtly wrong when
each dashboard read model builds its own maps. The context module makes that
rule the test surface, so project-count aggregation and paged session display
change together.

**Anti-patterns:**
- Don't rebuild ad-hoc `projectId` or `projectRoot` maps inside individual
  dashboard read models.
- Don't use `projectRoot` to override a stale stored `projectId`; stale ids
  should remain unmatched until a migration or repair path is designed.
- Don't move dashboard session presentation fields into
  `DashboardProjectContext`; it only resolves project association.

---

## Credential vault use case (deepened - c22)

Credential use-case policy belongs in `CredentialService`; secure persistence
mechanics belong in the encrypted file adapter.

**Interface shape:**
- `CredentialService` owns credential listing, upsert/delete ownership checks,
  ID/timestamp assignment, normalized display fields, secret previews,
  last-used updates, and secret resolution.
- `CredentialStorePort` is the internal persistence seam: read or mutate
  `StoredCredential` records.
- `EncryptedCredentialFileStore` owns encrypted document parsing, queueing,
  atomic writes, file permissions, and encrypt/decrypt.

**Why:** locality. Credential rules change together with quota/auth resolution
and UI management behavior, not with the JSON document encryption details.
The service interface is now the test surface for credential behavior; the
adapter tests only need to prove secure persistence still works behind it.

**Anti-patterns:**
- Don't put credential trimming, preview generation, ownership errors,
  last-used policy, sort/filter rules, or credential ID policy in the encrypted
  file adapter.
- Don't expose `CredentialStorePort` to transport, quota, or auth callers; they
  use the credential use-case interface.
- Don't add high-level `list/upsert/delete/resolveSecret` methods back to the
  encrypted file adapter.

---

## Model-provider registry use case (deepened - c23)

Model-provider registry policy belongs in `ModelProviderService`; JSON document
persistence belongs in the file repository.

**Interface shape:**
- `ModelProviderService` owns default provider seeding and restore semantics,
  provider ID/timestamp assignment, create/update normalization, tenant-owned
  get/delete errors, enabled filtering, and name sorting.
- `ModelProviderRepositoryPort` is the internal persistence seam: read or
  mutate the provider document snapshot (`seededUserIds` + provider records).
- `ModelProviderFileRepository` owns JSON schema parsing, queueing, atomic
  writes, and cloning persisted snapshots before exposing them to the service.

**Why:** locality. Provider defaults, list visibility, and provider record
normalization are registry behavior used by transport and quota resolution; they
should not live with file IO mechanics. The service interface is the test
surface for registry behavior, while the adapter tests prove persistence behind
that seam.

**Anti-patterns:**
- Don't put default seeding, restore behavior, list filtering/sorting, provider
  ID policy, timestamps, or NotFound errors in the file repository.
- Don't add high-level `list/get/upsert/delete/ensureDefaults/restoreDefaults`
  methods back to `ModelProviderFileRepository`.
- Don't expose `ModelProviderRepositoryPort` to transport or quota callers; use
  the model-provider use-case interface.

---

## Feedback records use case (deepened - c24)

Response feedback policy belongs in `FeedbackService`; JSON document persistence
belongs in the file repository.

**Interface shape:**
- `FeedbackService` owns feedback create/update identity, comment
  normalization, tenant-scoped listing, chat/message filters, limit handling,
  updated ordering, and created/updated timestamps.
- `FeedbackRepositoryPort` is the internal persistence seam: read or mutate
  feedback records.
- `FeedbackFileRepository` owns JSON schema parsing, missing-file defaults,
  directory creation, writes, and cloning persisted records before exposing
  them to the service.

**Why:** locality. Feedback identity and list semantics are response-feedback
behavior used by transport callers; they should not live with file IO mechanics.
The service interface is the test surface for feedback behavior, while the
adapter test proves persistence behind that seam.

**Anti-patterns:**
- Don't put comment normalization, record identity, list filtering, limit
  handling, sort ordering, or timestamp policy in `FeedbackFileRepository`.
- Don't add high-level `list/upsert` methods back to the file repository.
- Don't expose `FeedbackRepositoryPort` to transport callers; use the feedback
  use-case interface.

---

## Remote-control lifecycle use case (deepened - c25)

Remote-control lifecycle policy belongs in `RemoteControlService`; JSON
document persistence belongs in the file repository.

**Interface shape:**
- `RemoteControlService` owns tenant-scoped device/session lookup, device
  upsert/delete, heartbeat updates, computed online/offline/disabled status,
  session request/active/stop/expire semantics, TTL defaults, and timestamp/ID
  assignment.
- `RemoteControlRepositoryPort` is the internal persistence seam: read or
  mutate remote-control store snapshots (`devices` + `sessions`).
- `RemoteControlFileRepository` owns JSON schema parsing, missing-file
  defaults, queueing, atomic writes, and cloning persisted device/session
  records before exposing them to the service.

**Why:** locality. Device ownership, liveness, and session lifecycle rules
change with remote-control behavior, not file IO mechanics. The service
interface is the test surface for remote-control behavior; the adapter test
proves persistence behind that seam.

**Anti-patterns:**
- Don't put tenant filtering, device/session lookup, heartbeat policy, status
  computation, session lifecycle transitions, TTL defaults, or timestamp/ID
  policy in `RemoteControlFileRepository`.
- Don't add high-level `listDevices/getDevice/saveDevice/deleteDevice` or
  `listSessions/getSession/saveSession` methods back to the file repository.
- Don't expose `RemoteControlRepositoryPort` to transport callers; use the
  remote-control use-case interface.

---

## Crash-reporting archive use case (deepened - c26)

Crash-reporting config, visibility, Sentry delivery, and local archive policy
belong in `CrashReportingService`; JSON document persistence belongs in the
file repository.

**Interface shape:**
- `CrashReportingService` owns default config resolution, config updates,
  report construction, stack inclusion, Sentry delivery, tenant-visible report
  listing, system report visibility, archive limit pruning, and report
  ID/timestamp assignment.
- `CrashReportingRepositoryPort` is the internal persistence seam: read or
  mutate crash-reporting store snapshots (`config` + `reports`).
- `CrashReportingFileRepository` owns JSON schema parsing, missing-file
  defaults, queueing, atomic writes, and cloning persisted config/report
  records before exposing them to the service.

**Why:** locality. Crash archive visibility and retention rules change with
crash-reporting behavior, not with file IO mechanics. The service interface is
the test surface; adapter tests prove persistence behind that seam.

**Anti-patterns:**
- Don't put default config resolution, tenant/system report visibility, archive
  pruning, report construction, Sentry delivery, or timestamp/ID policy in
  `CrashReportingFileRepository`.
- Don't add high-level `getConfig/saveConfig/listReports/saveReport` methods
  back to the file repository.
- Don't expose `CrashReportingRepositoryPort` to transport callers; use the
  crash-reporting use-case interface.

---

## ACP auth materialization use case (deepened - c27)

ACP auth provider policy and credential-to-auth-file synchronization belong in
`AcpAuthService`; JSON document persistence and private auth-file IO belong in
the file repository.

**Interface shape:**
- `AcpAuthService` owns provider ID/display/env normalization, default auth-file
  path assignment, tenant-visible listing, enabled filtering, display sorting,
  provider create/update/delete, timestamp assignment, sync status transitions,
  missing-credential handling, external-CLI handling, and materialized auth-file
  payload construction.
- `AcpAuthRepositoryPort` is the internal persistence seam: read or mutate ACP
  auth store snapshots (`providers`) and write or remove materialized provider
  auth files.
- `AcpAuthFileRepository` owns JSON schema parsing, missing-file defaults,
  queueing, atomic writes, cloning persisted provider records, storage-root path
  guards, private file permissions, and auth-file atomic replacement/removal.

**Why:** locality. Provider visibility, identity, sync status, and credential
materialization rules change with ACP auth behavior, not with JSON file IO. The
service interface is the test surface; adapter tests prove persistence and
private auth-file writes behind that seam.

**Anti-patterns:**
- Don't put provider filtering/sorting, upsert identity, NotFound behavior,
  timestamp policy, sync-state transitions, default auth-file paths, or
  credential payload construction in `AcpAuthFileRepository`.
- Don't add high-level `list/listAll/get/upsert/delete/updateSyncState` methods
  back to the file repository.
- Don't expose `AcpAuthRepositoryPort` to transport callers; use the ACP auth
  use-case interface.

---

## Output-style settings use case (deepened - c28)

Output-style presets, default settings, update semantics, and prompt-prefix
resolution belong in `OutputStyleService`; JSON document persistence belongs in
the file repository.

**Interface shape:**
- `OutputStyleService` owns built-in preset definitions, default settings,
  tenant settings lookup, settings updates, timestamp assignment, enabled
  checks, fallback preset selection, and prompt-prefix construction.
- `OutputStyleRepositoryPort` is the internal persistence seam: read or mutate
  output-style settings snapshots (`settingsByUserId`).
- `OutputStyleFileRepository` owns JSON schema parsing, missing-file defaults,
  directory creation, writes, and cloning persisted settings before exposing
  them to the service.

**Why:** locality. Preset defaults and prompt-prefix behavior change with
output-style product behavior, not with file IO mechanics. The service
interface is the test surface; adapter tests prove persistence behind that
seam.

**Anti-patterns:**
- Don't put default settings, update timestamp policy, preset fallback, enabled
  checks, or prompt-prefix construction in `OutputStyleFileRepository`.
- Don't add high-level `getSettings/updateSettings` methods back to the file
  repository.
- Don't expose `OutputStyleRepositoryPort` to transport callers; use the
  output-style use-case interface.

---

## Prompt-enhancement settings use case (deepened - c29)

Prompt-enhancement defaults, settings updates, and prompt enrichment belong in
`PromptEnhancementService`; JSON document persistence belongs in the file
repository.

**Interface shape:**
- `PromptEnhancementService` owns default settings, normalized settings
  updates, custom-instruction trimming, tenant settings lookup, enabled/source
  skip rules, context/date sections, instruction preset selection, and enriched
  prompt construction.
- `PromptEnhancementRepositoryPort` is the internal persistence seam: read or
  mutate prompt-enhancement settings snapshots (`settingsByUserId`).
- `PromptEnhancementFileRepository` owns JSON schema parsing, missing-file
  defaults, queueing, atomic writes, and cloning persisted settings before
  exposing them to the service.

**Why:** locality. Prompt enrichment behavior and settings defaults change
with prompt-enhancement product behavior, not with file IO mechanics. The
service interface is the test surface; adapter tests prove persistence behind
that seam.

**Anti-patterns:**
- Don't put default settings, update merge behavior, custom-instruction
  normalization, enabled/source skip rules, or prompt section construction in
  `PromptEnhancementFileRepository`.
- Don't add high-level `getSettings/updateSettings` methods back to the file
  repository.
- Don't expose `PromptEnhancementRepositoryPort` to transport callers; use the
  prompt-enhancement use-case interface.

---

## Terminal settings use case (deepened - c30)

Interactive terminal defaults, settings updates, shell command normalization,
and project-root cwd validation belong in `TerminalService`; JSON document
persistence belongs in the file repository.

**Interface shape:**
- `TerminalService` owns default terminal settings, normalized settings
  updates, tenant settings lookup, shell argument trimming, terminal dimension
  defaults, active-project resolution, and cwd validation before runtime
  creation.
- `TerminalSettingsRepositoryPort` is the internal persistence seam: read or
  mutate terminal settings snapshots (`settingsByUserId`).
- `TerminalSettingsFileRepository` owns JSON schema parsing, missing-file
  defaults, queueing, atomic writes, and cloning persisted settings before
  exposing them to the service.

**Why:** locality. Terminal settings behavior changes with the interactive
terminal use case, not with file IO mechanics. The service interface is the
test surface for defaults, normalization, project resolution, and runtime
creation; adapter tests prove persistence behind the seam.

**Anti-patterns:**
- Don't put default settings, update merge behavior, shell command/argument
  normalization, cwd validation, or runtime creation decisions in
  `TerminalSettingsFileRepository`.
- Don't add high-level `getSettings/updateSettings` methods back to the file
  repository.
- Don't expose `TerminalSettingsRepositoryPort` to transport callers; use the
  terminal use-case interface.

---

## Custom slash-command registry use case (deepened - c31)

Custom slash-command naming, duplicate checks, record materialization,
timestamp assignment, enabled toggles, and not-found semantics belong in
`SlashCommandsService`; JSON document persistence belongs in the file
repository.

**Interface shape:**
- `SlashCommandsService` owns custom command id/sourcePath creation, slash-name
  normalization, duplicate checks across custom and discovered commands,
  created/updated timestamps, record tags/diagnostics defaults, toggles,
  deletes, and registry summary counts.
- `CustomSlashCommandRepositoryPort` is the internal persistence seam: read or
  mutate custom slash-command snapshots (`commandsByUserId`).
- `SlashCommandFileRepository` owns JSON schema parsing, missing-file defaults,
  file writes, and cloning persisted command arrays before exposing them to the
  service.

**Why:** locality. Slash-command product behavior changes with the registry use
case, not with file IO mechanics. The service interface is the test surface for
normalization, duplicate checks, command materialization, update semantics, and
counts; adapter tests prove persistence behind the seam.

**Anti-patterns:**
- Don't put command id/sourcePath creation, timestamps, tags, duplicate checks,
  enabled-toggle behavior, delete semantics, or not-found errors in
  `SlashCommandFileRepository`.
- Don't add high-level `listCustomCommands/createCustomCommand/updateCustomCommand`
  methods back to the file repository.
- Don't expose `CustomSlashCommandRepositoryPort` to transport callers; use the
  commands use-case interface.

---

## Coding-plan subscription persistence use case (deepened - c32)

Coding-plan defaults, local subscription updates, billing snapshot
materialization, feature gates, change detection, and notification publishing
belong in `CodingPlanSubscriptionService`; JSON document persistence belongs in
the file repository.

**Interface shape:**
- `CodingPlanSubscriptionService` owns plan definitions, default free
  subscription creation, local update normalization, billing snapshot
  normalization, active-plan feature gates, changed-state detection, and
  `CodingPlanSubscriptionNotifier` fan-out.
- `CodingPlanSubscriptionRepositoryPort` is the internal persistence seam: read
  or mutate coding-plan subscription snapshots (`subscriptionsByUserId`).
- `CodingPlanSubscriptionFileRepository` owns JSON schema parsing,
  missing-file defaults, file writes, and cloning persisted subscriptions before
  exposing them to the service.

**Why:** locality. Billing and feature-gate behavior changes with the
coding-plan subscription use case, not with file IO mechanics. The service
interface is the test surface for defaults, update semantics, billing sync,
notifications, and gates; adapter tests prove persistence behind the seam.

**Anti-patterns:**
- Don't put default subscription creation, update normalization, billing
  materialization, changed-state detection, notification decisions, or
  feature-gate logic in `CodingPlanSubscriptionFileRepository`.
- Don't add high-level `getSubscription/saveSubscription` methods back to the
  file repository.
- Don't expose `CodingPlanSubscriptionRepositoryPort` to transport callers; use
  the coding-plan subscription use-case interface.

---

## Task auto-archive persistence use case (deepened - c33)

Task auto-archive defaults, settings updates, archive eligibility, run result
accounting, diagnostics, and last-run stamping belong in
`TaskAutoArchiveService`; JSON document persistence belongs in the file
repository.

**Interface shape:**
- `TaskAutoArchiveService` owns default disabled settings, user-configured
  update semantics, user targeting, session eligibility checks, dry-run
  behavior, result counters, diagnostics, and last-run/lastRunAt stamping.
- `TaskAutoArchiveRepositoryPort` is the internal persistence seam: read or
  mutate task auto-archive snapshots (`settingsByUserId` + `lastRunByUserId`).
- `TaskAutoArchiveFileRepository` owns JSON schema parsing, missing-file
  defaults, file writes, and cloning persisted settings/run results before
  exposing them to the service.

**Why:** locality. Archive policy and run accounting change with the task
auto-archive use case, not with file IO mechanics. The service interface is the
test surface for settings defaults, archive eligibility, run persistence, and
diagnostics; adapter tests prove persistence behind the seam.

**Anti-patterns:**
- Don't put default disabled settings, user-configured updates, archive
  eligibility, run counters, diagnostics, or last-run stamping in
  `TaskAutoArchiveFileRepository`.
- Don't add high-level `getSettings/saveSettings/getLastRun/saveLastRun`
  methods back to the file repository.
- Don't expose `TaskAutoArchiveRepositoryPort` to transport callers; use the
  task auto-archive use-case interface.

---

## Composition root (decomposed — c3)

`bootstrap/composition.ts` keeps its single job: orchestrate owner creation
and dispose. Focused owners absorb the rest:

- `AuthOwner` — auth runtime, auth module init, auth DB lifecycle.
- `PersistenceOwner` — sqlite worker, settings repo, sqlite storage lifecycle.
- `ServiceOwner` — service module init, use-case graph, server lifecycle,
  service-owned dispose hooks.
- `ModuleEventSubscriptionsOwner` — installs module-owned event
  subscriptions and owns unsubscribe disposal.

**Anti-patterns:**
- Don't add `setX`, `getX`, or subscription callbacks to the composition
  root. They belong in an owner or a module.
- Don't inline config-syncing or runtime-level setup here. It belongs in
  the persistence owner.

---

## SessionRealtimeGate (deepened — c5)

The session-owned module that absorbs realtime liveness policy for runtime
sessions.

**Interface** (four entry points):
- `prepareSubscription(session)` — reconnect preparation: clears idle/orphan
  state and reconciles stale busy status before snapshots are sent.
- `recordSubscriptionAttached(session)` — synchronizes `subscriberCount` from
  the live emitter listener count after the listener is registered.
- `releaseSubscription(input)` — synchronizes the count after disconnect and
  schedules orphaned prompt abort when the last subscriber leaves.
- `assertPromptCanSubmit(input)` — prompt submission gate used by the AI module;
  client prompts require realtime subscribers, automation/supervisor prompts do
  not.

**External seam:** none. This is not a port; one implementation owns the
policy. The AI module depends on this session interface instead of inspecting
`session.emitter` and `subscriberCount` directly.

**Why:** locality. Reconnect, submit, subscriber drift repair, and orphan abort
policy all change together. Callers get leverage from one session interface
rather than duplicating liveness rules.

**Anti-patterns:**
- Don't read `session.emitter.listenerCount("data")` in AI prompt use cases.
- Don't construct `SESSION_SUBSCRIPTION_REQUIRED` outside this gate.
- Don't add a port here until there are two real adapters.

---

## UsageStatsPersistence (deepened — c6)

The usage-stats module now stores telemetry settings and server-side usage
records through the primary SQLite persistence graph.

**Interface:**
- `UsageStatsRepositoryPort` remains the use-case seam: append records, list
  records, read telemetry settings snapshots, mutate telemetry settings
  snapshots.
- `PersistenceModule` owns the concrete adapter choice.

**Adapters:**
- `UsageStatsSqliteRepository` — local SQLite adapter using the shared write
  queue and the `usage_stats_records` / `usage_telemetry_settings` tables.
- `UsageStatsSqliteWorkerRepository` — worker adapter when SQLite worker mode
  is enabled.
- `UsageStatsFileRepository` — retained as a file adapter for explicit fallback
  or tests, not the production composition default.

**Why:** locality. Storage backend choice belongs to persistence composition,
not the usage-stats use-case factory. Usage-stats keeps a small repository
interface while primary runtime data lives in the same SQLite backend as
sessions, projects, agents, and settings.

**Event ingress:** `modules/usage-stats/init/usage-stats-events.init.ts`
translates domain events into usage-owned recording inputs:
- lifecycle events become `recordLifecycleUsage({ kind, userId, projectRoot,
  ...sessionContext })`;
- quota events become `recordQuotaRefresh({ userId, providerId,
  providerDisplayName, status })`.

`UsageStatsService` does not import domain-event types; it records usage facts.

**Anti-patterns:**
- Don't construct `UsageStatsFileRepository` in production service registry
  wiring.
- Don't bypass `UsageStatsRepositoryPort` from the usage-stats use case.
- Don't add scanner/provider logic to persistence adapters.
- Don't pass raw `DomainEvent` payloads into `UsageStatsService`; translate
  them in usage-stats init.

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

---

## Repo-snapshot indexing settings use case (deepened - c34)

Repo-snapshot indexing defaults, settings updates, refresh gating,
last-refresh stamping, and disabled-search diagnostics belong in
`RepoSnapshotIndexingService`; JSON settings persistence and project
manifest/state IO belong in the file repository.

**Interface shape:**
- `RepoSnapshotIndexingService` owns default enabled settings,
  user-configured update semantics, enable-triggered refresh decisions,
  disabled refresh/search diagnostics, refresh timestamps, and manifest write
  orchestration after the index adapter refreshes.
- `RepoSnapshotIndexingRepositoryPort` keeps two seams: a settings snapshot seam
  (`readSettings` / `mutateSettings`) and a project snapshot artifact seam
  (`getStorageState` / `writeManifest`).
- `RepoSnapshotIndexingFileRepository` owns JSON schema parsing, missing-file
  defaults, hashed settings keys, cloning persisted settings before exposure,
  and manifest/state file writes.

**Why:** locality. Product policy for whether indexing is enabled, when a
refresh is triggered, and what diagnostics users see changes with the
repo-snapshot indexing use case. File IO mechanics and manifest retention
change with the adapter. The service interface remains the test surface for
settings behavior; adapter tests prove persistence behind the seam.

**Anti-patterns:**
- Don't put default settings, user-configured updates, refresh gating,
  last-refresh stamping, or disabled diagnostics in
  `RepoSnapshotIndexingFileRepository`.
- Don't add high-level `getSettings/saveSettings` methods back to the file
  repository.
- Don't expose `RepoSnapshotIndexingRepositoryPort` to transport callers; use
  the repo-snapshot indexing use-case interface.

---

## Usage telemetry settings use case (deepened - c35)

Usage telemetry defaults, opt-in updates, and summary materialization belong in
`UsageStatsService`; telemetry persistence belongs in the repository adapters.

**Interface shape:**
- `UsageStatsService` owns the default disabled telemetry state, update
  timestamp assignment, and the decision to include telemetry settings in usage
  summaries.
- `UsageStatsRepositoryPort` keeps server-side records as append/list storage
  operations, and exposes telemetry through a scoped snapshot seam
  (`readTelemetrySettings` / `mutateTelemetrySettings`).
- `UsageStatsFileRepository`, `UsageStatsSqliteRepository`, and
  `UsageStatsSqliteWorkerRepository` own JSON/table/worker IO, cloned
  telemetry settings exposure, and upsert mechanics.

**Why:** locality. Telemetry product behavior changes with the usage-stats use
case, not with JSON files, SQLite rows, or worker transport. The service
interface remains the test surface for default opt-out behavior and summary
materialization; adapter tests prove each persistence adapter behind the seam.

**Anti-patterns:**
- Don't put default disabled telemetry, update timestamp decisions, or summary
  inclusion rules in usage-stats persistence adapters.
- Don't add high-level `getTelemetrySettings/saveTelemetrySettings` methods
  back to `UsageStatsRepositoryPort`.
- Don't expose `UsageStatsRepositoryPort` to transport callers; use the
  usage-stats use-case interface.

---

## Traffic-proxy config use case (deepened - c36)

Traffic-proxy defaults, update normalization, cache behavior, timestamp
assignment, and agent environment projection belong in `TrafficProxyService`;
JSON document persistence belongs in the file repository.

**Interface shape:**
- `TrafficProxyService` owns the default disabled proxy config, input trimming,
  `updatedAt` assignment, cached config reuse, and construction of agent
  environment variables.
- `TrafficProxyRepositoryPort` is the internal persistence seam: read or mutate
  a traffic-proxy config snapshot (`readConfig` / `mutateConfig`).
- `TrafficProxyFileRepository` owns JSON schema parsing, document version
  handling, atomic file writes, and cloning persisted config before exposing it
  to the service.

**Why:** locality. Proxy product behavior changes with the traffic-proxy use
case, not with file IO mechanics. The service interface is the test surface for
defaults, normalization, cache use, and agent environment projection; adapter
tests prove persistence behind the seam.

**Anti-patterns:**
- Don't put default config, trimming, timestamp assignment, cache decisions, or
  environment-variable construction in `TrafficProxyFileRepository`.
- Don't add high-level `getConfig/saveConfig` methods back to the file
  repository.
- Don't expose `TrafficProxyRepositoryPort` to transport callers; use the
  traffic-proxy use-case interface.

---

## Settings-sync state use case (deepened - c37)

Settings-sync defaults, first-run prompt state, conflict detection, sync
timestamps, device identity, and push/pull/noop status materialization belong
in `SettingsSyncService`; JSON state/cloud snapshot persistence belongs in the
file repository.

**Interface shape:**
- `SettingsSyncService` owns default state creation, config updates,
  first-run prompt handling, local/remote hash comparison, conflict creation,
  sync timestamp assignment, and status projection.
- `SettingsSyncStateRepositoryPort` is a user-scoped state snapshot seam:
  `readState(userId, reader)` and `mutateState(userId, mutator)`.
- `SettingsSyncFileRepository` owns JSON schema parsing, missing-file defaults,
  atomic file writes, and cloning persisted state/remote snapshots before
  exposing them to the service.

**Why:** locality. Sync policy changes with the settings-sync use case, not
with JSON file layout. The service interface remains the test surface for
default-state creation, conflicts, push/pull/noop outcomes, and status
materialization; adapter tests prove persistence and clone behavior behind the
seam.

**Anti-patterns:**
- Don't put default state, first-run prompt policy, conflict rules, timestamp
  assignment, or status projection in `SettingsSyncFileRepository`.
- Don't add high-level `getState/saveState` methods back to
  `SettingsSyncStateRepositoryPort`.
- Don't expose `SettingsSyncStateRepositoryPort` to transport callers; use the
  settings-sync use-case interface.

---

## Bot quota automation state use case (deepened - c38)

Quota-window observation, stale-state pruning, due-window selection, dispatch
dedupe, cooldown checks, defer timing, and queued-run execution belong in
`BotsService`; JSON document persistence for bot definitions, runs, and quota
automation state belongs in `BotFileRepository`.

**Interface shape:**
- `BotsService` owns quota automation policy: recording ready provider windows,
  pruning stale windows/dispatches, deciding due windows, matching bots to
  quota windows, enforcing dispatch dedupe/cooldowns, and deferring windows
  after idle/unavailable/error outcomes.
- `BotRepositoryPort` still exposes bot definitions and runs as existing
  persistence operations, but quota automation state is behind a snapshot seam:
  `readQuotaAutomationState(reader)` and
  `mutateQuotaAutomationState(mutator)`.
- `BotFileRepository` owns JSON schema parsing, the combined bot document
  layout, queued file writes, versioned missing-file defaults, and cloning
  quota automation state before exposing it to the service.

**Why:** locality. The quota automation state machine changes with bot
orchestration behavior, not with JSON layout. The service tests remain the
test surface for dispatch policy, and adapter tests prove persistence,
clone behavior, and preservation of bot/run document data behind the seam.

**Anti-patterns:**
- Don't put quota-window pruning, due-window selection, dispatch dedupe,
  cooldown policy, or defer timing in `BotFileRepository`.
- Don't add high-level `readQuotaAutomationState(): state` plus
  `saveQuotaAutomationState(state)` back to `BotRepositoryPort`.
- Don't broaden this seam into a generic transaction over the entire bot
  document unless bot definitions and runs move behind a deeper module too.

---

## Settings persistence use case (deepened - c39)

Settings patch validation, project-root normalization, app-config patch
validation, changed-key detection, restart requirements, and settings-change
fan-out belong in the settings application module; SQLite adapters persist
full settings snapshots.

**Interface shape:**
- `UpdateSettingsService.execute(patch: SettingsPatch)` owns partial-patch
  semantics: it reads the current settings snapshot, applies
  `SettingsAggregate` rules, validates nested app config patches through
  `AppConfigService`, builds the full next settings snapshot, persists it,
  reloads runtime app config, and publishes settings-change notifications.
- `SettingsPatch` is the application interface for settings updates. It allows
  nested partial `ui` and `app` patches while keeping `projectRoots` and
  `mcpServers` as replacement fields.
- `SettingsRepositoryPort` exposes `get()` and `save(settings)`. `save`
  accepts a full `Settings` snapshot; it is not a patch/merge operation.
- `SettingsSqliteRepository` owns SQLite row layout, JSON/schema parsing,
  missing/corrupt stored-value repair on read, and writing the full settings
  snapshot to the app-settings rows. The worker adapter forwards the same
  `save` operation across the SQLite worker seam.

**Why:** locality. Settings product behavior changes in one application module
instead of being split between `UpdateSettingsService`, Local ADE methods, and
the persistence adapter's patch merge. The repository interface now describes
persistence rather than update policy, and tests can assert that callers save a
complete, validated snapshot.

**Anti-patterns:**
- Don't add `update(patch: Partial<Settings>)` back to
  `SettingsRepositoryPort`.
- Don't put patch merge, changed-key detection, restart requirements, or
  notifier fan-out in SQLite settings adapters.
- Don't let feature modules persist partial settings patches directly; use the
  settings use-case interface or build an explicit full settings snapshot when
  a low-level adapter is intentionally injected.

---

## Agent active-state lifecycle use case (deepened - c40)

Agent input validation, ownership checks, and lifecycle notifications belong in
the agent application module. Atomic persistence changes that create/delete an
agent and repair active-agent state belong behind the agent repository seam.

**Interface shape:**
- `CreateAgentService` normalizes user input and calls
  `createAndEnsureActive(input)`. The repository operation creates the agent and
  initializes active-agent state when it is missing or dangling.
- `DeleteAgentService` checks user ownership/NotFound and calls
  `deleteAndRepairActive(id, userId)`. The repository operation deletes the
  agent and repairs active-agent state to the first remaining agent or `null`.
- `AgentRepositoryPort` still exposes `create`, `delete`, and `setActive` for
  explicit low-level operations, but lifecycle services use the atomic
  create/delete operations when active state is coupled to the write.
- `AgentSqliteRepository` owns SQLite transaction scope, `user_settings`
  active-agent row parsing, dangling-active detection, fallback selection, and
  user-scoped repair writes.

**Why:** locality. Active-agent consistency depends on persistence state and
must not be reconstructed by every caller with `create/delete + getActiveId +
setActive` choreography. The service interface remains the test surface for
validation, NotFound behavior, and notifications; adapter tests prove active
state repair behind the seam.

**Anti-patterns:**
- Don't reintroduce `create + getActiveId + setActive` in
  `CreateAgentService`.
- Don't reintroduce `delete + findAll + setActive` in `DeleteAgentService`.
- Don't move lifecycle notifications into repository adapters.
- Don't let transport callers repair active-agent state directly; route the
  workflow through the agent application module.

---

## Project active-state delete lifecycle use case (deepened - c41)

Project ownership checks, deletion lifecycle notifications, and cleanup event
ordering belong in the project application module. Atomic persistence changes
that delete a project and repair active-project state belong behind the project
repository seam.

**Interface shape:**
- `DeleteProjectService` loads the user-owned project, publishes
  `beforeProjectDelete`, calls `deleteAndClearActive(id, userId)`, then
  publishes `afterProjectDeleted`.
- `ProjectRepositoryPort` still exposes `delete` and `setActive` for explicit
  low-level operations, but delete lifecycle services use
  `deleteAndClearActive` when active state is coupled to project removal.
- `ProjectSqliteRepository` owns SQLite transaction scope, `user_settings`
  active-project row parsing, active-project validation after deletion, and
  user-scoped repair writes.
- Project delete semantics clear active state to `null`; they do not
  auto-select a fallback project.

**Why:** locality. Active-project consistency depends on the persistence rows
and should not be reconstructed by application callers with `getActiveId +
setActive + delete` choreography. The application interface remains the test
surface for NotFound behavior and lifecycle notifications; adapter tests prove
active-state repair behind the seam.

**Anti-patterns:**
- Don't reintroduce `getActiveId + setActive + delete` in
  `DeleteProjectService`.
- Don't move project lifecycle notifications or cleanup ordering into
  repository adapters.
- Don't change delete semantics to select a fallback project unless the product
  behavior is explicitly redesigned.

---

## Project list active-state read model use case (deepened - c46)

Project list callers that present active-project state use a repository
read-model operation instead of reconstructing active state from separate
low-level reads. Dangling active-project state is repaired to `null`; project
list reads do not auto-select a fallback project.

**Interface shape:**
- `ListProjectsService` calls `listWithActiveState(userId)` and returns its
  read model.
- `LocalAdeService.resolveProjectContext` also calls
  `listWithActiveState(userId)` before choosing the effective snapshot root.
- `ProjectRepositoryPort` still exposes `findAll`, `getActiveId`, and
  `setActive` for explicit low-level operations, but list/snapshot callers use
  the read model when active state must accompany project rows.
- `ProjectSqliteRepository` owns project row selection, active-project setting
  parsing, missing/dangling active detection, and repair-to-null writes inside
  the queued SQLite transaction.

**Why:** locality. Project list callers should not know that presenting active
state requires `findAll + getActiveId` choreography or that project active-state
repair clears to `null` rather than choosing a fallback. The service interface
remains the test surface for project list projection; adapter tests prove
persistence repair behind the seam.

**Anti-patterns:**
- Don't reintroduce `findAll + getActiveId` active-project read choreography in
  `ListProjectsService` or Local ADE snapshot project context.
- Don't make project list repair select the first project as active; fallback
  root selection is a Local ADE presentation concern, not persisted active
  state.
- Don't move project lifecycle notifications into the list read model; it only
  repairs persisted active state.

---

## Agent list active-state read model use case (deepened - c42)

Agent list filtering belongs in the agent application module's read use-case,
but active-agent state validation and repair belongs behind the agent
repository seam because it depends on persisted agent rows and `user_settings`
state.

**Interface shape:**
- `ListAgentsService` calls
  `listByProjectWithActiveState(projectId, userId)` and returns its read model.
- `AgentRepositoryPort` still exposes `findAll`, `getActiveId`,
  `listByProject`, and `setActive` for explicit low-level operations, but list
  callers use the read-model operation when active state must accompany agent
  rows.
- `AgentSqliteRepository` owns project-scope row selection, active-agent row
  parsing, missing/dangling active detection, fallback active selection, and
  repair writes inside the queued SQLite transaction.

**Why:** locality. Agent list callers should not know that presenting active
state requires `listByProject + findAll + getActiveId + setActive`
choreography. The service interface remains the test surface for the list
workflow, while adapter tests prove persistence repair and project filtering
behind the seam.

**Anti-patterns:**
- Don't reintroduce active-state repair choreography in `ListAgentsService`.
- Don't let transport callers combine low-level agent repository calls to build
  list read models with active state.
- Don't move dashboard notifications into the list repository operation; it is
  a read model with persistence repair only.

---

## Local ADE agent active-state read model reuse (deepened - c45)

Local ADE snapshots present agent rows together with active-agent state, but
they should not reconstruct that state from low-level repository calls. Snapshot
generation uses the agent repository read model that already owns active-agent
validation and repair.

**Interface shape:**
- `LocalAdeService.snapshot(userId)` calls
  `listByProjectWithActiveState(undefined, userId)` to get all user agents plus
  `activeAgentId`.
- The snapshot still owns Local ADE projection details: provider discovery,
  env-key redaction, `isActive` flags, and runtime readiness messaging.
- `AgentRepositoryPort.findAll` and `getActiveId` remain available for explicit
  low-level operations, but Local ADE snapshot must not combine them to build an
  active-state view.

**Why:** leverage. Agent active-state repair remains behind the repository
read-model seam created for agent lists, and Local ADE tests can focus on the
snapshot projection instead of reproducing active-agent persistence rules.

**Anti-patterns:**
- Don't reintroduce `findAll + getActiveId` active-agent snapshot choreography
  in `LocalAdeService.snapshot`.
- Don't move Local ADE provider/readiness projection into the agent repository;
  the repository read model only supplies agent rows and active state.
- Don't make Local ADE snapshot repair active state separately from
  `listByProjectWithActiveState`.

---

## Session agent resolution active-state read model reuse (deepened - c47)

Session lifecycle resolves the concrete agent command for create/discover
workflows. Explicit `agentId` selection remains an ownership-checked lookup,
but omitted `agentId` uses the agent active-state read model instead of
reconstructing active-agent state from low-level reads.

**Interface shape:**
- `SessionAgentResolverService.resolve(input)` keeps the caller contract:
  explicit `agentId` wins; otherwise choose the active project-compatible agent
  when it appears in the scoped read model, then fall back to the first scoped
  candidate.
- `AgentRepositoryPort.listByProjectWithActiveState(projectId, userId)` supplies
  both compatible agent rows and repaired active-agent state.
- `SessionAgentResolverService` only maps the selected agent to runtime spawn
  config and owns the session-specific NotFound errors.

**Why:** locality. Session lifecycle should not know that active-agent
resolution requires persisted `user_settings` parsing, dangling-id repair, or
project-scope row filtering. The agent repository read-model seam remains the
single place that repairs active state, while session tests focus on explicit
selection, fallback order, and runtime config mapping.

**Anti-patterns:**
- Don't reintroduce `getActiveId + findById + listByProject` choreography in
  `SessionAgentResolverService`.
- Don't move ACP spawn/runtime mapping into the agent repository; the repository
  read model only supplies agent rows plus active state.
- Don't reject explicit cross-project agent selection here unless the session
  input contract is redesigned.

---

## Project active-resolution use case (deepened - c43)

Resolving a user's selected project from active-project state belongs in the
project application module. Git-facing callers may pass an explicit project id,
but callers that need the active project should not reconstruct
`getActiveId + findById` choreography or duplicate the missing/dangling active
error modes.

**Interface shape:**
- `ResolveActiveProjectService.execute(userId, context?)` returns the active
  user-owned `Project` row or throws a typed `NotFoundError`.
- The optional context only attributes the error to a caller module/op; it does
  not expose repository ordering or active-state persistence mechanics.
- `GitService` and `GitCheckpointService` keep explicit-project lookup local to
  their Git use case, but delegate active-project lookup to
  `ResolveActiveProjectService`.

**Why:** locality. Active-project resolution is project-owned product behavior,
not Git behavior. The project service interface becomes the test surface for
"no active project" and "dangling active project" errors, while Git tests only
need to prove that repository/checkpoint workflows use the resolved project
root.

**Anti-patterns:**
- Don't reintroduce `getActiveId + findById` active-project resolution in Git
  callers.
- Don't move checkpoint lifecycle resolution by `projectRoot` into this service;
  lifecycle events have a separate root-matching invariant.
- Don't put dashboard notifications or active-state mutation in
  `ResolveActiveProjectService`; it is a read resolution use case.

---

## Terminal active-project resolution delegation (deepened - c44)

Terminal creation owns terminal-specific policy, but it does not own
active-project state reconstruction. When a terminal create request omits
`projectId`, project selection is delegated to the project active-resolution
use case; Terminal still validates cwd and runtime terminal defaults.

**Interface shape:**
- `TerminalService` accepts `ResolveActiveProjectService` in its dependency
  object next to `ProjectRepositoryPort`.
- Explicit `projectId` lookup remains in `TerminalService` because that is a
  terminal create input, not an active-state read model.
- Missing `projectId` calls `ResolveActiveProjectService.execute(userId,
  { module: "terminal", op: "create" })`, then Terminal validates cwd stays
  inside the resolved project root before creating the runtime terminal.

**Why:** leverage. The active-project error modes and repository lookup order
are now tested once at the project seam. Terminal tests can focus on terminal
settings, dimensions, explicit project selection, cwd validation, and runtime
creation.

**Anti-patterns:**
- Don't reintroduce `getActiveId + findById` active-project resolution in
  `TerminalService`.
- Don't move cwd validation into `ResolveActiveProjectService`; cwd is
  terminal policy.
- Don't remove explicit-project lookup from Terminal unless the terminal
  creation input contract is redesigned.
## Multi-session Supervisos Orchestration

`packages/runtime/src/modules/supervisor-orchestration` is the run-level
coordination boundary. Its authoritative `SupervisorRunState` is a versioned,
revisioned SQLite aggregate containing the task DAG, worker-attempt bindings,
structured results, integration gates, audit records, budgets, and final
verification. This state is deliberately separate from the existing
per-session `SupervisorSessionState`.

The application flow is planner -> scheduler -> worker session manager ->
per-session Supervisos review -> structured result assessment -> isolated patch
gate/integration -> dependency scheduling -> aggregate verification. The worker
manager delegates to canonical session and AI services and uses the internal
`orchestrator` prompt source. A bounded `supervisor_turn_terminal` domain event
is claimed durably against the worker chat before result processing, making
duplicate and out-of-order lifecycle delivery idempotent.

Read-only workers share the project root. Write workers receive detached Git
worktrees under runtime storage. Infrastructure collects a binary-safe cached
diff and complete file manifest, while application gates protect scoped paths,
dirty user changes, dispatch-time fingerprints, deletion/destructive actions,
verification, permissions, and conflicts. Safe patches are applied without
commit or push. Unsupported non-Git writes fail closed.

`SupervisorRecoveryService` runs after normal session startup reconciliation.
It preserves paused runs, recognizes live sessions, resumes capable stopped
sessions, interrupts and cleans stale workers, retries within persisted limits,
and resumes recorded review/integration work. The `supervisorRuns` tRPC router
and desktop Supervisos Runs panel consume a strict client projection that omits
original prompts, transcripts, raw diffs, artifact paths, and audit text.

Goal Mode remains a sequential reusable scope/gate/prompt subsystem, but its
production repository is now SQLite-backed and user-owned. Its start, attempt,
result, and read operations are exposed through the authenticated `goalMode`
tRPC router; multi-session run/task state remains the orchestration authority.

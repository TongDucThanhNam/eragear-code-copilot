---
artifact_type: explorer_report
session_id: 20260426-opencode-init-model-list-lag
task_id: T06
producer: team-explorer
status: ACTIVE
created_at: 2026-04-27
source_commit: UNKNOWN
based_on:
  - artifacts/20260426-opencode-init-model-list-lag/00-brief-T06-persistent-lag-diagnosis.md
  - artifacts/20260426-opencode-init-model-list-lag/01-triage-report-T06.md
  - artifacts/20260426-opencode-init-model-list-lag/03-explorer-report.md
  - artifacts/20260426-opencode-init-model-list-lag/validation/T04-final-validation.md
  - artifacts/20260426-opencode-init-model-list-lag/validation/T05-validation.md
consumers:
  - team-heavy
  - team-validator
  - orchestrator
freshness_rule: invalid_if_brief_triage_or_codebase_shape_changes
---

# Explorer Report — T06 Persistent Lag Diagnosis

## Objective interpreted

Diagnose the actual source of persistent web UI lag **after** the T04 model-list cap is in place. The cap eliminated the known model-list payload amplification path, but the user reports lag persists. The diagnosis must use **measurements, not speculation**: identify bottleneck(s) across the full ACP → server → transport → client-state → React-render pipeline. The result is a concrete probe-point map, a dev-only instrumentation design, and a manual reproduction guide — no production code changes.

## Key data flow (post-T04 cap)

```
┌──────────┐  ACP ndjson   ┌──────────────────────────────────────────────────────┐
│ OpenCode │──────────────►│ Server (apps/server)                                  │
│ (agent)  │               │                                                      │
└──────────┘               │  ┌─ bootstrap (new/load session)                    │
                           │  │   payload: models (capped ✓), configOptions       │
                           │  │   (model option options capped ✓, other options    │
                           │  │    uncapped), tool results, messages              │
                           │  ├─ ACP update handler                               │
                           │  │   config_option_update → re-cap ✓, broadcast      │
                           │  │   tool_call → execute → tool_result (volume?)     │
                           │  │   session_update → messageBuffer append           │
                           │  ├─ tRPC getSessionState                             │
                           │  │   returns capped models + configOptions            │
                           │  ├─ WebSocket broadcast                              │
                           │  │   config_options_update, current_model_update,     │
                           │  │   session_update (message buffer replay)          │
                           │  └─ JSON persistence                                 │
                           │      .eragear/sessions.json write on update          │
                           └──────────┬───────────────────────────────────────────┘
                                      │ tRPC / WebSocket
┌─────────────────────────────────────▼──────────────────────────────────────────┐
│ Client (apps/web)                                                               │
│                                                                                 │
│  ┌─ use-chat-session-state-sync.ts                                             │
│  │   applySessionState() → setModels(capped ✓) + setConfigOptions(capped ✓)   │
│  │   hydration useEffect → backfill from server                                │
│  ├─ use-chat-core.ts (packages/shared)                                          │
│  │   handleConfigOptionsUpdate() → re-derive models from configOptions          │
│  │   handleCurrentModelUpdate() → set current model                             │
│  │   applySessionState() → full state restore                                   │
│  ├─ chat-interface.tsx                                                          │
│  │   resolveSessionSelectionState() → derive selection state                    │
│  │   availableModels.map() → O(N) map per render                                │
│  ├─ chat-input.tsx                                                              │
│  │   modelsWithDetails.map() → O(N) map per render                              │
│  │   fullFilteredGroups → O(N) filter per search                                │
│  │   renderedModelGroups → 50-item cap (existing, unchanged)                    │
│  └─ React render commit → paint / layout                                        │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**What the cap solved:** `models.availableModels` and model `configOptions.options` are now capped to 100 items at the server boundary. This eliminates the O(1000+) array propagation through the pipeline.

**What remains unbounded (candidates for persistent lag):**
- `configOptions` for non-model categories (modes, providers, other agent options) — may contain large nested arrays.
- Tool-call result payloads during init (agent reads files, runs commands, produces large outputs).
- WebSocket message buffer replay on reconnect (replaying accumulated session events).
- JSON store write pressure from rapid-fire session updates during init.
- Client-side React re-render loops: each `config_options_update` broadcast triggers state changes that cascade through `use-chat-core` → `chat-interface.tsx` → `chat-input.tsx`.
- Client-side search/filter O(N) operations that regress with even 100 items if called repeatedly.

## Probe points

### Server-side probes (S1–S14)

| Probe | File | Location | What to measure | Why |
|-------|------|----------|-----------------|-----|
| **S1** | `infra/acp/connection.ts` | `onMessage` handler | Incoming ndjson message size (bytes), timestamp delta between successive messages | Identifies agent output flood rate and payload volume per message |
| **S2** | `modules/session/application/session-acp-bootstrap.service.ts` | `loadExistingSession()` L345–424, `createNewSession()` L426–449 | `loadResult` / `newResult` total payload size (JSON.stringify length), wall-clock duration of bootstrap | Quantifies initial payload cost; may reveal large tool-result or message arrays |
| **S3** | `shared/utils/session-config-options.util.ts` | `syncSessionSelectionFromConfigOptions()` L191–225, `deriveModelState()` L167–189 | Wall-clock duration, `availableModels.length` pre- and post-cap, `configOptions` total option count | Verifies cap is effective and derivation is not a hotspot |
| **S4** | `platform/acp/update.ts` | `handleConfigOptionsUpdate()` L513–596 | Incoming configOptions payload size (bytes), wall-clock duration, broadcast payload size after cap | Validates that configOptions updates are not re-introducing large payloads |
| **S5** | `modules/session/application/get-session-state.service.ts` | `execute()` L58–76 | Response payload size (JSON.stringify of models + configOptions), wall-clock duration | Confirms tRPC response is not bloated post-cap |
| **S6** | `transport/trpc/routers/session.ts` | `getSessionState` procedure | tRPC serialization time, total handler wall-clock | Isolates transport layer overhead from application logic |
| **S7** | `modules/session/infra/runtime-store.ts` | `broadcast()` / `broadcastToSession()` | Broadcast payload size (bytes per event type), broadcast call frequency per second | Identifies WebSocket broadcast amplification — how many bytes/sec are pushed to clients |
| **S8** | `modules/session/infra/runtime-store.ts` | `messageBuffer` / `appendEvent()` | Buffer size (event count), buffer total bytes, append frequency | Reveals whether event accumulation is causing replay lag on client reconnect |
| **S9** | `infra/storage/json-store.ts` | `set()` / `write()` | Write wall-clock duration, write frequency (writes/sec during init), file size on disk | Isolates persistence I/O as a bottleneck during rapid session updates |
| **S10** | `modules/ai/application/set-model.service.ts` | `getRuntimeForModelSwitch()` L131–170 | Wall-clock duration, validation path taken (configOptions vs availableModels) | Confirms model-switch validation is not a bottleneck |
| **S11** | `modules/ai/application/set-config-option.service.ts` | `execute()` L113–134 | Wall-clock duration, `collectConfigOptionValues()` iteration count | Confirms config-option validation is not iterating large uncapped arrays |
| **S12** | `infra/acp/tool-calls.ts` | tool-call execution handler | Tool result payload size (bytes), tool execution wall-clock, tool call frequency during init | Identifies tool-output flood: agent may be running many tool calls that produce large results |
| **S13** | `shared/utils/event-bus.ts` | `emit()` / `on()` | Event emission rate (events/sec), listener count per event type | Reveals whether internal event bus is a fan-out amplification point |
| **S14** | `bootstrap/server.ts` | process-level | `process.memoryUsage()` snapshot before/after session init, event loop lag (`libuv` latency via `perf_hooks.monitorEventLoopDelay`) | Detects server-side memory pressure or event loop starvation |

### Client-side probes (C1–C9)

| Probe | File | Location | What to measure | Why |
|-------|------|----------|-----------------|-----|
| **C1** | `apps/web/src/hooks/use-chat-session-state-sync.ts` | `restoreSessionState()` L182–263 | Wall-clock duration, incoming data size (bytes), number of state updates triggered | Measures hydration cost when client connects and receives full session state |
| **C2** | `packages/shared/src/chat/use-chat-core.ts` | `applySessionState()` L975–1063 | Wall-clock duration, `models.length`, `configOptions.length`, `resolveSessionSelectionState()` duration | Quantifies shared-core state application cost |
| **C3** | `packages/shared/src/chat/use-chat-core.ts` | `handleConfigOptionsUpdate()` L860–877 | Wall-clock duration, `onConfigOptionsChange()` + `resolveSessionSelectionState()` duration | Measures per-update processing cost on the client |
| **C4** | `apps/web/src/hooks/use-chat-session-state-sync.ts` | `applySessionState()` L182–263 | Count of `setState` / `dispatch` calls, React batching behavior (are updates coalesced?) | Detects excessive React state updates causing cascading re-renders |
| **C5** | `apps/web/src/components/chat-ui/chat-interface.tsx` | `selectionState` derivation L364–372 + `availableModels` L396–418 | Wall-clock duration per render, `availableModels.length`, React render count (via `useRenderCount` or Profiler) | Measures top-level chat component render cost |
| **C6** | `apps/web/src/components/chat-ui/chat-input.tsx` | `modelsWithDetails` L184–198 | Wall-clock duration per render, array length, render count | Isolates model-list map cost in chat input |
| **C7** | `apps/web/src/components/chat-ui/chat-input.tsx` | `fullFilteredGroups` L219–241 | Wall-clock duration per render, filter iteration count | Measures search/filter cost on full dataset |
| **C8** | `apps/web/src/components/chat-ui/chat-input.tsx` | component-level | React Profiler render duration, commit duration, `useMemo`/`useCallback` dependency change frequency | Holistic render performance measurement |
| **C9** | `apps/web/src/hooks/use-chat-session-event-handler.ts` | `processSessionEvent` L515–521 | Event processing latency (time from WS receive to React state commit), event rate (events/sec) | Measures end-to-end WS→React pipeline latency |

## Dev-only gating design

All instrumentation **MUST NOT** execute in production. Three gate layers ensure this:

### Layer 1: Environment variable (server)

```
ERAGEAR_DIAGNOSTICS=1
```

- Checked on server startup in a single `isDiagnosticsEnabled()` utility.
- If not set, all probe code is **no-op** (early return in wrapper functions).
- Probe wrapper pattern:

```typescript
// shared/utils/diagnostics.util.ts (new file, server-side)
export function isDiagnosticsEnabled(): boolean {
  return process.env.ERAGEAR_DIAGNOSTICS === '1';
}

export function diagnosticMeasure<T>(label: string, fn: () => T): T {
  if (!isDiagnosticsEnabled()) return fn();
  const start = performance.now();
  const result = fn();
  const duration = performance.now() - start;
  console.log(`[DIAG:${label}] ${duration.toFixed(2)}ms`);
  return result;
}

export function diagnosticLog(label: string, data: Record<string, unknown>): void {
  if (!isDiagnosticsEnabled()) return;
  console.log(`[DIAG:${label}]`, JSON.stringify(data));
}
```

### Layer 2: localStorage flag (client)

```
localStorage.setItem('ERAGEAR_DIAGNOSTICS', '1')
```

- Checked in a React context or singleton module at app mount.
- All client probe code is no-op when flag is absent.
- Client wrapper pattern:

```typescript
// apps/web/src/hooks/use-diagnostics.ts (new file, client-side)
export function useDiagnostics(): boolean {
  return typeof window !== 'undefined'
    && window.localStorage.getItem('ERAGEAR_DIAGNOSTICS') === '1';
}

export function useDiagnosticRenderCount(componentName: string): void {
  const enabled = useDiagnostics();
  const renderCount = useRef(0);
  if (enabled) {
    renderCount.current += 1;
    console.log(`[DIAG:render:${componentName}] render #${renderCount.current}`);
  }
}
```

### Layer 3: URL query parameter (optional convenience)

```
?diag=1
```

- Parsed on app mount. If present, automatically sets `localStorage.ERAGEAR_DIAGNOSTICS=1` and prompts server to enable diagnostics for that session (via a custom header or tRPC context flag). This provides a one-shot enablement path without manual env/localStorage setup.

### Gating enforcement

- The `isDiagnosticsEnabled()` check is the **single source of truth** for all gating.
- No probe point may call `console.log`, `performance.now`, or any measurement API without first checking this gate.
- The gate **cannot** be bypassed by any production code path — there is no `force` parameter or override in non-dev builds.
- Diagnostic wrappers are tree-shakeable in production builds (conditional branches eliminated by bundler when `ERAGEAR_DIAGNOSTICS` is not set).

## Minimum implementation files

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `apps/server/src/shared/utils/diagnostics.util.ts` | **CREATE** | `isDiagnosticsEnabled()`, `diagnosticMeasure()`, `diagnosticLog()`, `diagnosticPayloadSize()` — shared server-side diagnostic wrappers |
| 2 | `apps/server/src/shared/utils/diagnostics.util.test.ts` | **CREATE** | Verify gating: no-op when ERAGEAR_DIAGNOSTICS unset, active when set |
| 3 | `apps/web/src/hooks/use-diagnostics.ts` | **CREATE** | `useDiagnostics()`, `useDiagnosticRenderCount()`, `useDiagnosticTiming()` — shared client-side diagnostic hooks |
| 4 | `apps/web/src/hooks/use-diagnostics.test.ts` | **CREATE** | Verify localStorage gating and URL param parsing |
| 5 | `apps/server/src/infra/acp/connection.ts` | **EDIT** | Add S1 probe: message size log on ndjson receive |
| 6 | `apps/server/src/modules/session/application/session-acp-bootstrap.service.ts` | **EDIT** | Add S2 probe: bootstrap payload size + duration |
| 7 | `apps/server/src/shared/utils/session-config-options.util.ts` | **EDIT** | Add S3 probe: derivation duration + array lengths pre/post cap |
| 8 | `apps/server/src/platform/acp/update.ts` | **EDIT** | Add S4 probe: configOptions update payload size + broadcast size |
| 9 | `apps/server/src/modules/session/application/get-session-state.service.ts` | **EDIT** | Add S5 probe: tRPC response payload size |
| 10 | `apps/server/src/transport/trpc/routers/session.ts` | **EDIT** | Add S6 probe: tRPC handler wall-clock |
| 11 | `apps/server/src/modules/session/infra/runtime-store.ts` | **EDIT** | Add S7+S8 probes: broadcast payload size/frequency, buffer size |
| 12 | `apps/server/src/infra/storage/json-store.ts` | **EDIT** | Add S9 probe: write duration + frequency |
| 13 | `apps/server/src/modules/ai/application/set-model.service.ts` | **EDIT** | Add S10 probe: validation path timing |
| 14 | `apps/server/src/modules/ai/application/set-config-option.service.ts` | **EDIT** | Add S11 probe: validation iteration count |
| 15 | `apps/server/src/infra/acp/tool-calls.ts` | **EDIT** | Add S12 probe: tool result size + call frequency |
| 16 | `apps/server/src/shared/utils/event-bus.ts` | **EDIT** | Add S13 probe: event emission rate |
| 17 | `apps/server/src/bootstrap/server.ts` | **EDIT** | Add S14 probe: process memory + event loop lag snapshot |
| 18 | `packages/shared/src/chat/use-chat-core.ts` | **EDIT** | Add C2+C3 probes: applySessionState + handleConfigOptionsUpdate timing |
| 19 | `apps/web/src/hooks/use-chat-session-state-sync.ts` | **EDIT** | Add C1+C4 probes: hydration timing + state update count |
| 20 | `apps/web/src/components/chat-ui/chat-interface.tsx` | **EDIT** | Add C5 probe: selectionState derivation + render count |
| 21 | `apps/web/src/components/chat-ui/chat-input.tsx` | **EDIT** | Add C6+C7+C8 probes: map/filter timing + Profiler |
| 22 | `apps/web/src/hooks/use-chat-session-event-handler.ts` | **EDIT** | Add C9 probe: WS event processing latency |

**Files explicitly NOT touched:**
- `packages/shared/src/chat/event-schema.ts` / `types.ts` — no schema changes
- `apps/server/src/modules/*/domain/**` — no domain entity changes
- `apps/native/**` — out of scope
- `apps/server/src/modules/*/infra/*.repository.json.ts` — no persistence schema changes
- Any test files except the new diagnostic utility tests

## Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | **Diagnostic code leaks to production** — if the gating check is bypassed or removed, `console.log` spam degrades production performance | LOW | HIGH | Single-source-of-truth `isDiagnosticsEnabled()` gate. All probe wrappers early-return when gate is closed. Code review checklist item. |
| R2 | **Measurement perturbs measurement** — `performance.now()` calls and `console.log` I/O add overhead that distorts timing data | MEDIUM | MEDIUM | Measurements log relative deltas, not absolute wall-clock. Compare against a no-diagnostics baseline run to subtract measurement overhead. Use `diagnosticMeasure` wrapper that only logs after `fn()` completes. |
| R3 | **localStorage flag persists across sessions** — user enables diagnostics, forgets to disable, then reports "lag" caused by diagnostics overhead | HIGH | LOW | Diagnostics banner in UI when active: "[DIAGNOSTICS ACTIVE] — may impact performance. Disable: localStorage.removeItem('ERAGEAR_DIAGNOSTICS')". Auto-disable after 24h via timestamp check. |
| R4 | **Diagnostic logs fill console, obscuring other output** — 14 server probes + 9 client probes can produce high-volume log output during init | HIGH | MEDIUM | Use `console.group`/`console.groupEnd` for structured output. Rate-limit per-probe logging (max 1 log per 500ms per probe). Provide `diagnosticSummary()` that aggregates instead of per-event logs. |
| R5 | **Tool-call probe (S12) intercepts sensitive data** — tool results may contain file contents, env vars, or secrets that should not be logged | MEDIUM | HIGH | Log only metadata (size in bytes, tool name, duration), never the tool result content. Enforce in code review. |
| R6 | **React Profiler (C8) changes component behavior** — React.Profiler in dev mode adds overhead and can alter render timing | LOW | LOW | Only wrap components in Profiler when diagnostics are enabled. Accept minor measurement distortion — Profiler overhead is well-understood and documented by React team. |

## Validation & manual reproduction guidance

### Prerequisites

1. Server started with `ERAGEAR_DIAGNOSTICS=1`:
   ```bash
   cd apps/server && ERAGEAR_DIAGNOSTICS=1 bun run dev
   ```

2. Client diagnostics enabled:
   - Open browser DevTools console
   - Run: `localStorage.setItem('ERAGEAR_DIAGNOSTICS', '1')`
   - Refresh page (or append `?diag=1` to URL for auto-enable)

### Step-by-step reproduction

1. **Start with a clean slate:**
   - Delete existing sessions or start a fresh project to get a full OpenCode init.
   - Ensure OpenCode is configured with a provider that has a large model list (hundreds of entries).

2. **Create a new session:**
   - Via UI: click "New Chat" or equivalent.
   - Observe console output for `[DIAG:...]` prefixed logs.

3. **Send a message that triggers agent init:**
   - Send a simple prompt (e.g., "hello").
   - Agent will initialize, enumerate models, produce config options, run tool calls.

4. **Collect evidence:**
   - Copy all `[DIAG:...]` console output from both server terminal and browser DevTools.
   - Take a Performance profile in Chrome DevTools (Performance tab → Record → reproduce → Stop).
   - Take a React Profiler trace (React DevTools → Profiler → Record → reproduce → Stop).

### Analysis checklist

| Diagnostic gate | Probe(s) to examine | What to look for | Threshold of concern |
|-----------------|---------------------|------------------|---------------------|
| **Payload size** | S1, S2, S4, S5, S7 | Any single payload > 100KB | > 500KB indicates payload bloat |
| **Event frequency** | S1, S7, S13, C9 | Events/sec during init phase | > 50 events/sec indicates flood |
| **Transport** | S5, S6, C1, C9 | tRPC/WS response time, payload size | > 500ms response time |
| **Client state sync** | C1, C2, C3, C4 | Hydration duration, state update count | > 200ms hydration, > 10 state updates in a single batch |
| **React render** | C5, C6, C7, C8 | Render duration per component, render count | > 16ms single render (drops frame), > 5 re-renders per state change |
| **Storage persistence** | S9 | Write duration, writes/sec | > 100ms per write, > 10 writes/sec |
| **Tool output flood** | S12 | Tool call count during init, total result bytes | > 20 tool calls, > 1MB total result bytes |
| **Server pressure** | S14 | Memory delta, event loop lag | > 100MB memory growth, > 50ms event loop lag |

### Synthetic large-payload test (optional)

For deterministic reproduction without an actual large-model-list agent:

```typescript
// Create a test fixture that simulates a session with N models
// In a test file or dev script:
import { createLargeSessionFixture } from './test-fixtures/diagnostics.fixture';

// Simulates session with 500 models, 100 config options, 200 tool results
const session = createLargeSessionFixture({ models: 500, configOptions: 100, toolResults: 200 });
// Feed through the pipeline and observe diagnostic output
```

### Expected outcomes

| Finding | Likely bottleneck | Recommended next action |
|---------|-------------------|------------------------|
| S4/S5 payloads > 500KB despite cap | configOptions for non-model categories are large | Cap non-model configOptions or implement pagination |
| S7 broadcast > 100KB/sec sustained | WebSocket broadcast amplification | Implement diff-based configOptions updates, throttle broadcasts |
| S12 > 20 tool calls during init | Agent is running excessive tool calls | Configure agent to reduce init-time tool calls or stream results incrementally |
| C5/C6/C7 > 16ms per render | React component rendering cost is high even with 100 items | Memoization, virtualization, or further reduce cap to 50 |
| C4 > 10 state updates per hydration | State update batching inefficiency | Coalesce state updates, use `useReducer` instead of multiple `useState` |
| S8 message buffer > 100 events | Replay buffer bloated | Cap or summarize replay buffer for reconnecting clients |
| S9 > 100ms per write | JSON store I/O bottleneck | Batch writes, use async write, or defer non-critical persistence |
| S14 > 50ms event loop lag | Server CPU/memory pressure | Profile server with Node.js inspector, identify CPU hotspot |

## Triage calibration

- **complexity_assessment:** MATCHED (triage said 78 — correct; the multi-layer instrumentation across server transport, client state, and React render requires careful coordination of 22 files with gating discipline)
- **risk_assessment:** LOWER (triage said 68 — actual risk is lower because diagnostics are dev-only gated; the main risk is accidental production activation, which the 3-layer gate design mitigates)
- **suggested_executor:** team-heavy
  **rationale:** The change surface spans 22 files across server, shared, and web packages. The diagnostic wrappers must be applied consistently with proper gating in each probe location. This is a cross-cutting instrumentation task requiring synchronized edits in server infrastructure, application services, shared state machine, and client hooks/components. The gating design must be reviewed for correctness before any probe code is merged.

## Blockers

- **none** — User approved dev-only diagnostics gate (RUN-INDEX.md line 15). Explorer mapping is complete. Safe to create T06 diagnostics implementation ticket for team-heavy.

# Documentation Gaps Review

Scope: public module seams in `src/modules/**`, shared ports, and shared
contracts. This review intentionally avoids blanket JSDoc. Comments should be
added only where callers need to understand invariants, side effects, error
modes, ordering, or adapter expectations.

## Module Findings

- `use-cases`: `AppUseCases` is the primary transport-facing interface. It
  needed contract docs so routers do not reintroduce service factories or
  construct use-cases per request.
- `session`: highest gap area. Priority docs are `SessionQueries`,
  `SessionRepositoryPort`, `SessionRuntimePort`, ACP buffering, and lifecycle
  orchestration. Legacy read services are compatibility wrappers and should not
  become the documented primary surface.
- `ai`: priority docs are prompt submission ordering, exclusive session locks,
  payload validation, and `AiSessionRuntimePort` adapter error semantics.
- `tooling`: priority docs are permission response ordering and the Git/code
  context port security boundary.
- `supervisor`: priority docs are model-decision, memory, research, and audit
  ports because these define what context can leave the runtime and what must
  be durable.
- `settings`: priority docs are runtime app config reload behavior and boot
  allowlist persistence, because some changes are live and some require restart.
- `agent` and `project`: CRUD services are mostly shallow, but docs are useful
  where they publish dashboard events, normalize paths, maintain active IDs, or
  enforce tenant ownership.
- `auth` and `ops`: docs are useful at the read facade level because they shape
  authenticated user/dashboard views.
- `shared`: ports needed contract-level docs for ordering, async behavior, and
  whether calls are fire-and-forget or durable.

## Review Policy

- Do not require 100% JSDoc coverage.
- Do not document private helpers unless the helper encodes a non-obvious
  invariant.
- Do not add comments that merely restate a type signature.
- Prefer one high-signal JSDoc block on an exported interface/class over many
  low-signal method comments.
- Biome should enforce architecture imports, not blanket comment coverage.

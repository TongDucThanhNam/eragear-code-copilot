# Eragear Design System — Operational Surfaces

Design guidance for coding agents working on Eragear's operational UI,
starting with the Supervisos Run Center and Run Workspace. When generating or
editing UI in this area, follow this file before inventing new visual rules.
General renderer conventions (spacing, radius, shadcn primitives) follow the
existing Tailwind v4 + shadcn setup; this document defines the *workflow
status* layer on top.

## Product character

Eragear's Supervisos surfaces are an **inspectable supervisor**, not a chat
with a stack of generic SaaS cards. The user must be able to answer three
questions at a glance:

1. What is running?
2. Why has it stopped?
3. Does it need me? If not, what makes it eligible to continue?

Design for long sessions, high information density, calm structure, honest
evidence, and readable light/dark themes. Avoid oversized headings, KPI-card
walls, decorative gradients, and raw enum names as user copy.

## The one invariant: agent identity is not status

- **Agent identity color** comes from a fixed eight-hue identity palette
  (`--agent-identity-1…8`), assigned by a stable hash of the agent id. An
  agent keeps the same hue across stations, attempts, statuses, and themes.
- **Workflow status** comes exclusively from the semantic status tokens below.
- Never encode status in identity color, and never derive identity from
  status. State changes may not recolor an agent.

## Semantic status tokens

Defined in `apps/desktop/src/renderer/index.css` (`:root`, `.dark`,
`@theme inline`) and mapped from the shared vocabulary in
`packages/shared/src/workflow/status.ts`. UI code consumes the *tone* from the
shared vocabulary and renders it with these tokens; components never pick raw
palette colors (no `emerald-500`, `amber-500`) for workflow state.

| Token                     | Used for                                                                  |
| ------------------------- | ------------------------------------------------------------------------- |
| `--status-success`        | Completed with trusted evidence or explicit acceptance (`text-status-success`) |
| `--status-warning`        | Machine warnings that are not human attention                             |
| `--status-failed`         | Failures with evidence on record (aliases `--destructive`)                 |
| `--status-running`        | Active, calm progress. Running is normal; it must not look like a warning  |
| `--status-attention`      | `interaction.waiting-human`: plan approval, decisions, user gates          |
| `--status-waiting`        | Durable waits that resolve without the user (quota, dependency, retry)     |
| `--status-planned`        | Not-started / queued / ready upcoming work                                |

Tone semantics (from the shared package, binding for every surface):

- **Waiting for a human is not a failure.** `attention` ≠ `failed`; old code
  that rendered `needs_user` as destructive was wrong.
- **Waiting for quota is not scheduled automation.** Capacity waits show their
  cause and, only when provider evidence exists, an approximate reset time.
- **Paused is not automatic retry.** Paused runs stay put until resumed.
- **Uncertainty is displayed.** Recovering/uncertain attempts are their own
  state, never silently "running" and never green.
- **Missing evidence is never success.** A null verifier exit code is
  "waiting for evidence", not a pass.

## Workflow structure tokens

For the run timeline and lifecycle spine (`--workflow-*`):

- `--workflow-rule`: sub-hairline for repeated furniture (weaker than
  `--border`). Never as a general separator.
- `--workflow-trace` / `--workflow-trace-strong`: rail/arc stroke ramp — not
  yet taken vs. control has passed.
- Graph overflow is constrained to the graph container; the page never
  scrolls horizontally because of it.

## Typography and density

- Follow the existing renderer scale (`text-xs` … `text-xl`). Dense
  operational rows use `text-xs` metadata with `text-foreground-subtle`.
- Monospace (`font-mono`) for ids, hashes, commands, model ids, checkpoint
  shas — placed in details, not headlines.
- Hierarchy per row: Goal/run title (medium weight) → current activity or
  wait reason → agent identity → supporting metadata. Opaque ids and
  revisions live one level down (title attributes, detail panels).

## Components specific to Run Center

- `StatusBadge`: tone → token mapping plus icon and label from the shared
  vocabulary. One badge component everywhere; no per-surface renames.
- `AgentPill`: identity-colored avatar dot + name + status mark. Clickable
  only when a real chat binding exists; otherwise an inert "Not started"
  placeholder with no invented chat id.
- `SupervisorWorkflowTimeline`: stations on a lifecycle rail, real dependency
  arcs between stations, worker pills under stations. Independent tasks get
  **no** invented arrows. Malformed or missing graph data renders a readable
  fallback (input order, notice), never a crash or fabricated links.
- Waiting rows name cause + owner: unmet dependency titles, provider/agent
  capacity, repository writer, retry eligibility, authentication, human
  decision, or paused. Countdowns are display-only, minute-approximate
  ("in ~4m"), respect reduced motion, clean up on unmount, and never trigger
  scheduling from the renderer.
- Needs Attention unifies plan approval, decisions, user-approvable gates,
  cancellation cleanup, and worker-chat permission links while **preserving
  their distinct authorities**: machine gates (baseline drift, conflict,
  verification) are shown but not user-approvable; accept and waive stay
  separate; a changed plan is never auto-approved.

## Accessibility and motion

- Keyboard: stations, pills, and attention actions are real buttons with
  visible focus (`focus-visible:ring-*`); the lifecycle spine doubles as the
  accessible list alternative to the graph.
- Never color alone: tone is always paired with an icon or text label.
- Reduced motion: no spinning indicators beyond the shared spinner conventions,
  no autonomous animations; countdown text updates without motion.
- Long labels truncate with `min-w-0` + `title`; layouts must survive
  translation and narrow viewports without overlap.

## Do / Don't

- Do reuse `StatusBadge`, `AgentPill`, and the shared vocabulary functions.
- Do keep the renderer read-only over workflow facts: formatting, projection,
  and existing authenticated actions only.
- Don't add a second status mapping "just for this component".
- Don't present chat prose as verification proof, or a derived snapshot list
  as the persisted journal.
- Don't promise resumption while any blocker remains.

# GOAL Progress - Electron ADE Overnight Sprint

Updated: 2026-06-11 15:43 UTC / 2026-06-11 22:43 Asia/Saigon

## Current Result

Status: PARTIAL PARITY, not full ZCode parity.

This run converted the previously partial ADE parity work into working Electron
flows for the required core surfaces. The app still should not be described as a
finished clone of ZCode, but the core ADE acceptance set now passes from the
Electron/private desktop-service path.

This continuation hardened provider readiness beyond version checks for Codex.
`settings.testProvider` now runs `codex doctor --json` where available, parses
the full raw JSON report before diagnostic truncation, classifies CLI/auth/model
readiness separately, surfaces the configured model, and keeps diagnostics
redacted. Desktop smoke creates a temporary Codex agent descriptor when Codex is
installed but no descriptor exists, probes the real CLI through the private
desktop-service path, then deletes the descriptor and restores provider-health
state so smoke does not leave fake provider records behind. The same slice fixed
Windows command parsing so absolute paths such as `C:\Users\...\codex.exe` keep
their backslashes.

This continuation added real MCP server-pushed notification handling for the
implemented transports. Stdio, streamable HTTP, and SSE probe/invocation paths
now capture JSON-RPC notifications without `id`, classify them as `probe` or
`invocation`, redact runtime env/header secrets, keep bounded history in
`.eragear/mcp-servers.json`, and render the notification timeline in Electron.
Unit tests and desktop smoke now assert both notification capture and redaction.

This continuation added MCP chat command invocation v0. When the Local ADE
snapshot has an enabled, trusted, initialized MCP server with discovered tools,
the chat slash menu exposes `/mcp`. Submitting `/mcp <tool> {"arg":"value"}` or
`/mcp <server>/<tool> {"arg":"value"} -- <request>` resolves the discovered
server/tool, enforces the same trust/initialize/discovery gates as the MCP
panel, calls `settings.invokeMcpTool`, and sends the redacted tool result into
the normal `sendMessage` path as a real agent prompt. This is manual tool
invocation from chat, not autonomous agent-side MCP routing.

This continuation also fixed agent-side MCP session injection. The session MCP
resolver now reads trusted project-local `.eragear/mcp-servers.json` entries in
addition to legacy settings MCP servers, verifies the same fingerprint material
used by Local ADE trust, resolves remote header-env values only at runtime, and
passes trusted MCP server configs into ACP `session/new`/`loadSession`.
Desktop smoke creates a temporary trusted MCP server and a capture ACP agent,
then verifies `MCP_SESSION_INJECTION` with one injected stdio MCP server in the
actual ACP `session/new` payload.

This continuation added an MCP agent-routing preview to the Local ADE snapshot
and Electron MCP panel. Project-local MCP servers now show whether they are
directly injectable into ACP session setup, conditional on an agent-advertised
HTTP/SSE MCP capability, blocked by trust/config/header policy, or skipped
because disabled. The preview exposes only redacted route metadata and header
env key names. Desktop smoke now verifies `MCP_AGENT_ROUTING` with one stdio
route marked `injectable`, one SSE route marked `conditional`, zero smoke-route
blockers, and no leaked `Bearer desktop-mcp-secret` value.

This continuation converted project-local stdio MCP agent routing from
injection-only to brokered execution. ACP sessions now receive an Eragear stdio
MCP broker command for trusted project-local stdio servers instead of the raw
server command. The broker reloads `.eragear/mcp-servers.json` before each
tool/resource request, blocks disabled/untrusted/changed fingerprints, forwards
allowed JSON-RPC to the target MCP server, redacts secret values from responses,
and writes bounded audit entries to `.eragear/mcp-agent-audit.jsonl`. Local ADE
snapshots and the Electron Agent Session Routing panel now show broker mode,
recent agent-side call counts, and the latest brokered call. Desktop smoke
verifies `MCP_SESSION_BROKER` by spawning the injected broker from the captured
ACP `session/new` payload, calling `tools/call`, and observing a successful
broker audit in the Electron snapshot.

This continuation also made the MCP agent broker resolvable in both dev and
built server layouts. The server build copies `src/runtime/mcp-agent-broker.js`
to `dist/runtime/mcp-agent-broker.js`, and the session MCP resolver can locate
the source runtime, bundled dist runtime, or explicit
`ERAGEAR_MCP_AGENT_BROKER_*` overrides before injecting the broker command.

This continuation added bounded SSE MCP reconnect/replay for discovery probes.
When a remote SSE stream closes before protocol discovery completes, the server
opens one replacement stream, records a `stream-reconnect` probe step, and
replays pending discovery JSON-RPC requests such as `initialize`. This is
verified by a unit fixture that drops the first stream before responding and by
desktop smoke through `desktop-service`, which reports `reconnect.verified:
true` for the SSE MCP discovery path.

This continuation added bounded SSE MCP reconnect policy for invocation. When
an SSE stream drops before a pending `resources/read` response, the server opens
one replacement stream and replays the safe resource request. When the pending
request is side-effecting `tools/call`, the server does not replay it and
returns an exact diagnostic explaining that automatic replay was blocked by
policy. Unit tests cover both branches, and desktop smoke verifies
`MCP_SSE_RESOURCE_RECONNECT` with two `resources/read` requests and a successful
redacted result through `desktop-service`.

This continuation moved project slash commands from descriptor-only discovery
to a real chat invocation path. `.eragear/commands/**/*.md` and compatible
`.claude/commands/**/*.md` files now produce invokable command descriptors with
prompt body and argument hints. The chat UI command list uses those descriptors,
and `/command args` expands into a real prompt before `sendMessage`.

The next continuation did the same for local skills and output styles. Skill
Markdown now produces invokable descriptors with prompt bodies; users can invoke
skills manually with `@skill-name` or `/skill-name`. Output styles can be
invoked with `/style-name`, and the selected style wraps the user request before
`sendMessage`.

This continuation added a usable Project Index/Repo Snapshot flow. Electron can
now refresh repository metadata and bounded code signals through
`settings.refreshProjectIndex`, the server writes `.eragear/repo-index.json`,
and the Local ADE Control Center shows indexed file count, byte total,
extension summary, diagnostics, code symbols, task markers, and a file list. The
index still skips generated/dependency/checkpoint directories.

This continuation also moved hooks beyond a fake blocked surface. Project-local
manual hooks can now be saved to `.eragear/hooks.json`, toggled, executed from
Electron, and inspected with redacted stdout/stderr plus run status.

This continuation also wired the first concrete lifecycle hook events. Enabled
hooks whose event matches `after-project-index-refresh`,
`after-checkpoint-create`, or `after-checkpoint-restore` execute automatically
after those actions, persist run results, and do not expose secret-looking
output values.

This continuation hardened hooks from executable v0 into a guarded execution
surface. Project-local hooks now derive a `sha256:` fingerprint from command,
args, working directory, event, and approved environment-key allowlist.
Electron shows `trusted`, `untrusted`, or `changed`, disables Run while review
is required, and demotes hook capabilities until the current fingerprint is
trusted. Hook child processes no longer inherit the full server environment;
they receive a small base process environment, Eragear hook context, and only
explicitly approved env keys, with stdout/stderr redacted before persistence.

This continuation moved plugins from a disabled placeholder to an executable
project-local flow. `.eragear/plugins.json` stores plugin descriptors and
recent runs. Electron can save, toggle, run, and inspect plugin stdout/stderr.
Plugin commands run without shell expansion, are constrained to the project
root for cwd, and redact secret-looking output.

This continuation connected Project Index to the chat workflow. The new
`settings.searchProjectIndex` API searches persisted file metadata, code
symbols, and task markers, returns a bounded agent-context prompt, and the chat
input exposes `/index <query>` as a built-in command that sends that context to
the agent through the normal `sendMessage` path.

This continuation also moved Project Index retrieval from manual-only to
automatic chat context v0. When the index is ready, normal chat prompts can
fetch top Project Index matches before `sendMessage` and submit the generated
context prompt. The auto path deliberately does not override explicit slash
commands, `@skill` invocation, attached files, or `@file` mentions.

This continuation moved Project Memory from review/toggle-only to a real
per-message chat context path. `settings.buildProjectMemoryContext` reads
enabled project memory sources on the server, applies bounded redaction, and
returns an agent prompt. Chat now exposes `/memory <request>` plus
`/memory --source <path> <request>` for source-selective attachment, can
automatically attach enabled project memory to normal prompts, and composes
memory context with automatic Project Index context when both are available.
The first-screen Next Actions rail now includes a real `/memory <request>`
action when enabled memory exists, and routes setup states back to the Project
Memory section.

This continuation added a visible Project Memory source picker to the chat
action menu. The picker lists enabled memory sources from the Local ADE snapshot,
preserves an existing draft as the `/memory` request when safe, and inserts
either `/memory <request>` or `/memory --source <path> <request>` into the
normal chat input path. It does not create a second invocation path; submit
still flows through the existing parser and `settings.buildProjectMemoryContext`.

This continuation closed the MCP SSE discovery gap. SSE MCP entries can now
store a separate message endpoint, open the event stream, initialize over the
message endpoint, and discover tools/resources from JSON-RPC responses delivered
through SSE events. The UI exposes the message endpoint field without exposing
headers or secret values.

This continuation hardened remote MCP auth/header handling. HTTP and SSE MCP
entries can now map remote headers to environment variable keys, the server
resolves those values only at runtime, stores no secret header values, rejects
literal secret-looking headers such as `Authorization` and `Cookie`, reports
missing env keys by name, and the Electron UI shows only header-to-env-key
mapping plus present/missing state.

This continuation also removed the repo-wide server typecheck blocker. ACP
session config options now handle both select and boolean option payloads,
server/shared chat contracts agree on that union, ACP SDK drift around
`listSessions` and terminal kill types is resolved, async runtime port
contracts are reflected in production services and tests, and the affected
test fixtures were updated without weakening the runtime paths.

This continuation made checkpoint preview conflict-aware. Preview now returns
per-file `restoreRisks` with `safe`, `warning`, or `blocked` level, patch
action, checkpoint/current status summaries, and the reason behind the restore
risk. Electron renders the risk matrix before guarded restore.

This continuation added checkpoint session-turn attribution. Checkpoints now
capture active chat id, agent session id, agent label, chat status, message
count, latest message preview, active/completed turn ids when available, and
runtime counters. The checkpoint list and preview render that attribution so
change trust is tied to the agent workflow, not just a detached patch file.

This continuation added a real plugin trust gate. Project-local plugins now
derive a `sha256:` execution fingerprint from command, args, and working
directory. Electron shows `trusted`, `untrusted`, or `changed`, run is disabled
until the current fingerprint is trusted, capability registry activation is
demoted until trust, and changing the command invalidates prior trust.

This continuation hardened plugin execution policy. Project-local plugins now
carry explicit scopes plus an environment-key allowlist. Plugin runs no longer
inherit the full server environment; only a small base process environment,
Eragear plugin context, and approved env keys are passed to the child process.
The execution fingerprint includes scopes and env keys, so changing plugin
permissions invalidates prior trust. Electron shows plugin scopes and approved
env-key names without exposing secret values.

This continuation also made checkpoint preview a structured side-by-side review
surface. The server parses unified patches into bounded per-file hunks with old
and new line cells, additions/deletions, status, binary/truncation metadata, and
Electron renders that before the raw patch.

This continuation added guarded selected-file checkpoint restore. Users can now
tick files in the checkpoint diff preview, type the same restore token, and
restore only those files. The server filters the stored patch to exact selected
`diff --git` sections, validates selected-file status and `git apply --check`,
creates a selected-file safety checkpoint first, records `partialRestores`, and
leaves unrelated workspace changes untouched.

This continuation added guarded selected-hunk checkpoint restore. Users can now
tick individual hunks in the structured checkpoint diff preview, type the same
restore token, and restore only those hunk patches. The server filters the
stored patch to selected `@@` hunk blocks, validates the filtered patch with
`git apply --check`, creates a patch-backed selected-hunk safety checkpoint
first, records the hunk metadata in `partialRestores`, and preserves other hunks
in the same file.

This continuation improved the first-screen Electron ADE workflow surface. The
Local ADE Control Center now opens with an Operate strip that exposes the real
core actions in one dense row: start a session, refresh runtime diagnostics,
probe providers, probe MCP discovery, create a checkpoint, and copy the primary
manual subagent slash command. The strip summarizes runtime state, active
sessions, enabled capabilities, provider readiness, MCP initialization,
checkpoint/change state, and the invokable subagent command before the deeper
diagnostic sections.

This continuation also added a redacted ACP Activity surface to Electron.
Desktop-service console capture now writes structured ACP log events into the
local log store without contaminating the stdio protocol channel. The Local ADE
snapshot filters those events to the current user or owned chats, aggregates
level/kind/chat counts, exposes event kind plus payload byte counts, and strips
all `rawPayload*` metadata before the renderer receives it.

This continuation tightened the first-screen UX again. The previous single
Operate strip is now a two-pane Workspace Run Loop / Workflow Readiness deck:
primary actions stay in the first viewport, while tested workflow lanes show
agent loop, provider, MCP, change trust, project context, and subagent readiness
with real snapshot-derived state. The goal is to make the first screen scan
like an ADE cockpit instead of a long diagnostic report.

This continuation tightened the first-screen UX one more step. The Workspace Run
Loop now includes an Active Workspace/Workspace Standby focus area that derives
from the live snapshot: active agent session, pending permissions/tool calls,
checkpoint/change-set state, latest MCP signal or trust warning, and ACP
activity correlation. This moves the first viewport toward a work surface users
can operate from instead of only a readiness summary.

This continuation made the first screen more directly operable. The Workspace
Run Loop now includes a tested Next Actions rail derived from the same runtime
snapshot. Each action routes to a real path: start session, provider probe, MCP
probe via `settings.probeMcpServer`, checkpoint capture, Project Index refresh,
or copying an invokable chat command such as `/index <query>` and
`/agent-code-reviewer`. Setup or blocked surfaces route to their detail sections
instead of pretending to be implemented.

This continuation made ACP observability exportable. `settings.exportAcpActivity`
returns a schema-versioned, redacted ACP trace artifact filtered to an owned chat
or owned user-visible traffic, and Electron exposes a Copy Trace action from the
ACP Activity panel. Desktop smoke now calls the export action through the
private runtime service and asserts the trace is redacted, filtered to the active
chat, and free of `rawPayload*` metadata.

This continuation added ACP activity correlation summaries. The Local ADE
snapshot and trace export now group ACP events by turn id, agent session id,
chat id, or source, preserve first/last timestamps, duration, level/kind counts,
and latest message, and Electron renders those summaries above the event list.
The desktop smoke asserts the exported trace contains a correlation for the
active chat.

This continuation added ACP Activity Replay v0. `settings.replayAcpActivity`
uses the same user/owned-chat filtering and redaction policy as trace export,
then returns chronological replay frames with stable sequence, elapsed time,
delta time, correlation key/label, payload byte count, and safe metadata only.
Electron exposes Replay controls in the ACP Activity panel, including play,
pause, previous, next, and per-correlation replay. Desktop smoke calls the
mutation through `desktop-service` for the active chat and verifies redacted
chronological frames.

This continuation added structured MCP probe timelines. Each MCP protocol probe
now reports sanitized step-level results for header policy, executable resolve,
process spawn, SSE stream open, endpoint resolution, initialize,
notifications/initialized, tools/list, and resources/list where applicable.
Electron renders the probe status, step counts, failed steps, recent timeline,
and a visible Retry control that re-runs the real probe path.

This continuation made MCP Retry a first-class server action. Electron now calls
`settings.probeMcpServer` for the selected MCP server instead of refreshing the
whole snapshot, and the server persists a bounded redacted probe history in
`.eragear/mcp-servers.json`. Probe history survives reloads and shows the last
run status, duration, protocol status, discovered counts, failed step count, and
sanitized diagnostics.

This continuation moved MCP beyond discovery into manual invocation. Electron
now exposes Run controls for discovered tools and Read controls for discovered
resources. The server initializes the selected MCP server over stdio, streamable
HTTP, or SSE message endpoint, calls `tools/call` or `resources/read`, returns
bounded structured content plus text/JSON previews, and redacts runtime env or
header secrets before the renderer sees the result.

This continuation made MCP invocation auditable instead of one-shot only.
Successful and failed `tools/call` / `resources/read` runs now persist bounded
redacted invocation history in `.eragear/mcp-servers.json`, survive snapshot
reloads, and render an Invocation Audit section in Electron without exposing
runtime env or remote header secret values.

This continuation added an MCP invocation trust gate. Each MCP server now has a
redacted execution fingerprint derived from transport command/URL, args, env
material hashes, literal header hashes, and header-env mapping. Electron shows
`trusted`, `untrusted`, or `changed`, exposes a Trust action, disables Run/Read
until trusted, and the server blocks tool/resource invocation before protocol
execution when the current fingerprint is not trusted. Blocked attempts are
recorded in the same redacted invocation audit history.

This continuation broadened hook lifecycle execution into the real agent
session loop. Session create, prompt submission, and session stop now publish
Local ADE lifecycle events; LocalAdeService consumes those events and executes
matching project hooks for `after-agent-session-create`,
`after-agent-message-send`, and `after-agent-session-stop` without blocking the
primary chat action. Hook processes receive bounded session context through
environment variables such as `ERAGEAR_CHAT_ID`,
`ERAGEAR_AGENT_SESSION_ID`, `ERAGEAR_TURN_ID`, and `ERAGEAR_PROJECT_ID`.

## Implemented In This Run

- MCP probe now performs protocol `initialize`, sends
  `notifications/initialized`, and calls `tools/list` plus `resources/list` for
  stdio servers. Streamable HTTP has a JSON-RPC POST discovery path. SSE opens
  the event stream and uses a configured or endpoint-event message endpoint for
  protocol discovery.
- Remote MCP HTTP/SSE auth headers now use a header-env policy: header names are
  stored with env key names, secret values are resolved only for runtime
  requests, literal secret-looking headers are rejected, missing env keys are
  surfaced as protocol diagnostics, and UI snapshots expose only redacted
  present/missing metadata.
- MCP UI now shows protocol status, discovered tool/resource counts, discovered
  tool/resource names, exact JSON-RPC protocol errors in diagnostics, and a
  structured probe timeline with per-server retry and persisted history.
- MCP UI also now has manual invocation controls for discovered tools/resources.
  `settings.invokeMcpTool` and `settings.readMcpResource` initialize the
  configured server and run `tools/call` or `resources/read` over stdio,
  streamable HTTP, or SSE message endpoints. Results are bounded, structured,
  and redacted before rendering. `settings.trustMcpServer` now persists trust
  for the current MCP invocation fingerprint, and untrusted or changed
  fingerprints block invocation before protocol execution while preserving a
  redacted failed audit entry. SSE invocation now has bounded reconnect policy:
  `resources/read` is replayed once after stream loss, while side-effecting
  `tools/call` is not replayed automatically and returns a policy diagnostic.
- Provider test now stores separate `cliStatus`, `authStatus`, `modelStatus`,
  `readiness`, version, and discovered model identifiers. Secrets are redacted
  by value and only env key names are displayed.
- Codex provider readiness now uses `codex doctor --json` when supported. The
  parser reads the full raw doctor output before truncating UI diagnostics, so
  long redacted doctor reports still classify `auth.credentials`, configured
  model, and provider/websocket reachability. Desktop smoke verifies this with a
  real temporary Codex provider descriptor and cleans it up afterward.
- Checkpoint restore now creates an automatic pre-restore safety checkpoint
  before applying the guarded restore. Safety checkpoints use forward patch
  application so they can re-apply the pre-restore state when safe. Preview
  also reports conflict-aware per-file restore risks before confirmation and
  shows session/turn attribution captured at checkpoint time. Preview now also
  includes structured per-file side-by-side diff hunks before the raw patch.
  Selected-file restore is exposed through `settings.restoreCheckpointFiles`;
  it filters patches by exact file section, creates selected-file safety
  checkpoints, records partial restore history, and can restore safe files even
  when unrelated workspace changes block full restore. Selected-hunk restore is
  exposed through `settings.restoreCheckpointHunks`; it filters patch sections
  to selected hunk blocks, creates hunk-scoped safety checkpoints, records hunk
  metadata in partial restore history, and can restore one hunk while leaving
  another hunk in the same file unchanged.
- Chat subagent invocation was factored into a tested helper. Enabled subagents
  appear as `/agent-*` commands, and `/agent-code-reviewer` expands into a real
  delegated prompt path before `sendMessage`. Desktop smoke now verifies both
  `SUBAGENT_COMMAND_READY` and `SUBAGENT_COMMAND_SUBMIT`, including that the
  expanded prompt contains the delegated `code-reviewer` profile and the user
  request before the normal chat send path accepts it.
- Local slash commands are now invokable from chat. Command Markdown frontmatter
  and body are exposed through the Local ADE snapshot, disabled commands do not
  invoke, and `$ARGUMENTS` / `{{arguments}}` placeholders are replaced before the
  prompt is submitted.
- Local skills and output styles are now invokable from chat. Skills support
  manual `@skill-name` and `/skill-name` invocation; output styles support
  `/style-name` invocation. Disabled descriptors do not invoke.
- Project Index v0 is now an executable Electron workflow. The server scans
  repository metadata with bounds, skips `.git`, dependency/build directories,
  and `.eragear/checkpoints`, extracts bounded code-symbol and task-marker
  signals, writes `.eragear/repo-index.json`, and exposes a refresh/inspect
  surface in the Local ADE Control Center.
- Project Index retrieval v0 is now connected to chat. `settings.searchProjectIndex`
  ranks indexed files, symbols, and task markers, builds a bounded prompt that
  tells the agent to read referenced files before editing, and `/index <query>`
  invokes that retrieval path from chat.
- Project Index retrieval v0 now also has automatic chat attachment for normal
  prompts. The renderer searches the ready index before submission, attaches
  bounded top matches when available, and leaves explicit commands/skills/files
  untouched.
- Project Memory retrieval v0 is now connected to chat. `settings.buildProjectMemoryContext`
  reads enabled memory sources on the server, redacts secret-looking values,
  respects a bounded context budget, and `/memory <request>` submits that prompt
  through the normal chat `sendMessage` path. `/memory --source <path>
  <request>` and `/memory -s <path> <request>` select specific enabled memory
  sources by relative path. The chat action menu now exposes a Project Memory
  source picker that inserts the same command path for all enabled sources or a
  selected source. Normal prompts can also attach enabled memory automatically
  when the user has not already supplied explicit files, mentions, slash
  commands, or skill commands.
- Manual Hook Runner v0 is now executable. `.eragear/hooks.json` stores
  project-local hook descriptors, approved env-key allowlists, trust metadata,
  and recent runs. Hooks run through `spawn` without shell expansion, are
  constrained to the project root for cwd, no longer inherit the full server
  environment, redact secret-looking output, persist run history, require trust
  approval for the current execution fingerprint, and appear as active `hook`
  capabilities only after that fingerprint is trusted.
- Hook lifecycle v0 is now executable for six explicit events:
  `after-project-index-refresh`, `after-checkpoint-create`,
  `after-checkpoint-restore`, `after-agent-session-create`,
  `after-agent-message-send`, and `after-agent-session-stop`. Lifecycle hook
  failures are recorded as failed hook runs without breaking the primary user
  action, and agent-session hooks receive chat/session/turn context through
  redacted environment variables.
- Project-local Plugin Runner v0 is now executable. `.eragear/plugins.json`
  stores plugin descriptors, permission scopes, env-key allowlists, and run
  history. Plugins run through `spawn` without shell expansion, use
  project-root-guarded cwd, no longer inherit the full process environment,
  persist redacted stdout/stderr, require trust approval for the current command
  plus permission fingerprint, and appear as active `plugin` capabilities only
  after that fingerprint is trusted.
- Server typecheck is green again. The fix covered ACP config-option
  select/boolean unions, stable `listSessions` discovery, renamed kill-terminal
  SDK types, async session runtime/broadcast contracts, boot allowlist runtime
  toggle names, SQLite worker overloads, Git `Dirent` typing, and redaction
  reason literal typing.
- Desktop smoke now verifies MCP protocol discovery through the private runtime
  service with real stdio and SSE JSON-RPC fixtures, verifies provider CLI readiness,
  verifies OpenCode readiness, creates a temporary Codex provider descriptor and
  verifies `codex doctor --json` classifies CLI/auth/model as ready with model
  `gpt-5.5`,
  verifies structured MCP probe steps and persisted probe history for stdio and
  SSE discovery, verifies untrusted MCP invocation is blocked and audited,
  verifies `settings.trustMcpServer` for stdio and SSE fingerprints, verifies
  stdio MCP `tools/call` plus `resources/read`, verifies persisted redacted
  invocation audit entries for blocked and successful calls, verifies SSE MCP
  `tools/call` with header-secret redaction, verifies SSE MCP `resources/read`
  reconnect/replay after a dropped stream,
  verifies command discovery with a temporary `/desktop-smoke` command, verifies
  temporary skill/output-style descriptors, verifies the `code-reviewer`
  subagent capability is present, refreshes the project index through the
  private service, searches the project index through `settings.searchProjectIndex`,
  builds source-selected Project Memory context through
  `settings.buildProjectMemoryContext`,
  executes a temporary manual hook, verifies an `after-project-index-refresh`
  lifecycle hook, verifies `after-agent-session-create`,
  `after-agent-message-send`, and `after-agent-session-stop` hooks against the
  real Electron session loop, verifies hook trust gating and isolated hook env
  allowlists, verifies plugin trust gating, verifies plugin
  scope/env-key allowlist metadata and secret redaction, then executes a trusted
  temporary plugin through the private service, creates a temporary git project
  with an active agent session to exercise checkpoint restore risk preview,
  structured side-by-side diff preview, selected-hunk restore with hunk safety
  checkpoint, selected-file restore with safety checkpoint, and active-session
  attribution, starts a real session, sends a message, observes assistant
  activity, verifies redacted ACP Activity entries plus correlation summaries
  for that chat, exports a redacted trace, replays chronological ACP frames for
  that chat, and stops cleanly.
- Electron first screen now has a real workflow action strip backed by the
  existing mutations/private-service data. Provider probe and checkpoint actions
  call the same `settings.testProvider` and `settings.createCheckpoint` paths
  used by deeper sections; runtime/MCP actions refresh diagnostics and snapshot;
  the subagent action exposes the actual `/agent-*` command path already wired
  into chat invocation.
- ACP Activity v0 is now visible in Electron. `desktop-service` mirrors
  structured ACP console events into `LogStore`, the Local ADE snapshot returns
  only redacted per-chat activity rows with level, kind, payload byte count, and
  safe metadata, builds chat/session/turn/source correlation summaries, and the
  control center renders those summaries and rows beside the log and parity
  panels.
- First-screen Workflow Readiness lanes are now backed by a tested renderer
  helper. The deck reports session/provider/MCP/checkpoint/context/subagent
  state from `RuntimeDiagnostics` plus the Local ADE snapshot, and keeps absent
  provider/git/index/subagent surfaces visually distinct from ready flows.
- First-screen Next Actions are now backed by the same tested renderer helper.
  The rail produces real actions for session, provider, MCP, checkpoint, Project
  Index, and subagent workflows, and blocked/setup states route to their owning
  sections rather than appearing as fake primary actions.
- ACP trace export v0 is now a real Electron action. The server exposes
  `settings.exportAcpActivity`, applies the same owned-chat/user filter and
  redaction as the panel, caps exports at 500 entries, and the UI copies the
  schema-versioned JSON trace plus correlation summaries from the server action
  instead of copying raw renderer state.
- ACP Activity Replay v0 is now a real Electron action. The server exposes
  `settings.replayAcpActivity`, applies the same owned-chat/user filter and
  redaction as trace export, returns chronological replay frames with sequence,
  elapsed, delta, correlation, kind, payload byte count, and safe metadata, and
  the ACP Activity panel can play, pause, step, or replay a specific
  correlation without exposing raw ACP payloads.

## Completion Rule Status

At least 4 of 5 required Electron flows are working end to end:

| Flow | Status | Evidence |
| --- | --- | --- |
| Real agent session create/send/stop | Pass | Desktop smoke created OpenCode chat `01f5a99f-9207-434a-bb2e-b1797306cb1f` with agent session `ses_148a7e1d5ffekBfMMElP0GsLad`, submitted the expanded `/agent-code-reviewer` prompt, observed assistant activity, and stopped the subscription/session/host. |
| MCP initialize/tool discovery | Pass | Desktop smoke upserted `Desktop Smoke MCP` and `Desktop Smoke SSE MCP`, called `settings.probeMcpServer` for each server, and protocol initialized/discovered `desktop_smoke_tool`, `desktop_smoke_sse_tool`, `desktop-smoke-resource`, and `desktop-sse-resource`. The stdio probe reported resolve/spawn/initialize/initialized/tools/list/resources/list steps plus persisted history. The SSE probe reported header-policy/endpoint/stream-open/initialize/initialized/tools/list/resources/list steps plus persisted history, used `Authorization -> ERAGEAR_DESKTOP_MCP_AUTH` header-env mapping, and reported it present without exposing the secret value. Desktop smoke also verified project-local trusted MCP servers are injected into the ACP `session/new` payload with `MCP_SESSION_INJECTION`, that the captured stdio route points at the Eragear MCP broker, that `MCP_SESSION_BROKER` can run a brokered `tools/call` and surface its audit, and that `MCP_AGENT_ROUTING` reports one `stdio-proxy` route plus one conditional SSE native-agent route without secret leakage. Unit tests cover stdio success, persisted probe history, SSE message-endpoint success, HTTP header-env success/redaction, missing env-key diagnostics, literal secret-header rejection, JSON-RPC error surfacing, probe-step diagnostics, project-local trusted/untrusted MCP session config resolution, redacted MCP agent-routing classification, and brokered stdio tool-call audit. |
| Provider readiness probe | Pass | Desktop smoke classified OpenCode as `ready` with CLI/auth/model `ok`, then created a temporary Codex provider descriptor and classified the real Codex CLI as `ready` via `codex doctor --json` with CLI/auth/model `ok`, model `gpt-5.5`, and doctor diagnostics present. Unit tests cover ready classification, secret redaction, long Codex doctor JSON parsing, and Windows CLI path parsing. |
| Checkpoint create/restore flow | Pass | Unit tests cover create, session-turn attribution, structured side-by-side diff preview, conflict-aware restore risks, wrong-token rejection, guarded full restore, automatic safety checkpoint, safety checkpoint forward restore, selected-file restore with unrelated workspace changes present, and selected-hunk restore that preserves other hunks in the same file. Electron UI exposes create/preview/attribution/risk/diff/file selection/hunk selection/confirm/restore result, and desktop smoke verifies active-session attribution, side-by-side diff metadata, safe and blocked restore risk states, selected-hunk restore with hunk safety checkpoint, selected-file restore with file safety checkpoint, and unrelated file preservation. |
| Subagent manual invocation | Pass | Desktop smoke verifies `SUBAGENT_COMMAND_READY` for `/agent-code-reviewer`, expands the command into a delegated `code-reviewer` prompt, submits it through `sendMessage`, and observes `MESSAGE_SENT`. Web tests verify `/agent-code-reviewer` expansion and disabled subagent rejection. |

Additional ADE extension slice:

| Flow | Status | Evidence |
| --- | --- | --- |
| Project slash command invocation | Pass | Unit tests cover prompt expansion, argument placeholder replacement, fallback argument append, and disabled command rejection. Desktop smoke creates a temporary `/desktop-smoke` command and verifies prompt/argument metadata through the private `desktop-service` snapshot path. |
| Skill and output-style invocation | Pass | Unit tests cover `@skill`, `/skill-*`, `/style-*`, and disabled descriptor rejection. Desktop smoke creates temporary skill/output-style files and verifies prompt descriptors plus capability records through the private `desktop-service` snapshot path. |
| Project Index/Repo Snapshot v0 | Pass | Unit test covers refresh, persisted `.eragear/repo-index.json`, extension summary, generated directory skips, code symbols, task markers, and search prompt construction. Desktop smoke calls `settings.refreshProjectIndex`, observes 1653 indexed files, 400 visible symbols, 95 task markers, confirms the persisted index contains `GOAL.md`, symbols, and tasks, then verifies `settings.searchProjectIndex` returns `ready` context. Web tests cover automatic chat attachment gating. |
| Project Memory per-message context v0 | Pass | Unit tests cover server-side enabled-source filtering, selected source paths, redacted prompt construction, disabled-source exclusion, and no secret leakage. Chat helper tests cover `/memory` parsing, `--source`/`-s` parsing, picker command construction, draft preservation, automatic memory attachment gating, ready/no-enabled result handling, and composition with Project Index context. Desktop smoke writes a temporary `.eragear/context.md`, calls `settings.buildProjectMemoryContext` through `desktop-service` with `sourcePaths`, verifies the selected source is included, and confirms `api_key=desktop-memory-secret` is redacted. |
| Manual hook execution v0 | Pass | Unit test covers upsert, toggle, disabled-run rejection, project-root cwd guard, isolated env-key allowlists, trust fingerprint gating, changed-fingerprint rejection, capability demotion while untrusted, persisted run history, and redacted stdout/stderr. Desktop smoke creates `Desktop Smoke Hook`, verifies untrusted run is blocked, trusts the current fingerprint through `settings.trustHook`, confirms capability activation changes from false to true, then runs it through `settings.runHook` and observes `desktop hook ok manual`. |
| Lifecycle hook execution v0 | Pass | Unit tests cover project-index, checkpoint-create, checkpoint-restore, and agent-message lifecycle events, plus create/send/stop event publication from the session services, with hooks trusted before lifecycle dispatch. Desktop smoke creates and trusts `Desktop Smoke Index Hook`, refreshes the project index, observes `desktop lifecycle after-project-index-refresh`, then creates/trusts temporary agent-session lifecycle hooks and observes `desktop agent lifecycle after-agent-session-create`, `after-agent-message-send`, and `after-agent-session-stop` from the real Electron session loop. |
| Project-local plugin execution v0 | Pass | Unit test covers upsert, scopes/env-key allowlist persistence, isolated plugin environment, trust fingerprint gating, stale-fingerprint rejection, capability demotion while untrusted, capability toggle, disabled-run rejection, project-root cwd guard, persisted run history, and redacted stdout/stderr. Desktop smoke creates `Desktop Smoke Plugin`, verifies untrusted run is blocked, trusts the current fingerprint through `settings.trustPlugin`, confirms scope `env` plus `ERAGEAR_DESKTOP_PLUGIN_ALLOWED`, then runs it through `settings.runPlugin` and observes `desktop plugin ok Desktop Smoke Plugin`, `allowed_secret= [redacted]`, `blocked=false`, and `scopes=process,project-root,env`. |
| MCP probe diagnostics v0 | Pass | Unit tests assert structured probe steps for stdio, SSE, missing remote header env, JSON-RPC tools/list failure, persisted `probeHistory` after `settings.probeMcpServer`, and bounded SSE reconnect/replay when the first stream closes before a pending `initialize` response. Desktop smoke asserts stdio and SSE probe status is `success`, persisted history has initialized protocol status, initialize/stream-open/endpoint steps are present through the private `desktop-service` path, and `MCP_SSE_DISCOVERY` reports `reconnect.verified: true` with replayed initialize requests. |
| MCP manual invocation v0 | Pass | Unit tests cover stdio `tools/call`, stdio `resources/read`, SSE `tools/call`, SSE `resources/read` reconnect/replay, SSE side-effecting `tools/call` no-replay diagnostics, persisted invocation history, trust fingerprint approval, untrusted invocation blocking, changed-fingerprint blocking, capability demotion until trust, and redaction of env/header secrets returned by the MCP server. Desktop smoke calls `settings.invokeMcpTool` before trust and observes `MCP_INVOKE_POLICY` failure, trusts stdio and SSE fingerprints through `settings.trustMcpServer`, invokes stdio tool/resource and SSE tool successfully, then verifies `MCP_SSE_RESOURCE_RECONNECT` with `requests: 2` and a successful redacted SSE resource read through the private `desktop-service` snapshot path. |
| MCP chat command invocation v0 | Pass | Web tests cover `/mcp` parsing, `server/tool` and `--server` targeting, JSON-object argument validation, trusted initialized server/tool resolution, ambiguous/untrusted rejection, and prompt construction from a redacted MCP invocation result. The chat UI only exposes `/mcp` when an enabled trusted initialized MCP server has discovered tools; submit calls `settings.invokeMcpTool` and sends the result through the normal `sendMessage` path. Desktop smoke continues to verify the underlying MCP trust/invoke path through `desktop-service`. |
| MCP agent session injection v0 | Pass | Session MCP config now merges trusted project-local `.eragear/mcp-servers.json` entries into ACP session setup, skips untrusted or changed fingerprints, resolves remote `headerEnv` values at runtime, and rejects unsupported remote transports when the agent lacks MCP capability. Trusted stdio project-local routes are injected as an Eragear broker command instead of the raw MCP server command. Unit tests cover trusted broker injection, changed-fingerprint skipping, remote header-env resolution, unsupported transport rejection, and brokered stdio `tools/call` redaction/audit. Desktop smoke uses a capture ACP agent and verifies `MCP_SESSION_INJECTION` with one trusted stdio MCP broker in the actual `session/new` payload. |
| MCP agent routing/broker v0 | Pass | Local ADE snapshots now expose an `agentRouting` manifest for project-local MCP servers with `injectable`, `conditional`, `blocked`, and `skipped` route states. Electron renders the Agent Session Routing panel with direct/conditional/blocked counts, `stdio-proxy` vs native-agent transport mode, exact blocker reasons, required agent transport capability, recent brokered agent MCP call count, latest brokered call, and redacted header-env key mapping. Unit tests verify trust blocking, stdio broker classification, HTTP/SSE conditional classification, no secret leakage, and audit JSONL projection into the route. Desktop smoke verifies `MCP_AGENT_ROUTING` with `direct: 1`, `conditional: 1`, `blocked: 0`, stdio `brokerMode: stdio-proxy`, SSE `brokerMode: native-agent-transport`, and no `Bearer desktop-mcp-secret`; it also verifies `MCP_SESSION_BROKER` with a successful brokered `tools/call` audited back into the Electron snapshot. |
| MCP notification history v0 | Pass | Unit tests cover server-pushed stdio and SSE JSON-RPC notifications during probe and invocation, persisted bounded history, source classification, and redaction of env/header secrets from notification payloads. Desktop smoke observes `MCP_NOTIFICATIONS` with stdio `notifications/message` and `notifications/progress`, and `MCP_SSE_NOTIFICATIONS` with probe/invocation `notifications/message` payloads where `Bearer desktop-mcp-secret` is replaced by `[redacted]`. |
| ACP Activity observability v0 | Pass | Unit tests cover owned-chat filtering, selected-chat export, chronological replay frames, limits, redaction, and chat/turn correlation summaries. Desktop smoke observes ACP Activity for the active chat, calls `settings.exportAcpActivity`, then calls `settings.replayAcpActivity` through `desktop-service` and verifies schema version, redacted flag, active chat filter, exported entries, exported chat correlation, chronological replay frames, stable frame sequence, and no `rawPayload*` metadata exposed to Electron. |
| First-screen workflow deck | Pass | Web unit tests cover workflow readiness lane derivation and Next Actions routing for ready, idle, warning, setup, and blocked states. Desktop smoke and `dev:desktop` still pass after the deck replaced the older flat action strip. |
| Active Workspace focus | Pass | Web unit tests cover live-session focus, pending permission warning, changed-file/checkpoint focus, MCP trust-warning focus, ACP correlation focus, and no-session standby state. The first viewport renders those focus items from the same Local ADE snapshot used by the desktop runtime. |

## Verification Commands And Results

```powershell
bun test apps/server/src/modules/settings/application/local-ade.service.test.ts
```

Result: passed, 17 tests, 259 expectations.
Current run result: passed, 29 tests, 427 expectations.

```powershell
bun test apps/server/src/modules/session/application/session-mcp-config.service.test.ts
```

Current run result: passed, 7 tests, 13 expectations. This covers packaged
dist broker resolution, configured broker runtime override, trusted
project-local stdio broker injection, brokered `tools/call` trust enforcement,
response redaction, audit persistence, changed-fingerprint skipping, remote
header-env resolution, and unsupported remote transport rejection.

```powershell
$bun=(Get-Command bun).Source
$node=(Get-Command node -ErrorAction SilentlyContinue).Source
$agent=@(@{command=$bun;allowAnyArgs=$true})
if ($node) { $agent += @{command=$node;allowAnyArgs=$true} }
$env:ALLOWED_AGENT_COMMAND_POLICIES=($agent | ConvertTo-Json -Compress)
$env:ALLOWED_TERMINAL_COMMAND_POLICIES=($agent | ConvertTo-Json -Compress)
$env:ALLOWED_ENV_KEYS='PATH,HOME,USERPROFILE,TEMP,TMP,ERAGEAR_TEST_MCP_AUTH'
bun test apps/server/src/modules/settings/application/local-ade.service.test.ts --test-name-pattern "SSE MCP|SSE resource|SSE tool|reconnects SSE"
```

Current run result: passed, 5 tests, 42 expectations.

```powershell
$bun=(Get-Command bun).Source
$node=(Get-Command node -ErrorAction SilentlyContinue).Source
$agent=@(@{command=$bun;allowAnyArgs=$true})
if ($node) { $agent += @{command=$node;allowAnyArgs=$true} }
foreach ($cmd in @('opencode','codex','claude','gemini')) { $resolved=Get-Command $cmd -ErrorAction SilentlyContinue; if ($resolved) { $agent += @{command=$resolved.Source;allowAnyArgs=$true} } }
$terminal=@(@{command=$bun;allowAnyArgs=$true})
if ($node) { $terminal += @{command=$node;allowAnyArgs=$true} }
$env:ALLOWED_AGENT_COMMAND_POLICIES=($agent | ConvertTo-Json -Compress)
$env:ALLOWED_TERMINAL_COMMAND_POLICIES=($terminal | ConvertTo-Json -Compress)
$env:ALLOWED_ENV_KEYS='PATH,HOME,USERPROFILE,TEMP,TMP'
bun test apps/server/src/modules/settings/application/local-ade.service.test.ts apps/server/src/modules/session/application/session-mcp-config.service.test.ts apps/server/src/modules/session/application/session-acp-bootstrap.service.test.ts
```

Current run result: passed, 37 tests, 426 expectations. This covers Local ADE
MCP discovery/invocation, provider readiness, checkpoint safety restore, and
project-local MCP session injection into ACP setup.

```powershell
bun test apps/server/src/shared/utils/cli-args.util.test.ts apps/server/src/modules/settings/application/local-ade.service.test.ts
```

Current run result: passed, 25 tests, 353 expectations. The added parser tests
cover Windows absolute command paths and quoted paths with spaces.

```powershell
bun test apps/web/src/components/local-ade/local-ade-operations.test.ts apps/web/src/components/chat-ui/local-command.test.ts apps/web/src/components/chat-ui/local-instruction.test.ts apps/web/src/components/chat-ui/project-index-command.test.ts apps/web/src/components/chat-ui/project-index-auto-context.test.ts apps/web/src/components/chat-ui/project-memory-command.test.ts apps/web/src/components/chat-ui/project-memory-auto-context.test.ts apps/web/src/components/chat-ui/subagent-command.test.ts
```

Current run result: passed, 40 tests, 140 expectations.

```powershell
bun test apps/web/src/components/chat-ui/mcp-command.test.ts
```

Current run result: passed, 5 tests, 16 expectations.

```powershell
bun test apps/web/src/components/chat-ui/subagent-command.test.ts apps/web/src/components/chat-ui/mcp-command.test.ts
```

Current run result: passed, 8 tests, 23 expectations.

```powershell
bun test apps/web/src/components/local-ade/local-ade-operations.test.ts
```

Current run result: passed, 10 tests, 68 expectations.

```powershell
bun run --cwd apps/web check-types
```

Result: failed on existing unrelated web typecheck drift. Examples include
React ref type duplication in `src/components/ui/button.tsx`,
`src/components/ui/badge.tsx`, and `src/components/ai-elements/sources.tsx`,
plus Vite plugin type duplication in `vite.config.ts`. No
`local-ade-control-center` or `local-ade-operations` error was reported, and
the production web build passed.

```powershell
$bun=(Get-Command bun).Source; $node=(Get-Command node).Source; $agent=@(@{command=$bun;allowAnyArgs=$true},@{command=$node;allowAnyArgs=$true}); $opencode=Get-Command opencode -ErrorAction SilentlyContinue; if ($opencode) { $agent += @{command=$opencode.Source;allowAnyArgs=$true} }; $terminal=@(@{command=$bun;allowAnyArgs=$true},@{command=$node;allowAnyArgs=$true}); $env:ALLOWED_AGENT_COMMAND_POLICIES=($agent | ConvertTo-Json -Compress); $env:ALLOWED_TERMINAL_COMMAND_POLICIES=($terminal | ConvertTo-Json -Compress); $env:ALLOWED_ENV_KEYS='PATH,HOME,USERPROFILE,TEMP,TMP'; bun test apps/server/src/shared/utils/session-config-options.util.test.ts apps/server/src/modules/session/application/discover-agent-sessions.service.test.ts apps/server/src/modules/session/application/get-session-state.service.test.ts apps/server/src/modules/session/application/persist-session-bootstrap.service.test.ts apps/server/src/shared/utils/chat-events.util.test.ts apps/server/src/modules/tooling/application/respond-permission.service.test.ts apps/server/src/platform/acp/update-stream.test.ts apps/server/src/modules/supervisor/application/supervisor-loop.service.test.ts apps/server/src/modules/supervisor/application/supervisor-permission.service.test.ts
```

Result: passed, 182 tests, 625 expectations.

```powershell
$bun=(Get-Command bun).Source; $node=(Get-Command node).Source; $agent=@(@{command=$bun;allowAnyArgs=$true},@{command=$node;allowAnyArgs=$true}); $opencode=Get-Command opencode -ErrorAction SilentlyContinue; if ($opencode) { $agent += @{command=$opencode.Source;allowAnyArgs=$true} }; $terminal=@(@{command=$bun;allowAnyArgs=$true},@{command=$node;allowAnyArgs=$true}); $env:ALLOWED_AGENT_COMMAND_POLICIES=($agent | ConvertTo-Json -Compress); $env:ALLOWED_TERMINAL_COMMAND_POLICIES=($terminal | ConvertTo-Json -Compress); $env:ALLOWED_ENV_KEYS='PATH,HOME,USERPROFILE,TEMP,TMP'; bun test apps/server/src/modules/session/application/create-session.service.test.ts apps/server/src/modules/session/application/stop-session.service.test.ts apps/server/src/modules/ai/application/send-message.service.test.ts
```

Result: passed, 26 tests, 96 expectations.

```powershell
bun run --cwd apps/desktop check-types
```

Result: passed.

```powershell
bun run --cwd apps/server check-types
```

Result: passed.

```powershell
bun run --cwd apps/server build
if (Test-Path -LiteralPath apps/server/dist/runtime/mcp-agent-broker.js) {
  Get-Item -LiteralPath apps/server/dist/runtime/mcp-agent-broker.js
}
```

Result: passed. The build copied the MCP agent broker runtime asset to
`apps/server/dist/runtime/mcp-agent-broker.js`; the verified asset length was
11993 bytes. The existing `bun` and `bun:sqlite` externalization warnings were
unchanged from prior builds.

```powershell
bun run --cwd apps/desktop build:main
```

Result: passed.

```powershell
bun run --cwd apps/web build
```

Result: passed. Vite emitted the existing chunk-size and Browserslist age
warnings.

```powershell
$env:ERAGEAR_DESKTOP_SMOKE_PROMPT_WAIT_MS='12000'; bun run --cwd apps/desktop ./scripts/smoke-desktop-runtime.ts
```

Result: passed.

- Runtime endpoint: `desktop-service`, ready `true`.
- MCP protocol discovery: `available`, `initialized`,
  `desktop_smoke_tool`, `desktop-smoke-resource`, with probe steps
  `resolve`, `spawn`, `initialize`, `initialized`, `tools/list`, and
  `resources/list`; `settings.probeMcpServer` persisted a successful history
  run with initialized protocol status and 6 steps.
- MCP stdio invocation: `settings.invokeMcpTool` returned `success` with
  `desktop tool call desktop_smoke_tool path=README.md`, and
  `settings.readMcpResource` returned `success` with
  `desktop resource read file:///desktop-smoke`.
- MCP stdio invocation policy: `MCP_INVOKE_POLICY` returned `failed` before
  trust with `MCP invocation blocked by trust policy before protocol execution`;
  `MCP_TRUST` then reported `trustStatus: trusted` and a matching trusted
  fingerprint.
- MCP stdio invocation audit: `MCP_INVOKE_AUDIT` reported 3 persisted entries,
  newest first: `resources/read` for `file:///desktop-smoke`, successful
  `tools/call` for `desktop_smoke_tool`, and the earlier blocked `tools/call`.
- MCP stdio notifications: `MCP_NOTIFICATIONS` reported 5 notification entries,
  including probe `notifications/message`, invocation `notifications/message`,
  and invocation `notifications/progress` for `desktop_smoke_tool`.
- MCP session injection: temporary project `Desktop Smoke MCP Session` trusted
  `Desktop Session Injected MCP`, desktop smoke started a capture ACP agent, and
  `MCP_SESSION_INJECTION` reported ACP method `session/new`, `serverCount: 1`,
  server name `Desktop Session Injected MCP`, command
  `C:\Users\terasumi\.bun\bin\bun.exe`, and args pointing at
  `apps/server/src/runtime/mcp-agent-broker.js` with the project root, server
  id, and trusted fingerprint.
- MCP session broker: desktop smoke spawned the broker command captured from
  ACP `session/new`, called `tools/call` for `desktop_smoke_tool`, received a
  result, then read the Local ADE snapshot and verified `MCP_SESSION_BROKER`
  with `brokerMode: stdio-proxy`, `agentInvocationCount: 1`, and latest
  invocation `[tools/call, success, desktop_smoke_tool]`.
- MCP agent routing preview: after trusting the smoke stdio and SSE servers,
  `MCP_AGENT_ROUTING` reported `status: ready`, `direct: 1`,
  `conditional: 1`, and `blocked: 0`. The stdio route
  `Desktop Smoke MCP` was `injectable` with `brokerMode: stdio-proxy` and
  `agentSupport: not-required`, and the SSE route `Desktop Smoke SSE MCP` was
  `conditional` with `brokerMode: native-agent-transport`,
  `requiresAgentCapability: sse`, and
  `agentSupport: required-at-session-start`. The smoke assertion also verified
  the route manifest did not contain `Bearer desktop-mcp-secret`.
- MCP SSE protocol discovery: `available`, `initialized`,
  `desktop_smoke_sse_tool`, `desktop-sse-resource`, with
  `Authorization -> ERAGEAR_DESKTOP_MCP_AUTH` header-env mapping reported as
  present and no secret value exposed; probe steps included `header-policy`,
  `endpoint`, `stream-open`, `initialize`, `initialized`, `tools/list`, and
  `resources/list`; `settings.probeMcpServer` persisted a successful history
  run with initialized protocol status and 8 steps.
- MCP SSE reconnect/replay: desktop smoke configures the SSE fixture to close
  the first stream before responding to the first discovery request. The runtime
  reconnects, replays pending discovery, and `MCP_SSE_DISCOVERY` reports
  `reconnect.verified: true` with `initializeRequests: 4`.
- MCP SSE invocation: `settings.invokeMcpTool` returned `success` with
  `desktop sse tool desktop_smoke_sse_tool authorization= [redacted]`, and the
  smoke assertion verified `Bearer desktop-mcp-secret` was not exposed.
- MCP SSE resource invocation reconnect: desktop smoke configures the SSE
  fixture to close the stream before the first `resources/read` response. The
  runtime reconnects, replays the safe resource request once, and
  `MCP_SSE_RESOURCE_RECONNECT` reports `status: success`, `requests: 2`, and
  result text `desktop sse resource memory://desktop-smoke-sse`.
- MCP SSE invocation trust: `MCP_SSE_TRUST` reported `trustStatus: trusted`
  and a matching trusted fingerprint before the SSE tool call.
- MCP SSE invocation audit: `MCP_SSE_INVOKE_AUDIT` reported 2 persisted
  entries, newest first: successful `resources/read` for
  `memory://desktop-smoke-sse` and successful `tools/call` for
  `desktop_smoke_sse_tool`, with result text containing `[redacted]` and no
  `Bearer desktop-mcp-secret` value.
- MCP SSE notifications: `MCP_SSE_NOTIFICATIONS` reported 10 notification
  entries across probe and invocation, and every authorization payload replaced
  `Bearer desktop-mcp-secret` with `[redacted]`.
- Provider readiness: OpenCode `ready`, CLI/auth/model `ok`, version `1.16.2`,
  with 5 model identifiers surfaced. Codex readiness was also verified by
  creating a temporary Codex provider descriptor and running the real
  `codex doctor --json`; the result was `ready`, CLI/auth/model `ok`, model
  `gpt-5.5`, with doctor diagnostics for overall status, auth credentials,
  configured model, and provider/websocket reachability. The temporary
  descriptor was deleted and provider-health was restored after smoke.
- Command discovery: temporary `/desktop-smoke` command present, enabled,
  argument hint `<smoke request>`, and prompt body included `$ARGUMENTS`.
- Project Memory Context: temporary `.eragear/context.md` was discovered and
  selected by relative source path, `settings.buildProjectMemoryContext` returned `ready` through
  `desktop-service`, included one selected source with 92 bytes, preserved
  `Prefer runtime-backed Local ADE actions.`, and redacted
  `api_key=desktop-memory-secret` to `api_key= [redacted]`.
- Instruction discovery: temporary `Desktop Smoke Skill` and
  `Desktop Smoke Style` present, enabled, prompt body surfaced, and matching
  capability records present.
- Project Index: `settings.refreshProjectIndex` returned 1658 indexed files,
  112019059 total bytes, top extensions `.ts`, `.md`, `.tsx`, 400 visible code
  symbols, 95 task markers, and the persisted index contained `GOAL.md`,
  symbols, and tasks.
- Project Index Search: `settings.searchProjectIndex` returned status `ready`,
  4 matched entries, and a bounded prompt containing matched index entries plus
  the guard to read referenced files before editing.
- Hook Trust: `settings.upsertHook` created `Desktop Smoke Hook`, untrusted
  `settings.runHook` was blocked, `settings.trustHook` approved the current
  execution fingerprint, capability activation changed from false to true, and
  the trusted descriptor reported `trustStatus: trusted`.
- Hook Runner: trusted `settings.runHook` returned `success`, and stdout
  contained `desktop hook ok manual`.
- Hook Lifecycle: `settings.refreshProjectIndex` triggered
  `after-project-index-refresh`; stdout contained
  `desktop lifecycle after-project-index-refresh`.
- Plugin Trust: `settings.upsertPlugin` created `Desktop Smoke Plugin`;
  untrusted `settings.runPlugin` was blocked, `settings.trustPlugin` approved
  the current command/permission fingerprint, capability activation changed
  from false to true, scopes were `process`, `project-root`, and `env`, the
  env allowlist contained `ERAGEAR_DESKTOP_PLUGIN_ALLOWED`, and trusted
  `settings.runPlugin` returned `success` with stdout containing
  `desktop plugin ok Desktop Smoke Plugin`, `allowed_secret= [redacted]`,
  `blocked=false`, and `scopes=process,project-root,env`.
- Checkpoint risk/attribution preview: temporary git project created checkpoint
  `checkpoint-94a82158-a860-41f3-b3c4-53640c163a3b` while an agent chat was
  active; preview reported `attributionSource: active`,
  `attributionStatus: ready`, and `README.md` marked `safe`. The structured diff
  preview reported 3 modified files,
  `README.md` additions, the added `changed` row, and two hunks in `HUNKS.md`
  before a new `EXTRA.md` change made preview non-restorable with `EXTRA.md`
  marked `blocked`. Selected-hunk restore then restored only hunk 0 in
  `HUNKS.md`, created a hunk safety checkpoint, and preserved hunk 1. Selected
  file restore then restored only `README.md`, created a selected-file safety
  checkpoint, and preserved changed `NOTES.md`, changed hunk 1 in `HUNKS.md`,
  plus untracked `EXTRA.md`.
- Subagent command: `SUBAGENT_COMMAND_READY` reported `/agent-code-reviewer`
  for the enabled `code-reviewer` descriptor, and
  `SUBAGENT_COMMAND_SUBMIT` verified the expanded prompt included the delegated
  profile plus `desktop IPC smoke ok` before `MESSAGE_SENT` accepted the
  normal chat send path.
- Agent lifecycle hooks: desktop smoke observed
  `desktop agent lifecycle after-agent-session-create` for chat
  `01f5a99f-9207-434a-bb2e-b1797306cb1f`,
  `desktop agent lifecycle after-agent-message-send` for turn
  `turn-4ef5d210-64a7-417f-bb80-ef1e2d94ddc2`, and
  `desktop agent lifecycle after-agent-session-stop` after stopping that same
  chat.
- ACP Activity: Local ADE snapshot returned `total: 115`, `chatCount: 24`, 2
  owned entries for active chat `01f5a99f-9207-434a-bb2e-b1797306cb1f`, and 12
  correlation summaries; sampled
  events were `newSession` and `initialize`, with setup payload byte counts
  `381` and `409`, and metadata contained no `rawPayload*` keys.
- ACP Export: `settings.exportAcpActivity` returned `schemaVersion: 1`,
  `redacted: true`, `chatId: 01f5a99f-9207-434a-bb2e-b1797306cb1f`,
  `limit: 20`, `entries: 2`, `correlations: 1`, and `total: 2`; the exported
  trace contained no `rawPayload*` metadata.
- ACP Replay: `settings.replayAcpActivity` returned `schemaVersion: 1`,
  `redacted: true`, `chatId: 01f5a99f-9207-434a-bb2e-b1797306cb1f`,
  `frames: 2`, and `correlations: 1`. The first frame was
  `[1, initialize, 0, 0]`, the last was `[2, newSession, 597, 597]`, frame
  sequence matched array order, timestamps were chronological, every frame was
  scoped to the active chat, and the replay contained no `rawPayload*`
  metadata.
- Session loop: created chat `01f5a99f-9207-434a-bb2e-b1797306cb1f`, sent the
  expanded subagent prompt, observed assistant activity, stopped
  subscription/session/host.

```powershell
$env:ERAGEAR_DESKTOP_SMOKE_EXIT_MS='5000'; bun run dev:desktop
```

Result: passed, exited `0`.

ZCode comparison check:

```powershell
Start-Process 'C:\Program Files\ZCode\ZCode.exe'
```

Result: launched and closed cleanly after black-box process observation. The
latest quick check observed 9 new ZCode-owned processes: Electron
main/renderer/GPU, crashpad, network utility, node service, and `zcode-acp.exe`
with command line `zcode-acp-glm-eragear-code-copilot acp`. Final remaining new
ZCode process count was `0`.

## Files Changed

- `GOAL_PROGRESS.md`
- `apps/desktop/scripts/acp-mcp-capture-agent.js`
- `apps/desktop/scripts/mcp-smoke-server.js`
- `apps/desktop/scripts/smoke-desktop-runtime.ts`
- `apps/server/src/bootstrap/service-registry/ai-services.ts`
- `apps/server/src/bootstrap/service-registry/session-services.ts`
- `apps/server/src/bootstrap/service-registry/settings-services.ts`
- `apps/server/src/modules/agent/infra/agent.repository.sqlite.ts`
- `apps/server/src/modules/ai/application/send-message.service.ts`
- `apps/server/src/modules/ai/application/send-message.service.test.ts`
- `apps/server/src/modules/ai/application/set-config-option.service.ts`
- `apps/server/src/modules/ai/infra/ai-session-runtime.adapter.ts`
- `apps/server/src/modules/session/application/cleanup-project-sessions.service.ts`
- `apps/server/src/modules/session/application/create-session.service.ts`
- `apps/server/src/modules/session/application/create-session.service.test.ts`
- `apps/server/src/modules/session/application/delete-session.service.ts`
- `apps/server/src/modules/session/application/discover-agent-sessions.service.ts`
- `apps/server/src/modules/session/application/discover-agent-sessions.service.test.ts`
- `apps/server/src/modules/session/application/get-session-state.service.test.ts`
- `apps/server/src/modules/session/application/persist-session-bootstrap.service.test.ts`
- `apps/server/src/modules/session/application/session-acp-bootstrap.service.ts`
- `apps/server/src/modules/session/application/session-acp-bootstrap.service.test.ts`
- `apps/server/src/modules/session/application/session-mcp-config.service.ts`
- `apps/server/src/modules/session/application/session-mcp-config.service.test.ts`
- `apps/server/src/modules/session/application/stop-session.service.ts`
- `apps/server/src/modules/session/application/stop-session.service.test.ts`
- `apps/server/src/modules/session/application/subscribe-session-events.service.ts`
- `apps/server/src/modules/settings/application/local-ade.service.ts`
- `apps/server/src/modules/settings/application/local-ade.service.test.ts`
- `apps/server/src/modules/settings/application/manage-boot-allowlists.service.ts`
- `apps/server/src/modules/supervisor/application/supervisor-loop.service.test.ts`
- `apps/server/src/modules/supervisor/application/supervisor-permission.service.test.ts`
- `apps/server/src/modules/tooling/application/respond-permission.service.test.ts`
- `apps/server/src/platform/acp/handlers.ts`
- `apps/server/src/platform/acp/tool-calls.ts`
- `apps/server/src/platform/acp/update.ts`
- `apps/server/src/platform/acp/update-stream.test.ts`
- `apps/server/src/platform/git/index.ts`
- `apps/server/src/platform/storage/sqlite-worker-client.ts`
- `apps/server/src/runtime/desktop-service.ts`
- `apps/server/src/shared/contracts/session-export.contract.ts`
- `apps/server/src/shared/types/domain-events.types.ts`
- `apps/server/src/shared/types/session.types.ts`
- `apps/server/src/shared/utils/chat-events.util.test.ts`
- `apps/server/src/shared/utils/cli-args.util.test.ts`
- `apps/server/src/shared/utils/session-config-options.util.ts`
- `apps/server/src/shared/utils/session-config-options.util.test.ts`
- `apps/server/src/transport/trpc/routers/settings.ts`
- `apps/web/src/components/chat-ui/chat-interface.tsx`
- `apps/web/src/components/chat-ui/local-command.ts`
- `apps/web/src/components/chat-ui/local-command.test.ts`
- `apps/web/src/components/chat-ui/local-instruction.ts`
- `apps/web/src/components/chat-ui/local-instruction.test.ts`
- `apps/web/src/components/chat-ui/project-index-command.ts`
- `apps/web/src/components/chat-ui/project-index-command.test.ts`
- `apps/web/src/components/chat-ui/project-index-auto-context.ts`
- `apps/web/src/components/chat-ui/project-index-auto-context.test.ts`
- `apps/web/src/components/chat-ui/chat-input/project-memory-action-menu.tsx`
- `apps/web/src/components/chat-ui/project-memory-command.ts`
- `apps/web/src/components/chat-ui/project-memory-command.test.ts`
- `apps/web/src/components/chat-ui/project-memory-auto-context.ts`
- `apps/web/src/components/chat-ui/project-memory-auto-context.test.ts`
- `apps/web/src/components/chat-ui/subagent-command.ts`
- `apps/web/src/components/chat-ui/subagent-command.test.ts`
- `apps/web/src/components/local-ade/local-ade-operations.ts`
- `apps/web/src/components/local-ade/local-ade-operations.test.ts`
- `apps/web/src/components/local-ade/local-ade-control-center.tsx`
- `docs/research/zcode-blackbox-scorecard.md`
- `packages/shared/src/chat/session-config-options.ts`
- `packages/shared/src/chat/types.ts`

## Deferred Non-Core Surfaces

- Hook lifecycle execution is wired for project-index refresh, checkpoint
  create/restore, and the real agent session create/send/stop loop. Hooks now
  require execution-fingerprint trust, demote capabilities while untrusted or
  changed, and run with env-key allowlists instead of inheriting the full server
  environment. Richer confirmation semantics, per-hook permission UX, audit
  review controls, and a stronger sandbox still need hardening before hooks are
  treated as a full ZCode-level automation surface.
- Plugin execution v0 is now usable for explicit project-local plugin commands,
  requires trust approval for the current command plus permission fingerprint,
  and runs with explicit scopes plus env-key allowlists instead of inheriting
  all server environment variables. It still lacks signed install policy,
  marketplace-style distribution, a broader permission model, and a stronger
  sandbox, so it is not yet a full ZCode-level plugin platform.
- Project Index now stores file metadata plus bounded code-symbol and
  task-marker signals. `/index <query>` and normal chat prompts can both send a
  ranked index context to chat. Project Memory can send redacted enabled
  sources through `/memory`, `/memory --source <path>`, and normal prompt
  auto-attachment. It is still not yet a semantic/embedding codebase memory
  comparable to deeper ZCode local state.
- Remote auth admin/device-session management remains outside the local ADE
  surface until a local auth-admin policy exists.
- MCP entries now expose sanitized step-level probe timelines, a per-server
  Retry action, persisted redacted probe history for real protocol discovery
  runs, manual tool/resource invocation, and persisted redacted invocation
  audit history plus redacted server notification history. Trusted
  project-local MCP servers are now injected into ACP session setup after
  matching the current fingerprint, while untrusted or changed servers are
  skipped. Trusted project-local stdio routes are injected through an Eragear
  MCP broker that re-checks the project-local fingerprint before each
  tool/resource call, redacts response/audit text, and exposes recent brokered
  agent calls back in the Electron routing panel. Electron now also shows a
  redacted Agent Session Routing preview for each project-local MCP server,
  including stdio broker routes, conditional HTTP/SSE transport capability
  requirements, exact block reasons, and header-env key names only. Manual
  invocation also requires trusting the current redacted server fingerprint,
  and changed fingerprints demote the MCP capability until reviewed. SSE
  discovery probes now have bounded
  reconnect/replay for pending protocol requests when the stream drops before
  discovery completes. SSE invocation now replays safe `resources/read` once
  after stream loss and blocks automatic replay for side-effecting `tools/call`
  with an exact policy diagnostic. Remaining MCP hardening is long-lived
  notification delivery across reconnects, deeper native HTTP/SSE agent-side
  policy/audit beyond session-start capability checks and deeper remote
  operational controls before the MCP surface can be treated as fully
  ZCode-level.
- ACP Activity now shows, exports, and replays redacted per-chat event traffic,
  event kinds, payload byte counts, aggregate counts, chronological frames, and
  chat/session/turn/source correlation summaries. Long-lived stream retry
  controls, deeper causality/stream diagnostics, richer replay filtering, and
  richer checkpoint merge/conflict resolution actions can still be improved,
  but the core
  checkpoint preview/side-by-side-diff/attribution/risk/guarded full
  restore/selected-file restore/selected-hunk restore/safety flow is usable.

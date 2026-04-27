---
artifact_type: diagnostic_evidence
session_id: 20260426-opencode-init-model-list-lag
task_id: T07
producer: user
status: ACTIVE
created_at: 2026-04-27
source_commit: UNKNOWN
based_on:
  - artifacts/20260426-opencode-init-model-list-lag/outputs/T06-output.md
  - artifacts/20260426-opencode-init-model-list-lag/validation/T06-validation.md
consumers:
  - orchestrator
freshness_rule: invalid_if_new_diagnostic_logs_supersede
---

# User Diagnostic Log — T07

## Raw browser log excerpt
```text
This site appears to use a scroll-linked positioning effect. This may not work well with asynchronous panning; see https://firefox-source-docs.mozilla.org/performance/scroll-linked_effects.html for further details and to join the discussion on related tools and features! localhost:3001
[DIAG:subscription-raw-event] {"chatId":"1d09204b-ef07-4a0b-809f-5a4c73124172","eventType":"supervisor_status","estimatedBytes":851} use-chat-diagnostics.ts:32:13
[DIAG:subscription-parse] {"chatId":"1d09204b-ef07-4a0b-809f-5a4c73124172","parseDurationMs":"2.00"} use-chat-diagnostics.ts:32:13
[DIAG:processSessionEvent] {"chatId":"1d09204b-ef07-4a0b-809f-5a4c73124172","eventType":"supervisor_status","durationMs":"0.00","slow":false} use-chat-diagnostics.ts:32:13
[DIAG:subscription-onData-done] {"chatId":"1d09204b-ef07-4a0b-809f-5a4c73124172","eventType":"supervisor_status","estimatedBytes":851,"totalDurationMs":"2.00"} use-chat-diagnostics.ts:32:13
[SupervisorDebug] visibility inputs — connStatus=connected supervisorCapable=true supervisorMode=full_autopilot supervisorStatus=idle supervisorReason=Supervisor enabled for session willRender=true 2 chat-input.tsx:485:13
```

## Initial interpretation cues
- The shown DIAG event is `supervisor_status`, not model/config options.
- Payload is small: 851 bytes.
- Parse and onData total are ~2ms; processSessionEvent is 0ms and `slow=false`.
- This excerpt alone does not identify a heavy diagnostic event.
- Firefox scroll-linked positioning warning suggests possible UI/CSS scroll-linked effect but is not conclusive without React/Performance evidence.
- `[SupervisorDebug]` console output appears from `chat-input.tsx` and may be noisy if emitted repeatedly, but this excerpt alone does not prove it is the main lag source.

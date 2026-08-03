# Scheduled Tasks UX route ledger

## Settings > Scheduled Tasks

- Route: `apps/desktop/src/renderer/routes/settings.bots.tsx`
- Primary component:
  `apps/desktop/src/renderer/components/settings/bots-settings-panel.tsx`
- Shell: existing `SettingsSection`; no new route or navigation layer.
- Monitoring tasks:
  - `Tasks`: objective, status, work mode, provider/windows, reserve,
    admission reason, ACP binding, and state-dependent actions.
  - `Run history`: Supervisor decision/evidence summary, admission, retry time,
    bound ACP/Supervisor identifiers, and bounded failure reason.
- Focused create/edit task: Radix/shadcn `Dialog`, not a monitoring tab.
- Runtime data: `bots.list`, `bots.updates`, `quota.list`, `listProjects`,
  `agents.list`, and `getSessions`.
- Mutations: create/update, enable/disable, run-now-if-eligible, retry, stop,
  delete, and legacy orchestration.
- Sensitive content policy: objective is visible; raw fixed/dynamic prompts,
  transcripts, diffs, secrets, patches, and hidden reasoning are not rendered
  in cards or history.

## Responsive and state coverage

- Narrow layouts stack header actions, compatibility controls, editor fields,
  and card actions.
- Wide layouts use two-column task cards and paired editor fields.
- Explicit states: loading skeleton, query error, empty, disabled, queued,
  quota-blocked, running, completed, failed, and stopped/retryable.

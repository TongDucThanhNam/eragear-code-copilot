# BotsSettingsPanel UX iteration log

## Baseline

The captured baseline
`external-audit-baseline-BotsSettingsPanel-20260723T184128Z.txt` showed one
stacked surface containing summary controls, the complete create/edit form,
Bot cards, and run rows. Provider/window/project/agent/chat bindings were raw
text inputs, loading was a text placeholder, and cards rendered raw prompts.

## Audit gate

- The first independent artifact was rejected because its packet lacked the
  component source, kept the large editor in a Configure tab, invented
  unsupported controls/copy, and assumed a sticky height contract.
- The runner was repaired so the packet included
  `component-source.tsx`.
- AGY then reported exhausted individual quota and the fallback declined the
  direct artifact task. The limitation is recorded in the audit artifact.
- The corrected source-backed plan was accepted only after moving create/edit
  to a dialog, limiting tabs to peer monitoring tasks, retaining legacy fixed
  Bots, and removing raw prompt display.

## Final structure

The final `ui-map` generation confirms:

- `BotsSettingsPanel` keeps the existing settings shell and exposes summary,
  legacy compatibility, error state, monitoring tabs, and a sibling
  `TaskEditorDialog`.
- `TaskCard` owns objective, status, subscription/reserve information,
  non-eligible admission feedback, binding summary, enable, run, edit, and
  delete actions.
- `RunRow` owns state-dependent retry/stop controls, bounded Supervisor
  rationale/evidence, admission details, safe identifiers, prompt hash proof,
  and bounded failures.

Commands:

```powershell
bun apps/native/scripts/generate-ui-map.ts --src ./apps/desktop/src/renderer --entry ./apps/desktop/src/renderer/routes/__root.tsx --alias '@=./apps/desktop/src/renderer' --focus BotsSettingsPanel --scope full --layoutOnly
bun apps/native/scripts/generate-ui-map.ts --src ./apps/desktop/src/renderer --entry ./apps/desktop/src/renderer/routes/__root.tsx --alias '@=./apps/desktop/src/renderer' --focus TaskCard --scope down --layoutOnly
bun apps/native/scripts/generate-ui-map.ts --src ./apps/desktop/src/renderer --entry ./apps/desktop/src/renderer/routes/__root.tsx --alias '@=./apps/desktop/src/renderer' --focus RunRow --scope down --layoutOnly
```

## Verification

- Component and desktop type checks pass.
- Focused Biome and the full `packages apps/desktop apps/native` check pass.
- Renderer production build and Electron smoke pass.
- A live screenshot confirmed the Electron renderer loaded. Windows
  automation could not focus the app while an OS overlay retained foreground
  ownership, so dialog/tab interaction was not claimed as manually verified.

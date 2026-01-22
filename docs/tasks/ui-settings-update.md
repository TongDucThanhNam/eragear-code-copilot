# Dashboard & UI settings redesign

## Goal
- [ ] Refresh the UI/UX of the Hono config/settings pages into a more comprehensive dashboard where users can view and monitor Projects/Sessions in addition to configuring options.
- [ ] Surface per-agent usage/metrics similar to tools like CodexBar so teams can audit who/what is running in each project.

## 1.5) Identify monitoring needs
- [ ] Figure out where Projects/Sessions data currently live (store, queries) so the dashboard can surface them.
- [ ] Determine what metrics/status (active session, state, last update) should be shown alongside settings.

## 2) Design improvements
- [ ] Group related controls (agent settings, display flags, connectors) with clear headings/cards.
- [ ] Improve affordance: use toggles, selects, help text, consistent spacing via Tailwind/Shadcn components.
- [ ] Consider responsive behavior so config page works across widths.

## 2.5) Dashboard panels
- [ ] Design cards/lists that show Projects + collapsed/expandable Sessions with key info (status, last event).
- [ ] Add quick actions if needed (open session, jump to project, create session) while keeping focus on monitoring.

## 3) Implement front-end updates
- [ ] Replace outdated `ui-settings` layout with new cards/sections.
- [ ] Add helpers or tooltips for complex options.
- [ ] Ensure forms still submit via existing handlers or adjust props accordingly.

## 3.5) Surface data & actions
- [ ] Fetch and wire Projects/Sessions data into the dashboard, handling loading/empty states.
- [ ] Keep the settings controls synchronized with the monitoring view (e.g., changes affect data shown).

## 4) Validate
- [ ] Smoke test config page locally to make sure inputs bind correctly and layout looks good.
- [ ] Run lint/build if relevant.
- [ ] Document new layout sections (maybe update README/docs).

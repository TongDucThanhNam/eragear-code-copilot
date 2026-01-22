# Research storing agents on server

## Goal
- [ ] Evaluate migrating agent storage from client-side (per-browser) to centralized storage on the ACP server, improving consistency across clients.

## 1) Current flow
- [ ] Document how agents are defined/stored client-side today (localStorage, backend?).
- [ ] Identify APIs/tools on server responsible for agent lifecycle (creation, start, stop).

## 2) Requirements
- [ ] Define desired UX: shared/workspace-specific agents, sync between devices, security boundaries.
- [ ] Determine ACL model: who can edit/create agents for a project.

## 3) Implementation options
- [ ] Option A: Extend existing server DB/schema to persist agent configs keyed by project/user.
- [ ] Option B: Keep configs in Git repo (e.g. `.acp/agents.json`) and load on demand.
- [ ] Option C: Hybrid (server stores overrides, client caches defaults).
- [ ] Note tradeoffs (latency, offline usage, sync conflicts).

## 4) Integration plan
- [ ] Update ACP session startup to load agent list from server store.
- [ ] Provide API for UI to CRUD agents via server endpoints.
- [ ] Migrate existing agents/configs during rollout.

## 5) Validation
- [ ] Prototype server store and sync cycle for creating/updating agents.
- [ ] Ensure client gracefully handles store down or data versions.
- [ ] Document migration steps for users/ops.

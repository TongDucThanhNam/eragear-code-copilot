# Agents Setup Simplification Completion Report

**Task:** Agents setup simplification (docs/tasks/agents-setup.md)
**Status:** Completed

## Summary of Changes

We have successfully simplified the Agent setup configuration by removing the manual `cwd` (Current Working Directory) requirement. Agents will now consistently interpret the "cwd" as the root directory of the project (`projectID` -> `projectRoot`). This eliminates ambiguity and reduces configuration errors.

### 1. Backend (`apps/server`)
- **Session Manager**: Updated logic in `createChatSession` to strictly use the resolved `projectRoot` as the working directory (`cwd`) for the agent process.
- **API/TRPC**: Removed `cwd` from the input validation schema (`zod`) in `createSession` procedure. Any `cwd` passed from clients is now ignored (or rejected if type-checked).

### 2. Frontend (`apps/web` & `apps/native`)
- **Settings Store**: Removed `cwd` from the `AgentConfig` interface in both Web and Native Zustand stores.
- **UI Components**:
    - **Web**: Removed the "Working Directory (CWD)" input from `SettingsDialog` and the `cwd` badge from the agent list.
    - **Native**: Removed the "Working Directory (CWD)" input from `SettingsScreen` and the `cwd` badge from the agent list.

## Verification
- **Automated Checks**: Code compilation verified (no type errors).
- **Manual Verification**: Confirmed that creating agents via the UI (Web/Native) no longer prompts for cwd and the backend correctly spawns agents in the project root.

## Notes
- If an agent needs to run in a subdirectory (rare case, e.g. mono-repo submodule), this should be handled by the agent's internal logic or a wrapper script, rather than the ACP session configuration.

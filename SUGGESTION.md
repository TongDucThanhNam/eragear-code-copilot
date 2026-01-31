# Eragear Copilot: Competitive Analysis & Feature Roadmap

Based on the strategic analysis of the "Vibe Coding" ecosystem (AMI, CRAFT, Vibekanban, etc.), this document outlines the implementation roadmap for Eragear Copilot.

The goal is to transition Eragear from a simple client to a **"Server-Hosted Agentic IDE"** that bridges the gap between Desktop power and Mobile flexibility.

---

## 🟢 Level 1: Low Complexity / Immediate Value (Quick Wins)
*Focus: Safety, Compliance, and Onboarding.*

### 1. Resource Guardrails (Budgeting)
**Source Inspiration:** *AMI, Snowtree*
*   **Concept:** Mobile users cannot monitor `stdout` constantly. Prevent "infinite loops" or excessive token usage by agents.
*   **Implementation:**
    *   Add a middleware layer in the Server that tracks usage per session.
    *   **Feature:** Set "Max Steps" (e.g., 10 steps) or "Max Cost" (e.g., $2.00) per task.
    *   **Action:** Auto-terminate process if limits are reached.

### 2. Starter Templates (Library)
**Source Inspiration:** *Vibe Coder (Google)*
*   **Concept:** Typing complex init commands on mobile is painful.
*   **Implementation:**
    *   Create a JSON-based list of "Starter Prompts" or scaffold commands.
    *   **Feature:** "One-tap" project initialization (e.g., "New React App", "New API Service").

### 3. Immutable Action Logs
**Source Inspiration:** *Aizen*
*   **Concept:** Enterprise compliance and debugging.
*   **Implementation:**
    *   Structured logging of the chain: `User Prompt` -> `Agent Plan` -> `Diff Generated` -> `User Approval`.
    *   Store in a local SQLite/JSON file alongside the project to allow "playback" of how code was written.

---

## 🟡 Level 2: Medium Complexity / Core Differentiation
*Focus: User Experience (UX) and Connectivity.*

### 4. "The Vibe Feed" (Mobile UI Overhaul)
**Source Inspiration:** *Craft Agents, AMI*
*   **Concept:** Terminals are bad on mobile. Shift the mental model from "Text Editor" to "Task Inbox".
*   **Implementation:**
    *   **Feed UI:** Replace the main chat/terminal view on mobile with a Card Feed.
    *   **Cards:** Display tasks (e.g., "Refactor Auth") with status indicators (Planning, Coding, Waiting for Review).
    *   **Interaction:** Tapping a card opens the detailed chat/diff view.

### 5. Headless Session Persistence & Re-attachment
**Source Inspiration:** *CodexMonitor, Agentastic*
*   **Concept:** The session must survive if the phone screen turns off or network drops.
*   **Implementation:**
    *   Ensure the Agent Server runs processes (Claude Code/Codex) independently of the WebSocket connection.
    *   **Re-attach:** When a client reconnects, dump the recent `stdout` buffer to sync the client state.
    *   **Notification:** Send push notifications (or local alerts) when an Agent enters "Waiting for Input" state.

### 6. Micro-Review Interface (Atomic Diffs)
**Source Inspiration:** *Snowtree*
*   **Concept:** Reviewing 50 files on a phone is impossible. Reviewing 1 file is manageable.
*   **Implementation:**
    *   **Snapshotting:** Instead of applying all changes at once, prompt the agent to apply changes incrementally.
    *   **Swipe UI:** "Tinder for Code". Show a diff of *one* function/file.
        *   **Swipe Right:** Approve & Apply.
        *   **Swipe Left:** Reject & critique.

---

## 🔴 Level 3: High Complexity / Strategic Moat
*Focus: Architecture, Concurrency, and Advanced Integration.*

### 7. Cloud Worktree Manager (Parallelism)
**Source Inspiration:** *Vibekanban*
*   **Concept:** Allow multiple agents to work on the same repo without file locking/git conflicts.
*   **Implementation:**
    *   **Git Plumbing:** Server automatically creates ephemeral `git worktrees` for each new Task/Thread.
    *   **Sandboxing:** Agent A works in `/tmp/worktree_A`, Agent B in `/tmp/worktree_B`.
    *   **Auto-Merge:** When a task is approved, the Server handles the `git merge` back to the main branch.

### 8. ACP Proxy & MCP Context Tunneling
**Source Inspiration:** *CommanderAI, Vibekanban*
*   **Concept:** The Server Agent is "blind" to the user's physical context.
*   **Implementation:**
    *   **Mobile as MCP Server:** The Mobile App acts as an MCP Server.
    *   **Tunneling:** Tunnel mobile capabilities (Camera, GPS, Clipboard) to the Server Agent via WebSocket.
    *   **Use Case:** User photographs a whiteboard diagram -> Mobile sends to Server -> Agent writes code based on the image.

### 9. Collaborative Vibe Coding
**Source Inspiration:** *CodexMonitor*
*   **Concept:** Multiplayer mode.
*   **Implementation:**
    *   Allow multiple Auth tokens to subscribe to the same `session_id`.
    *   **Scenario:** Manager approves the "Plan" on Mobile; Developer watches the "Code Generation" on Desktop.

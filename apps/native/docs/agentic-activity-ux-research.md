# Chain Of Thought UX Notes (Native)
**Date:** 2026-02-01
**Project:** EraGear Code Copilot - AI Chat App

This document replaces the old `agentic-activity` research. The native UI now
renders a Chain of Thought (CoT) panel for agentic activity.

## Goals

- Keep activity visible while streaming; auto-collapse after completion.
- Show a compact summary line (tools, thoughts, notes).
- Provide a readable timeline with icons and a vertical connector.
- Ensure fast scan: status cues are obvious without extra taps.

## Recommended Pattern

- **Header:** "Chain of Thought" + summary counts + spinner when streaming.
- **Body:** timeline steps rendered via existing part renderers.
- **Final output:** trailing text and attachments render outside the chain.

## Status Cues

- **Running:** accent spinner.
- **Completed:** success tone.
- **Error:** danger tone.
- **Approval requested:** warning tone.

## Motion

- Use Accordion built-in animation only.
- Keep collapse delay at ~500ms after streaming ends.
- Avoid extra per-step animations to keep performance stable on mobile.

## Components (Current Code)

- `apps/native/components/chat/chat-message/agentic-chain.tsx`
- `apps/native/components/chat/chat-message/message-item.tsx`
- `apps/native/components/chat/chat-message/part-renderers.tsx`
- `apps/native/components/chat/chat-message/agentic-message-utils.ts`

## Future Adjustments

- If adding new `UIMessagePart` types: update CoT parsing and part renderers.
- If adding new status states: extend the icon tone map and summary labels.

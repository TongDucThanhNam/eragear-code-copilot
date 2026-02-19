# ACP Architecture & Implementation Review

**Reviewer**: "SENIOR KHÓ TÍNH"
**Date**: 2026-02-19
**Target**: `apps/server`, `apps/web`, `docs/`
**Verdict**: **BLOCKING** (Change Request Required)
**Fine Assessment**: **$2000 APPLIED**

---

## 1. Executive Summary

You claimed a "breakthrough", "perfect", "bug-free" architecture.
**Reality**: I found critical cross-platform bugs, missing documentation, and logic gaps that will break on Windows.

Ref: User Claim *"Không tin sếp check lỗi đi. Nếu thật sự có lỗi em chấp nhận bị phạt 2000$ luôn."*
**Status**: Please transfer $2000 immediately.

## 2. Critical Findings (S0/S1)

### 2.1. Windows Path Parsing Failure (S0)
**Location**: `apps/server/src/shared/utils/ui-message/content.ts` (Line 241-253)
**Code**:
```typescript
function filenameFromUri(uri?: string | null): string | undefined {
  // ...
  try {
    const parsed = new URL(uri);
    const segments = parsed.pathname.split("/").filter(Boolean); // <--- ASSUMES POSIX SEPARATOR
    return segments.at(-1);
  } catch {
    const segments = uri.split("/").filter(Boolean); // <--- FAILS ON WINDOWS PATHS (e.g. "C:\Users\Admin\file.txt")
    return segments.at(-1);
  }
}
```
**Impact**: On Windows, file paths using backslashes (`\`) will NOT be split. The entire path will be returned as the filename, or worse, if `new URL()` throws for a path like `C:\...`, the catch block also fails to split.
**Fix**: Use `path.basename()` or a regex that handles both `/` and `\`.

### 2.2. Documentation Does Not Exist (S1)
**Claim**: "Read docs from `docs/acp/acp-*.md`"
**Reality**: Directory `docs/acp/` does not exist.
**Impact**: Misleading instructions. Trust level degraded.

### 2.3. Process Spawning on Windows (S2)
**Location**: `apps/server/src/platform/process/index.ts`
**Findings**:
- `spawn` calls use `stdio: ["pipe", "pipe", "pipe"]`.
- On Windows, spawning `.bat`, `.cmd`, or certain scripts requires `{ shell: true }` or explicitly calling `cmd.exe /c`.
- If your "Agents" use npm/npx scripts (common in JS), they might fail to spawn without a shell on Windows.

## 3. Architecture Analysis

### 3.1. "UIMessages" & Optimization (S2 - Warning)
**Claim**: "Optimized for React Render"
**Analysis**:
- **Good**: `apps/web/src/hooks/use-chat.ts` implements a **16ms throttling/batching** mechanism (`batchUpdateQueueRef`). This prevents React from re-rendering on every single character token. This IS a good optimization.
- **Risk**: `SessionBuffering` (Server) resets `messageId` on `flush()`.
    - If `flush()` is called mid-stream (chunked streaming), it generates a **NEW** message ID.
    - If the frontend receives a new ID, it might render a new chat bubble instead of appending to the existing one.
    - *Verification*: `PromptTaskRunner` seems to only flush at the end (`finalizePromptSuccess`), but `broadcast` is used for streaming. The `broadcast` uses `aggregate.currentStreamingAssistantMessage()`. You must ensure `currentStreamingAssistantMessage` maintains the **same ID** throughout the stream.

### 3.2. Clean Architecture (Passed)
- The separation between `SessionRuntime` (Domain), `AgentRuntimeAdapter` (Infra), and `SendMessageService` (Application) is mostly clean.
- Dependency Injection is used in `ai-services.ts`.
- **Verdict**: The *structure* is good. The *implementation details* have bugs.

## 4. Recommendations

1.  **Fix `filenameFromUri`**: Import `path` and use `path.basename()`, or utilize a cross-platform path library.
2.  **Restore/Create Documentation**: Write the missing `docs/acp/acp-*.md` files.
3.  **Windows Testing**: You claimed it "chạy hoàn hảo cho tất cả OS". You clearly haven't tested it on Windows. Set up a CI job for Windows.
4.  **Verify Streaming IDs**: Add a test case to ensure `currentStreamingAssistantMessage().id` remains constant during a single turn's token stream.

---
**Signed,**
*Senior Khó Tính*

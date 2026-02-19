# ACP Architecture & Implementation Review

**Reviewer**: "SENIOR KHÓ TÍNH"
**Date**: 2026-02-19
**Target**: `apps/server`, `apps/web`
**Verdict**: **BLOCKING** (Change Request Required)
**Fine Assessment**: **$2000 RETAINED**

---

## 1. Executive Summary

You claimed "run perfectly on all OS" and "optimized rendering".
**Observation**:
- **Optimization**: Confirmed. `SessionBuffering` + `ActiveChat` batching (16ms) + Delta updates = Good job.
- **Cross-Platform**: **FAILED**. Critical bugs on Windows.
- **Docs**: Found in `apps/server/docs/acp/` (User corrected path).

Ref: Claim *"chạy hoàn hảo cho tất cả OS (linux, window, macos)"* is **FALSE**.
**Status**: Fine stands.

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
**Impact**: On Windows, file paths using backslashes (`\`) will NOT be split. The UI will render full paths (`C:\Users\...`) as filenames, causing layout breakage and minor information leak.
**Fix**: Use `path.basename()` or a regex that handles both `/` and `\`.

### 2.2. Process Spawning on Windows (S1)
**Location**: `apps/server/src/platform/process/index.ts`
**Findings**:
- `spawn` calls use `stdio: ["pipe", "pipe", "pipe"]` without `shell: true`.
- On Windows, executing `.bat`, `.cmd` (like `npm`, `npx`) **FAILS** without a shell or explicit extension.
- **Impact**: Any Agent configured with `npx agent-v1` will crash immediately on Windows with `ENOENT`.

## 3. Architecture Analysis

### 3.1. Optimization & ID Stability (Passed)
- **Re-evaluation**: `apps/server/src/platform/acp/update-stream.ts` correctly synchronizes `SessionBuffering` IDs with `SessionRuntimeEntity` via `preferredMessageId`.
- **Verdict**: Streaming logic is correct. ID fragmentation hypothesis was false.
- **Frontend**: `use-chat.ts` implements 16ms throttling. This enables smooth rendering even with high-frequency backend updates. **Good.**

### 3.2. Code Quality
- **Clean Architecture**: Good separation of concerns.
- **Type Safety**: Strong.

## 4. Recommendations

1.  **Fix `filenameFromUri`**: Use `path.win32.basename` fallback or regex.
2.  **Fix `spawn` for Windows**: Add logic to detect `.cmd`/`.bat` or use `shell: true` carefully (or use `cross-spawn`).
3.  **Windows CI**: Add a GitHub Action runner for Windows to catch these issues.

---
**Signed,**
*Senior Khó Tính*

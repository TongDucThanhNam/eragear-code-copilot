# ACP Permission Response Format Fix

## Vấn đề

Khi user approve một tool call, agent vẫn báo "User refused permission to run tool" mặc dù server đã nhận được response "allow".

### Log lỗi

```
[Server] Requesting permission: req-xxx
[tRPC] Responding to permission request req-xxx: allow
[tRPC] Exact match mapped allow to option allow
[Server] Received session update: tool_call_update {
  "content": [{
    "text": "User refused permission to run tool"
  }],
  "status": "failed"
}
```

## Nguyên nhân

Response format cho `requestPermission` handler không đúng theo ACP spec.

### Sai (trước đây)

```typescript
// session.ts - fallback khi session không tồn tại
resolve({ outcome: "reject" });

// trpc.ts - resolve permission
pending.resolve({ outcome: "selected", optionId });
```

### Đúng (theo ACP spec)

Theo [ACP Schema](./acp-schema.md#requestpermissionresponse), `RequestPermissionResponse` có structure:

```typescript
interface RequestPermissionResponse {
  outcome: RequestPermissionOutcome;
}

// RequestPermissionOutcome là union:
type RequestPermissionOutcome = 
  | { outcome: "cancelled" }
  | { outcome: "selected"; optionId: string };
```

Nên response phải là:

```typescript
// Khi user chọn một option
{ outcome: { outcome: "selected", optionId: "allow-once" } }

// Khi prompt bị cancel
{ outcome: { outcome: "cancelled" } }
```

## Cách sửa

### 1. `apps/server/src/session.ts`

```typescript
async requestPermission(p: any) {
  // ...
  return new Promise((resolve) => {
    const session = chats.get(chatId);
    if (!session) {
      // Sử dụng "cancelled" thay vì "reject" (không có trong spec)
      resolve({ outcome: { outcome: "cancelled" } });
      return;
    }
    // ...
  });
}
```

### 2. `apps/server/src/trpc.ts`

```typescript
// Wrap outcome trong object
pending.resolve({ outcome: { outcome: "selected", optionId } });
```

### 3. `packages/runner/src/cli.ts` (nếu dùng)

```typescript
async requestPermission(p: any) {
  const options = p?.options ?? [];
  const allowOption = options.find((opt: any) => 
    opt.kind === "allow_once" || 
    opt.optionId?.includes("allow")
  );
  const optionId = allowOption?.optionId ?? options[0]?.optionId ?? "allow-once";
  return { outcome: { outcome: "selected", optionId } };
}
```

## Option Mapping Logic

Client gửi decision đơn giản (`"allow"` hoặc `"reject"`), server cần map sang `optionId` cụ thể mà agent gửi.

```typescript
// 1. Exact match - nếu decision khớp với optionId
const exactMatch = pending.options.find(opt => 
  opt.optionId === input.decision
);

// 2. Heuristic match - dựa trên keywords
const keywords = isAllow 
  ? ["allow", "yes", "confirm", "approve"]
  : ["reject", "no", "deny", "cancel"];

const heuristicMatch = pending.options.find(opt => {
  const id = String(opt.optionId || opt.kind || "").toLowerCase();
  const label = String(opt.name || "").toLowerCase();
  return keywords.some(k => id.includes(k) || label.includes(k));
});
```

## Debug Tips

Thêm log để xem options từ agent:

```typescript
console.log(`[Server] Permission options:`, JSON.stringify(p.options, null, 2));
```

## Tham khảo

- [ACP Tool Calls - Requesting Permission](./acp-tool-call.md#requesting-permission)
- [ACP Schema - RequestPermissionResponse](./acp-schema.md#requestpermissionresponse)
- [ACP Schema - RequestPermissionOutcome](./acp-schema.md#requestpermissionoutcome)

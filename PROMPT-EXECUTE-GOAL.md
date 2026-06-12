# Prompt: Thực thi GOAL.md

> Copy prompt dưới đây và paste vào AI coding assistant (ZCode, Claude Code, Cursor, v.v.).
> Thay `{PHASE}` và `{BUOC}` bằng bước cụ thể muốn bắt đầu.

---

## Prompt mặc định (thực thi toàn bộ)

```
Bạn là AI coding agent thực thi GOAL.md. Đọc toàn bộ GOAL.md tại root project trước khi làm gì.

QUY TẮC THỰC THI:

1. ĐỌC TRƯỚC: Đọc GOAL.md, AGENTS.md, và các file liên quan trước khi bắt đầu.
2. TUÂN THỦ CONSTRAINTS: Mọi constraint trong GOAL.md là tuyệt đối — không ngoại lệ.
3. THEO THỨ TỰ: Thực hiện Execution Plan từng bước, không skip.
4. BÁO CÁO TỪNG BƯỚC: Sau mỗi bước, báo cáo ngắn gọn:
   - Đã làm gì (file nào thay đổi)
   - Kết quả verify (test pass/fail)
   - Blocker (nếu có)
   - Next step
5. VERIFY LIÊN TỤC: Sau mỗi feature, chạy `bun run check-types` và focused test.

QUY TẮC CHỐNG BIAS:
- KHÔNG dừng khi "phần còn lại là polish" → tiếp tục cho đến khi TẤT CẢ Success Criteria pass.
- KHÔNG claim done nếu chưa inspect file/output thật sự.
- Evidence uncertain = chưa xong → tiếp tục làm.
- KHÔNG tự workaround blocker → DỪNG và mô tả.

ARCHITECTURE RULES (từ AGENTS.md):
- Mỗi feature mới: Port → Service → Adapter → Transport → UI
- Domain KHÔNG import infra/transport
- Ports ở `application/ports/`, KHÔNG ở domain
- Tool-call handler KHÔNG tự tạo session state
- KHÔNG bypass SessionRuntimePort khi broadcast event

BẮT ĐẦU TỪ: Phase 1, Bước 1.1 (Git Integration)

Sau khi đọc GOAL.md, báo cáo:
1. Bạn hiểu objective là gì
2. Bạn sẽ bắt đầu từ bước nào
3. Có gì cần clarify không
```

---

## Prompt cho phase/bước cụ thể

```
Thực thi GOAL.md — Bước {BUOC}: {TÊN_BƯỚC}

Ví dụ: Thực thi GOAL.md — Bước 1.1: Git Integration

Đọc GOAL.md và AGENTS.md trước. Chỉ thực hiện bước được chỉ định.

QUY TRÌNH:
1. Đọc GOAL.md → xác định chính xác scope của bước này
2. Đọc các file liên quan trong repo hiện tại
3. Tạo plan chi tiết cho bước này (Port → Service → Adapter → Transport → UI)
4. Implement theo plan
5. Verify: `bun run check-types` + focused test
6. Báo cáo kết quả

CONSTRAINTS (từ GOAL.md):
- Architecture: Clean Architecture layers
- Ports ở application/ports/, KHÔNG ở domain
- Domain KHÔNG import infra/transport
- KHÔNG refactor code không liên quan
- KHÔNG skip verify

Báo cáo sau khi xong:
- Files changed
- Test results
- Any blockers
```

---

## Prompt verify / audit

```
Audit GOAL.md — Verify Success Criteria

Đọc toàn bộ GOAL.md. Chạy từng Success Criterion (1-25) và kiểm tra:

CHO MỖI CRITERION:
1. Kiểm tra code có tồn tại không (file paths)
2. Chạy verification command nếu có
3. Đánh giá: PASS / FAIL / PARTIAL
4. Nếu FAIL: mô tả chính xác cái gì thiếu

SAU CÙNG:
- Tổng kết: X/25 pass
- Liệt kê tất cả FAIL items với chi tiết
- Đề xuất bước tiếp theo cho mỗi FAIL item

KHÔNG bỏ qua criterion nào. KHÔNG claim pass nếu chưa verify thật.
```

---

## Prompt resume (tiếp tục sau khi bị gián đoạn)

```
Resume GOAL.md execution

Đọc GOAL.md. Kiểm tra current state của codebase để xác định:
1. Bước cuối cùng đã hoàn thành là gì (kiểm tra git diff, file timestamps)
2. Bước tiếp theo cần làm là gì
3. Có regression nào kể từ lần thực thi cuối không

Sau đó tiếp tục Execution Plan từ bước tiếp theo.
Tuân thủ tất cả rules trong GOAL.md.
```

---

## Ghi chú sử dụng

| Tình huống | Dùng prompt nào |
|------------|----------------|
| Bắt đầu từ đầu | Prompt mặc định |
| Chỉ muốn làm 1 feature | Prompt cho bước cụ thể |
| Kiểm tra tiến độ | Prompt verify / audit |
| Bị gián đoạn, muốn tiếp | Prompt resume |
| Giao cho agent mới | Prompt mặc định + chỉ định bước bắt đầu |

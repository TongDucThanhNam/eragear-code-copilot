# Hướng Dẫn Architecture Cho "Newbie" (Phiên Bản Dễ Hiểu)

> **Cảnh báo:** Tài liệu này được viết để giải thích "tại sao" và "như thế nào" một cách đơn giản nhất. Không dùng từ chuyên ngành hàn lâm.

## 1. Cái "Server" này thực ra là cái gì?

Hãy tưởng tượng hệ thống này giống như một **Nhà Hàng Cao Cấp**.

-   **Khách Hàng (Client/UI):** Là người dùng ngồi bấm bấm trên web.
-   **Server (Dự án này):** Là **Bộ Phận Quản Lý & Bếp**.
-   **Agent (Process):** Là mấy ông **Thợ/Robot** thực thi nhiệm vụ cụ thể.

Nhiệm vụ của cái Server này là: Nhận món (Request) -> Chế biến (Logic) -> Sai bảo robot làm việc (Agent) -> Trả món cho khách (Response).

## 2. Giải Mã Cấu Trúc Thư Mục (The Map)

Tại sao code không vứt hết vào `index.ts` mà phải chia ra lắm folder thế?

### 2.1. `src/transport` (Lễ Tân / Phục Vụ)
-   **Là ai:** Mấy em lễ tân xinh đẹp (HTTP API, WebSocket).
-   **Nhiệm vụ:**
    -   Nghe điện thoại, ghi lại order của khách.
    -   Nếu khách gọi món "Cơm gà", nó ghi lại "1 Cơm gà" rồi chuyển vào bếp.
    -   **NÓ KHÔNG BIẾT NẤU ĂN.** Nó chỉ chuyền tin thôi.
-   **Tại sao:** Để lỡ sau này muốn đổi từ "Order tại bàn" sang "Order qua app", mình chỉ cần tuyển lễ tân mới, đầu bếp vẫn nấu y nguyên.

### 2.2. `src/modules` (Các Quầy Bếp Chuyên Biệt)
Trong nhà hàng lớn, không ai nấu tất cả mọi thứ cùng một chỗ. Người ta chia ra các Quầy (Station).
Mỗi folder trong `modules` là một Quầy Bếp:
-   **`modules/session` (Quầy Salad):** Chuyên quản lý phiên làm việc.
-   **`modules/ai` (Quầy Nướng):** Chuyên xử lý việc chat với AI.
-   **`modules/project` (Quầy Bánh):** Chuyên quản lý dự án.

**Bên trong mỗi Quầy Bếp lại chia nhỏ:**
-   `application` (Bếp Trưởng): Nắm công thức, điều phối. **(Code quan trọng nhất nằm đây)**
-   `domain` (Nguyên Liệu): Định nghĩa món ăn (Type, Entity). Ví dụ: "Thịt bò phải là bò Kobe".
-   `infra` (Dụng Cụ Riêng): Dao nĩa riêng của quầy đó.

### 2.3. `src/shared` (Kho Gia Vị Chung / Đồ Dùng Chung)
-   **Là ai:** Muối, Tiêu, Đường, Mắm... hoặc cái Chổi lau nhà.
-   **Nhiệm vụ:**
    -   Cung cấp những thứ mà **Ai Cũng Cần Dùng**.
    -   Ví dụ: `logger` (để ghi nhật ký), `errors` (để báo lỗi), `types` (các kiểu dữ liệu chung).
-   **Quy tắc:** Quầy Bếp nào cũng được vào đây lấy đồ, nhưng **KHÔNG ĐƯỢC** để đồ riêng của mình vào đây (đừng để thịt bò của quầy Nướng vào hũ muối chung).

### 2.4. `src/presentation` (Trang Trí Phòng Ăn / Menu)
-   **Là ai:** Dashboard UI (HTML/CSS của cái trang quản lý server).
-   **Nhiệm vụ:**
    -   Làm đẹp những gì khách hàng nhìn thấy trực tiếp từ Server (không phải cái App chính, mà là cái trang Admin ấy).
-   **Tại sao:** Tách biệt phần "Nhìn" khỏi phần "Xử lý".

### 2.5. `src/infra` (Kho Tổng / Hậu Cần)
-   **Là ai:** Database (SQLite), File System của cả nhà hàng.
-   **Nhiệm vụ:**
    -   Lưu trữ dữ liệu lâu dài.
    -   Chạy các việc nặng nhọc (IO, Process).

### 2.6. `src/bootstrap` (Công Tắc Nguồn)
-   **Là ai:** `server.ts`, `container.ts`.
-   **Nhiệm vụ:** Bật điện, mở cửa nhà hàng, setup bàn ghế một lần duy nhất lúc sáng sớm.

---

## 3. Ví Dụ Cụ Thể: Bạn Gửi Tin Nhắn "Hello"

Điều gì xảy ra khi bạn chat "Hello"?

1.  **Lễ Tân (`transport`):** Nhận tin "Hello". Chuyển vé order vào Quầy Nướng (AI Module).
2.  **Bếp Trưởng Quầy Nướng (`modules/ai/application`):**
    -   Nhận tin "Hello".
    -   Lấy muối tiêu từ `shared` để nêm nếm (Log lại thông tin).
    -   Nhờ Kho Tổng (`infra`) gửi tin cho Robot (Agent).
3.  **Robot (Process):** Trả lời "Hi there".
4.  **Bếp Trưởng:** Nhận lại "Hi there", đưa cho Lễ Tân.
5.  **Lễ Tân:** Mang món ra cho khách.

---

## 4. Tóm Lại: Muốn Sửa Code Thì Vào Đâu?

-   **Logic chính:** Vào `modules/*/application`. (Ví dụ muốn sửa quy trình chat: `modules/ai/application`)
-   **Thêm API:** Vào `transport`.
-   **Sửa tiện ích chung (Log, Error):** Vào `shared`.
-   **Sửa giao diện Dashboard:** Vào `presentation`.

Hy vọng giờ bạn đã bớt "tẩu hỏa nhập ma". Đừng đụng lung tung là được.

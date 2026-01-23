# Eragear Server (ACP Client)

Tài liệu định hướng cho agent khi làm việc trong `apps/server`.

## Kiến trúc 4 lớp

- **Application** (`src/modules/*/application`): use case, orchestration, gọi domain + infra để hoàn thành tác vụ.
- **Domain** (`src/modules/*/domain`): entity, rule nghiệp vụ cốt lõi; ít phụ thuộc công nghệ.
- **Infra** (`src/infra`, `src/modules/*/infra`): hiện thực kỹ thuật (ACP, storage, process, filesystem...).
- **Transport** (`src/transport`): HTTP/tRPC/WS routes, nhận request, map dữ liệu, gọi application.

**Vì sao tốt cho AI**
- Dễ định vị: biết logic ở đâu, adapter ở đâu, luồng dữ liệu đi qua đâu.
- Giảm side effects: domain sạch → reasoning chính xác hơn.
- Dễ thay thế: đổi DB/transport không chạm domain.
- Dễ sửa theo phạm vi: AI chỉnh đúng layer, ít lan.

## Mapping thư mục chính

- `src/bootstrap/`: khởi tạo container, server.
- `src/config/`: cấu hình môi trường, hằng số.
- `src/modules/`: domain + application theo feature (agent, ai, project, session...).
- `src/infra/`: adapter cho ACP, storage, process, filesystem, git.
- `src/transport/`: HTTP/tRPC/WS routing **tập trung ở root** (Option 2: centralized transport).
- `src/shared/`: types, errors, utils dùng chung.
- `src/ui/`: cấu hình UI server-side.

## Quy ước chỉnh sửa

- Đặt logic nghiệp vụ vào `domain` hoặc `application`, không để trong `transport`.
- `transport` chỉ nên validate/map input và gọi `application`.
- `infra` chỉ hiện thực interface/adapter, không chứa rule nghiệp vụ.
- Không tạo `modules/*/transport` cho procedures cho đến khi quyết định đổi sang module-level transport.

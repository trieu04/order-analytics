# AGENTS.md

## Mục tiêu

Đây là service độc lập thu thập buy order Minecraft DonutSMP.

```text
Mineflayer → /order → Orders (Page 1) → parser → PostgreSQL → Analytic
```

## Stack và cấu trúc

- Node.js 22+, CommonJS; Mineflayer; Express 5; Drizzle ORM; `pg`; PostgreSQL 17.
- UI HTML + AlpineJS 3 + Pico.css 2, không có build step.
- `src/api/`: HTTP, UI và các module `account`, `analytic`, `setting`.
- `src/collector/`: Mineflayer, scheduler, parser và observation client.
- `src/shared/`: config, logger và database dùng chung.
- `src/shared/database/`: `index`, `schema`, `repository`, `query`.
- `test/`: unit tests không cần Minecraft server/PostgreSQL thật.

## Quy tắc kiến trúc chung

- Tổ chức theo module; router, validation và HTML nằm cùng module sở hữu.
- Composition root chỉ ghép dependency và quản lý lifecycle.
- API gọi database API; collector gửi observation qua REST, không truy cập database.
- Dùng `shared` cho hạ tầng dùng chung; tránh import vòng và xuyên qua public boundary.
- Ưu tiên hàm thuần, dependency injection và abstraction có ownership rõ ràng.
- Khi đổi cấu trúc, cập nhật scripts, Docker/Compose, test, README và `AGENTS.md`.

## Quy tắc nghiệp vụ

- Mọi scan đi qua queue tuần tự; không gửi hai `/order` đồng thời.
- Chỉ đọc slot trước `window.inventoryStart`.\
- Không suy diễn order rời trang 1 là đã fill.
- Chỉ tính fill velocity khi price bucket đủ an toàn để so sánh.

## Cấu hình

- Credentials, Minecraft host/port/version, database URL và API port là static env.
- Item list, scheduler, interval và settle time là dynamic PostgreSQL config.
- Environment dynamic values chỉ seed `app_config` lần đầu, không ghi đè config operator.
- Mọi `PUT /api/settings` phải qua `normalizeSetting`.
- Server phải persist thành công trước khi áp dụng config mới trong memory.

## API

- HTML page routes giữ tại `/`, `/accounts`, `/settings`.
- JSON endpoint phải nằm dưới `/api`.
- Account API dùng `/api/accounts`; setting API dùng `/api/settings`.
- Analytics API dùng `/api/analytics`, gồm observations, scans, snapshots và opportunities.
- Mỗi module API sở hữu `router.js`, validation và HTML tương ứng; `src/api/index.js`
  chỉ mount router và quản lý lifecycle.
- Collector gửi snapshot đã parse tới `POST /api/analytics/observations`.

## Mineflayer safety

- Đăng ký `windowOpen` listener trước khi gửi command.
- Mọi listener chờ window phải có timeout và được gỡ khi timeout.
- Đóng window trong `finally`.
- Bot có thể disconnect trước khi plugin API hoàn chỉnh; kiểm tra method khi shutdown.
- Không log token, cache hoặc credentials.

## Database safety

- Snapshot và entries nằm trong cùng transaction.
- Bootstrap/migration phải idempotent và tương thích database đang có.
- Không drop/xóa dữ liệu nếu không có yêu cầu rõ ràng.
- CRUD và transaction mới ưu tiên Drizzle query builder trong `repository.js`.
- Raw SQL chỉ đặt trong `query.js`, phải parameterize bằng Drizzle `sql` tagged template;
  ngoại lệ là bootstrap DDL tĩnh.
- Không đưa raw SQL trở lại `repository.js` hoặc `index.js`.
- Giữ partial unique index scan job và index `(item_id, observed_at DESC)`.
- Import database qua `require(".../shared/database")`, không import trực tiếp repository/query.

## UI

- Giữ HTML + AlpineJS + Pico.css; không thêm bundler/framework khác.
- UI chỉ gọi REST, không chứa database logic.
- Server-side validation là chuẩn; HTML validation chỉ hỗ trợ UX.
- Giữ giao diện usable trên desktop và mobile.
- Với form dạng grid, không dựa hoàn toàn vào `.grid` mặc định của Pico.css khi label
  hoặc help text có độ dài khác nhau; định nghĩa grid, `align-items` và breakpoint rõ ràng.
- Reset `margin-bottom` trực tiếp cho `input`, `select`, `button` trong form và giữ
  chiều cao control thống nhất; reset trên `label` không thay thế được reset control.
- Các field đặt cạnh nhau phải có cấu trúc đồng nhất (label, control, help text). Nếu
  cần căn hàng, dành chiều cao hoặc grid row nhất quán cho từng phần.
- Khi sửa layout, kiểm tra tối thiểu ở chiều rộng mobile 390px, tablet 768px và
  desktop 1440px; unit test không phát hiện được lỗi căn chỉnh CSS trực quan.

## Kiểm thử bắt buộc

```bash
npm test
node --check src/index.js
node --check src/collector/index.js
node --check src/database/index.js
docker compose config
```

Khi sửa Docker/dependency:

```bash
npm audit --omit=dev
docker compose --profile collector build collector
```

Khi sửa parser, thêm lore fixture hợp lệ và malformed vào
`test/parser.test.js`. Test không được yêu cầu account/server thật.

## Code style

- Dùng `"use strict"`, CommonJS và semicolon.
- Parser/validator nên là hàm thuần.
- Không thêm dependency nếu code nhỏ hoặc Node.js đã giải quyết được.
- Input error dùng `statusCode: 400`; bot unavailable dùng 503.
- Không gọi `console.*` trong runtime; dùng `createLogger` từ `src/shared/logger.js`.
- Log ngắn với scope `api`, `scan`, `minecraft`, `scheduler`; không tự nối prefix.

## Ngoài phạm vi nếu chưa được yêu cầu

- Không tự đặt order, click giao hàng hoặc thay đổi state trong game.
- Không public port, thêm auth/reverse proxy.
- Không mở rộng sang sell order/Auction House hay nhiều page.
- Không commit `.env`, `profiles/`, token, database dump hoặc auth volume.
